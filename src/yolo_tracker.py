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

def render_frame(img: np.ndarray,
                 tracks: list[tuple],           # [(track_id, x1,y1,x2,y2, conf), ...]
                 history: dict[int, deque],
                 frame_idx: int,
                 seq_id: str,
                 total_ever: int) -> np.ndarray:
    canvas = img.copy()
    h, w   = canvas.shape[:2]

    for (track_id, x1, y1, x2, y2, conf) in tracks:
        color = make_color(track_id)
        cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)

        # Motion trail
        pts = list(history[track_id])
        for i in range(1, len(pts)):
            alpha   = i / len(pts)
            t_color = tuple(int(c * alpha) for c in color)
            cv2.line(canvas, pts[i - 1], pts[i], t_color,
                     max(1, int(2 * alpha)), cv2.LINE_AA)

        # Bounding box
        cv2.rectangle(canvas, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)

        # ID label
        label = str(track_id)
        font  = cv2.FONT_HERSHEY_SIMPLEX
        (lw, lh), base = cv2.getTextSize(label, font, LABEL_SCALE, 1)
        lx = max(0, cx - lw // 2)
        ly = max(lh + 2, int(y1) - 2)
        cv2.rectangle(canvas, (lx - 1, ly - lh - 1), (lx + lw + 1, ly + base), (0, 0, 0), -1)
        cv2.putText(canvas, label, (lx, ly), font, LABEL_SCALE, color, 1, cv2.LINE_AA)

    cv2.putText(canvas,
                f"YOLO+ByteTrack  |  Frame {frame_idx + 1:03d}  |  Seq {seq_id}  |  "
                f"{len(tracks)} active  |  {total_ever} total IDs",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


# ── Main pipeline ────────────────────────────────────────────────────────────

def run(seq_id: str, num_frames: int, conf: float, use_sahi: bool,
        slice_size: int, out_dir: str) -> None:

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
        lost_track_buffer=30,
        minimum_matching_threshold=0.7,
        frame_rate=FPS,
    )

    # ── Load frames ──────────────────────────────────────────────────────────
    seq_num    = int(seq_id)
    num_frames = min(num_frames, 300)
    print(f"Processing {num_frames} frames for seq {seq_id} …")

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"yolo_{seq_id}.mp4")

    # Read first frame for resolution
    probe = cv2.imread(os.path.join(IMG_DIR, f"img{seq_num:03d}001.jpg"))
    h, w  = probe.shape[:2]
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))

    history: dict[int, deque] = defaultdict(lambda: deque(maxlen=TRAIL_FRAMES))
    all_ids: set[int] = set()

    for fi in tqdm(range(num_frames), unit="frame"):
        img_path = os.path.join(IMG_DIR, f"img{seq_num:03d}{fi + 1:03d}.jpg")
        img_bgr  = cv2.imread(img_path)
        if img_bgr is None:
            writer.write(np.zeros((h, w, 3), dtype=np.uint8))
            continue

        # ── Detection ────────────────────────────────────────────────────────
        if use_sahi:
            result = get_sliced_prediction(
                image=img_path,
                detection_model=sahi_model,
                slice_height=slice_size,
                slice_width=slice_size,
                overlap_height_ratio=0.2,
                overlap_width_ratio=0.2,
                perform_standard_pred=True,
                postprocess_match_threshold=0.5,
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
            if boxes:
                dets = Detections(
                    xyxy=np.array(boxes, dtype=np.float32),
                    confidence=np.array(scores, dtype=np.float32),
                    class_id=np.array(class_ids, dtype=int),
                )
            else:
                dets = Detections.empty()
        else:
            results = model(img_bgr, conf=conf, verbose=False)[0]
            dets    = Detections.from_ultralytics(results)
            mask    = np.isin(dets.class_id, list(PERSON_CLASSES))
            dets    = dets[mask]

        # ── Track ─────────────────────────────────────────────────────────────
        tracked = tracker.update_with_detections(dets)

        active: list[tuple] = []
        for i in range(len(tracked)):
            tid  = int(tracked.tracker_id[i])
            x1, y1, x2, y2 = tracked.xyxy[i]
            score = float(tracked.confidence[i]) if tracked.confidence is not None else 1.0
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
            history[tid].append((cx, cy))
            all_ids.add(tid)
            active.append((tid, x1, y1, x2, y2, score))

        frame = render_frame(img_bgr, active, history, fi, seq_id, len(all_ids))
        writer.write(frame)

    writer.release()
    print(f"\nTracked {len(all_ids)} unique IDs across {num_frames} frames")
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
    p.add_argument("--conf",       type=float, default=0.2, metavar="F",
                   help="Detection confidence threshold (default: 0.2)")
    p.add_argument("--no-sahi",    action="store_true",
                   help="Disable SAHI sliced inference (faster but misses small people)")
    p.add_argument("--slice-size", type=int, default=640, metavar="PX",
                   help="SAHI tile size in pixels (default: 640)")
    p.add_argument("--out",        default="videos/yolo_tracking", metavar="DIR",
                   help="Output directory (default: videos/yolo_tracking/)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args.seq.zfill(5), args.frames, args.conf,
        not args.no_sahi, args.slice_size, args.out)
