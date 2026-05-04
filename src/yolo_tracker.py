"""
yolo_tracker.py
===============
Autonomous crowd detection and tracking on DroneCrowd test sequences using
YOLOv8-VisDrone + SAHI + ByteTrack on Apple Silicon MPS.

Pipeline
--------
  1. Load YOLOv8l fine-tuned on VisDrone (mshamrai/yolov8l-visdrone).
  2. For each frame, run SAHI sliced inference:
       - Slice 1920×1080 into overlapping 640×640 tiles.
       - Run YOLO detection on each tile.
       - Merge detections with NMS across tile boundaries.
     This is the standard technique for detecting tiny objects in aerial footage.
  3. Feed merged detections into ByteTrack to assign consistent IDs across frames.
  4. Render bounding boxes + motion trails + IDs in the same style as the GT
     tracking videos so the outputs can be directly compared side-by-side.

Output: videos/yolo_tracking/yolo_{seq_id}.mp4

Comparison:
  videos/gt_tracking/tracking_{seq_id}.mp4   ← ground-truth annotations
  videos/yolo_tracking/yolo_{seq_id}.mp4      ← this script (no GT used)

Usage
-----
  source venv_sam3/bin/activate
  python src/yolo_tracker.py --seq 00062
  python src/yolo_tracker.py --seq 00062 --frames 60 --conf 0.25
  python src/yolo_tracker.py --seq 00062 --frames 300 --no-sahi
"""

import argparse
import os
from collections import defaultdict, deque

import cv2
import numpy as np
from tqdm import tqdm

MOT_ROOT = "data/dronecrowd/mot_full"
IMG_DIR  = os.path.join(MOT_ROOT, "test_data", "images")
FPS      = 25
TRAIL_FRAMES = 30
LABEL_SCALE  = 0.36

# VisDrone class indices we care about
PERSON_CLASSES = {0, 1}   # 0=pedestrian, 1=people

VISDRONE_HF_REPO = "mshamrai/yolov8l-visdrone"
VISDRONE_HF_FILE = "best.pt"


# ── Colour palette ──────────────────────────────────────────────────────────

def make_color(track_id: int) -> tuple[int, int, int]:
    hue = int(180 * (track_id % 256) / 256)
    hsv = np.uint8([[[hue, 215, 215]]])
    bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
    return (int(bgr[0]), int(bgr[1]), int(bgr[2]))


# ── Renderer ────────────────────────────────────────────────────────────────

# ── Track stitching + interpolation ──────────────────────────────────────────

def stitch_and_interpolate(raw_tracks: dict[int, list[tuple]],
                           max_gap: int,
                           dist_factor: float
                           ) -> tuple[dict[int, dict[int, tuple]], int, int]:
    """
    Two-stage post-processing on fragmented tracks:

    1. **Stitch**: greedily link fragments where track A ends and track B starts
       within `max_gap` frames at a spatial distance ≤ box_size × time_gap × dist_factor.
       Both fragments become one track under A's ID.
    2. **Interpolate**: fill any internal gaps in each (now-stitched) track with
       linear interpolation of the box corners.

    Returns
    -------
    stitched_tracks : {canonical_tid: {frame_idx: (x1,y1,x2,y2, score, is_interp_flag)}}
    n_stitched      : number of fragment merges applied
    n_interpolated  : total number of interpolated frames added
    """
    # Compute per-track endpoints (first and last detection)
    endpoints = {}
    for tid, dets in raw_tracks.items():
        if not dets:
            continue
        dets_sorted = sorted(dets, key=lambda d: d[0])
        endpoints[tid] = {
            "first":   dets_sorted[0][0],
            "last":    dets_sorted[-1][0],
            "fbox":    dets_sorted[0][1:5],
            "lbox":    dets_sorted[-1][1:5],
            "history": dets_sorted,
        }

    # Greedy stitch: for each track in order of last_frame, find the best follower.
    # Followers are tracks starting after our end, within max_gap, at plausible distance.
    merge: dict[int, int] = {}   # follower_tid -> base_tid
    used:  set[int] = set()
    sorted_by_end = sorted(endpoints.keys(), key=lambda t: endpoints[t]["last"])

    for base in sorted_by_end:
        if base in used:
            continue
        cur_last = endpoints[base]["last"]
        cur_lbox = endpoints[base]["lbox"]
        cx_a = (cur_lbox[0] + cur_lbox[2]) / 2
        cy_a = (cur_lbox[1] + cur_lbox[3]) / 2
        size_a = ((cur_lbox[2] - cur_lbox[0]) + (cur_lbox[3] - cur_lbox[1])) / 2

        best, best_score = None, float("inf")
        for cand in sorted_by_end:
            if cand == base or cand in used or cand in merge:
                continue
            cf = endpoints[cand]["first"]
            time_gap = cf - cur_last
            if time_gap <= 0 or time_gap > max_gap:
                continue
            cb = endpoints[cand]["fbox"]
            cx_b = (cb[0] + cb[2]) / 2
            cy_b = (cb[1] + cb[3]) / 2
            dist = ((cx_a - cx_b) ** 2 + (cy_a - cy_b) ** 2) ** 0.5
            # Allowed motion scales with box size and time gap (px/frame)
            if dist > size_a * time_gap * dist_factor:
                continue
            # Combined score: closer in time and space is better
            score = dist + time_gap * size_a * 0.3
            if score < best_score:
                best, best_score = cand, score

        if best is not None:
            merge[best] = base
            used.add(best)

    # Resolve transitive merges (B→A, C→B should give C→A)
    def resolve(t):
        while t in merge:
            t = merge[t]
        return t

    # Combine histories under canonical IDs
    combined: dict[int, list[tuple]] = defaultdict(list)
    for tid, ep in endpoints.items():
        combined[resolve(tid)].extend(ep["history"])

    # Interpolate gaps within each canonical track
    out: dict[int, dict[int, tuple]] = {}
    n_interp = 0
    for tid, dets in combined.items():
        dets = sorted(set((d[0],) + d[1:] for d in dets))   # dedupe by frame
        timeline: dict[int, tuple] = {}
        # Start with all real detections (is_interp = False)
        for d in dets:
            fi = d[0]
            timeline[fi] = (d[1], d[2], d[3], d[4], d[5], False)
        # Walk consecutive real detections and fill gaps linearly
        real_frames = sorted(timeline.keys())
        for a, b in zip(real_frames[:-1], real_frames[1:]):
            gap = b - a - 1
            if gap <= 0:
                continue
            xa = timeline[a]; xb = timeline[b]
            for k in range(1, gap + 1):
                t = k / (gap + 1)
                box = tuple(xa[i] + t * (xb[i] - xa[i]) for i in range(4))
                score = xa[4] + t * (xb[4] - xa[4])
                timeline[a + k] = box + (score, True)
                n_interp += 1
        out[tid] = timeline

    return out, len(merge), n_interp


def render_frame(img: np.ndarray,
                 tracks: list[tuple],           # [(track_id, x1,y1,x2,y2, conf, is_interp), ...]
                 history: dict[int, deque],
                 frame_idx: int,
                 seq_id: str,
                 total_ever: int) -> np.ndarray:
    """Same rendering format as tracking_visualizer.py render_frame_test for direct
    side-by-side comparison: same colour hash, same trail, same dark-background ID label."""
    canvas = img.copy()

    for t in tracks:
        track_id, x1, y1, x2, y2 = t[0], t[1], t[2], t[3], t[4]
        color = make_color(track_id)
        cx    = int((x1 + x2) / 2)

        # Motion trail
        pts = list(history[track_id])
        for i in range(1, len(pts)):
            alpha   = i / len(pts)
            t_color = tuple(int(c * alpha) for c in color)
            cv2.line(canvas, pts[i - 1], pts[i], t_color,
                     max(1, int(2 * alpha)), cv2.LINE_AA)

        # Bounding box (always 2px — YOLO has no occluded flag)
        cv2.rectangle(canvas, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)

        # ID label with dark background (matches tracking_visualizer style)
        label = str(track_id)
        font  = cv2.FONT_HERSHEY_SIMPLEX
        (lw, lh), base = cv2.getTextSize(label, font, LABEL_SCALE, 1)
        lx = max(0, cx - lw // 2)
        ly = max(lh + 2, int(y1) - 2)
        cv2.rectangle(canvas, (lx - 1, ly - lh - 1), (lx + lw + 1, ly + base), (0, 0, 0), -1)
        cv2.putText(canvas, label, (lx, ly), font, LABEL_SCALE, color, 1, cv2.LINE_AA)

    cv2.putText(canvas,
                f"YOLO  |  Frame {frame_idx + 1:03d}  |  Seq {seq_id}  |  "
                f"{len(tracks)} tracked  |  {total_ever} total IDs",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


# ── Main pipeline ────────────────────────────────────────────────────────────

def run(seq_id: str, num_frames: int, conf: float, use_sahi: bool,
        slice_size: int, out_dir: str,
        lost_buffer: int, match_thresh: float,
        stitch_gap: int, stitch_dist_factor: float) -> None:

    import torch
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Device: {device.upper()}")

    # ── Load model ───────────────────────────────────────────────────────────
    from huggingface_hub import hf_hub_download
    model_path = hf_hub_download(VISDRONE_HF_REPO, VISDRONE_HF_FILE)
    print(f"Loading {VISDRONE_HF_REPO} …")
    from ultralytics import YOLO
    model = YOLO(model_path)

    if use_sahi:
        from sahi import AutoDetectionModel
        from sahi.predict import get_sliced_prediction
        sahi_model = AutoDetectionModel.from_pretrained(
            model_type="ultralytics",
            model_path=model_path,
            confidence_threshold=conf,
            device=device,
        )
        print(f"SAHI sliced inference: {slice_size}×{slice_size}px tiles, overlap=0.2")
    else:
        model.to(device)
        print("Direct inference (no SAHI slicing)")

    # ── ByteTrack ────────────────────────────────────────────────────────────
    from supervision import ByteTrack, Detections
    tracker = ByteTrack(
        track_activation_threshold=conf,
        lost_track_buffer=lost_buffer,
        minimum_matching_threshold=match_thresh,
        frame_rate=FPS,
    )
    print(f"ByteTrack: activation={conf}  lost_buffer={lost_buffer}f  match_thresh={match_thresh}")

    # ── Load frames ──────────────────────────────────────────────────────────
    seq_num    = int(seq_id)
    num_frames = min(num_frames, 300)
    print(f"Processing {num_frames} frames for seq {seq_id} …")

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"yolo_{seq_id}.mp4")

    # Read first frame for resolution
    probe = cv2.imread(os.path.join(IMG_DIR, f"img{seq_num:03d}001.jpg"))
    h, w  = probe.shape[:2]

    # ── Pass 1: detection + tracking, accumulate raw track data ───────────────
    raw_tracks: dict[int, list[tuple]] = defaultdict(list)
    print("Pass 1/2: Detection + tracking ...")

    for fi in tqdm(range(num_frames), unit="frame"):
        img_path = os.path.join(IMG_DIR, f"img{seq_num:03d}{fi + 1:03d}.jpg")
        img_bgr  = cv2.imread(img_path)
        if img_bgr is None:
            continue

        if use_sahi:
            result = get_sliced_prediction(
                image=img_path, detection_model=sahi_model,
                slice_height=slice_size, slice_width=slice_size,
                overlap_height_ratio=0.2, overlap_width_ratio=0.2,
                perform_standard_pred=True, postprocess_match_threshold=0.5,
                verbose=0,
            )
            boxes, scores, class_ids = [], [], []
            for obj in result.object_prediction_list:
                if obj.category.id not in PERSON_CLASSES:
                    continue
                bb = obj.bbox
                boxes.append([bb.minx, bb.miny, bb.maxx, bb.maxy])
                scores.append(obj.score.value)
                class_ids.append(obj.category.id)
            dets = Detections(xyxy=np.array(boxes, np.float32),
                              confidence=np.array(scores, np.float32),
                              class_id=np.array(class_ids, int)) if boxes else Detections.empty()
        else:
            results = model(img_bgr, conf=conf, verbose=False)[0]
            dets    = Detections.from_ultralytics(results)
            mask    = np.isin(dets.class_id, list(PERSON_CLASSES))
            dets    = dets[mask]

        tracked = tracker.update_with_detections(dets)
        for i in range(len(tracked)):
            tid  = int(tracked.tracker_id[i])
            x1, y1, x2, y2 = tracked.xyxy[i]
            score = float(tracked.confidence[i]) if tracked.confidence is not None else 1.0
            raw_tracks[tid].append((fi, float(x1), float(y1), float(x2), float(y2), score))

    raw_id_count = len(raw_tracks)
    print(f"Raw tracker output: {raw_id_count} fragmented tracks")

    # ── Stitch + interpolate ──────────────────────────────────────────────────
    print(f"Stitching fragments (max gap: {stitch_gap}f, dist factor: {stitch_dist_factor}) ...")
    stitched, n_merges, n_interp = stitch_and_interpolate(
        raw_tracks, max_gap=stitch_gap, dist_factor=stitch_dist_factor,
    )
    print(f"Stitched {n_merges} fragment merges → {len(stitched)} canonical tracks")
    print(f"Interpolated {n_interp} frames to fill gaps")

    # ── Pass 2: render with stitched + interpolated tracks ────────────────────
    print("Pass 2/2: Rendering ...")
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))
    history: dict[int, deque] = defaultdict(lambda: deque(maxlen=TRAIL_FRAMES))

    # Reorganise: per-frame list of (tid, x1, y1, x2, y2, score, is_interp)
    frame_tracks: dict[int, list[tuple]] = defaultdict(list)
    for tid, timeline in stitched.items():
        for fi, (x1, y1, x2, y2, score, is_interp) in timeline.items():
            frame_tracks[fi].append((tid, x1, y1, x2, y2, score, is_interp))

    all_ids: set[int] = set()
    for fi in tqdm(range(num_frames), unit="frame"):
        img_path = os.path.join(IMG_DIR, f"img{seq_num:03d}{fi + 1:03d}.jpg")
        img_bgr  = cv2.imread(img_path)
        if img_bgr is None:
            writer.write(np.zeros((h, w, 3), dtype=np.uint8))
            continue
        active = frame_tracks.get(fi, [])
        for t in active:
            tid = t[0]
            cx  = int((t[1] + t[3]) / 2)
            cy  = int((t[2] + t[4]) / 2)
            history[tid].append((cx, cy))
            all_ids.add(tid)
        frame = render_frame(img_bgr, active, history, fi, seq_id, len(all_ids))
        writer.write(frame)

    writer.release()
    print(f"\nFinal: {len(all_ids)} unique IDs (down from {raw_id_count} raw fragments)")
    print(f"Done → {out_path}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="YOLOv8-VisDrone + SAHI + ByteTrack crowd tracker for DroneCrowd sequences.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--seq",        default="00062", metavar="SEQ_ID",
                   help="Zero-padded test sequence ID (default: 00062)")
    p.add_argument("--frames",     type=int, default=60, metavar="N",
                   help="Number of frames to process (default: 60, max: 300)")
    p.add_argument("--conf",         type=float, default=0.2,  metavar="F",
                   help="Detection confidence threshold (default: 0.2)")
    p.add_argument("--no-sahi",      action="store_true",
                   help="Disable SAHI sliced inference (faster but misses small people)")
    p.add_argument("--slice-size",   type=int,   default=640,  metavar="PX",
                   help="SAHI tile size in px (default: 640). Smaller (320) gives higher recall "
                        "but boxes jitter across tile boundaries → ByteTrack fragments tracks. "
                        "640 was empirically the best balance on DroneCrowd.")
    p.add_argument("--lost-buffer",  type=int,   default=30,   metavar="N",
                   help="ByteTrack lost-track keep-alive in frames (default: 30 = 1.2s).")
    p.add_argument("--match-thresh", type=float, default=0.7,  metavar="F",
                   help="ByteTrack IoU matching threshold (default: 0.7).")
    p.add_argument("--stitch-gap",   type=int,   default=15,   metavar="N",
                   help="Max time gap (frames) between fragment end and start to consider stitching "
                        "(default: 15 = 0.6s). Set to 0 to disable stitching+interpolation.")
    p.add_argument("--stitch-dist",  type=float, default=2.5,  metavar="F",
                   help="Spatial-distance factor for stitching: max_dist = box_size × time_gap × this "
                        "(default: 2.5; lower = stricter spatial match).")
    p.add_argument("--out",          default="videos/yolo_tracking", metavar="DIR",
                   help="Output directory (default: videos/yolo_tracking/)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args.seq.zfill(5), args.frames, args.conf,
        not args.no_sahi, args.slice_size, args.out,
        args.lost_buffer, args.match_thresh,
        args.stitch_gap, args.stitch_dist)
