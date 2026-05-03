"""
tracking_visualizer.py
======================
Renders annotated tracking videos from the DroneCrowd MOT dataset.

Supports both dataset splits, which use different annotation formats:

  Train / Val  →  GT_img{seq}{frame}.mat
                  Each .mat file covers one frame and contains a (N, 3) array
                  under image_info.location with columns [x, y, person_id].
                  Only the head centre point is annotated — no bounding box.

  Test         →  {seq_id}.xml
                  One XML file per sequence. Each <track id="N"> element holds
                  a <box> per frame with (xtl, ytl, xbr, ybr), an `outside`
                  flag (person not visible), and an `occluded` flag.
                  Bounding boxes are ground-truth, not model predictions.

What this script adds on top of the raw annotations
----------------------------------------------------
The dataset files are plain coordinate data — they contain no visuals.
This script layers the following onto each video frame before encoding:

  1. Colour assignment  — each person ID maps to a unique, consistent BGR
                          colour derived from an evenly-spaced HSV palette.
                          The same ID always gets the same colour across all
                          frames of a sequence.

  2. Shape annotation   — test split draws a rectangle (bounding box from XML);
                          train split draws a filled circle at the head point,
                          because no box is available in the .mat annotations.

  3. Motion trail       — the centre path of the last TRAIL_FRAMES frames is
                          drawn as a fading polyline, giving a visual sense of
                          direction and speed without modifying the coordinates.

  4. ID label           — the numeric track ID is printed above each annotation
                          with a dark background for readability at any density.

  5. HUD overlay        — frame counter, sequence ID, and visible/total counts
                          are burned into the top-left corner.

Usage
-----
  # Test split (XML bounding boxes), single sequence:
  python src/tracking_visualizer.py --split test --seq 00062

  # Train split (.mat head points), single sequence:
  python src/tracking_visualizer.py --split train --seq 00001

  # Render a list of sequences:
  python src/tracking_visualizer.py --split train --seq 00001 00006 00040

  # Override output directory:
  python src/tracking_visualizer.py --split test --seq 00062 --out my_videos/

Output: videos/gt_tracking/tracking_{seq_id}.mp4  (or tracking_train_{seq_id}.mp4)

Requirements: opencv-python-headless, scipy, numpy
"""

import argparse
import os
import xml.etree.ElementTree as ET
from collections import defaultdict

import cv2
import numpy as np
import scipy.io as sio

# ── Paths ─────────────────────────────────────────────────────────────────────
MOT_ROOT   = "data/dronecrowd/mot_full"
ANNOT_DIR  = os.path.join(MOT_ROOT, "annotations")          # XML files (test)

# ── Rendering constants ────────────────────────────────────────────────────────
TRAIL_FRAMES  = 30    # how many past frames to draw in the motion trail
FPS           = 25    # output frame rate (matches source footage)
MIN_TRACK_LEN = 5     # tracks shorter than this are skipped (reduces clutter)
DOT_RADIUS    = 6     # head-point circle radius for train split
LABEL_SCALE   = 0.36  # font scale for ID labels


# ── Colour palette ─────────────────────────────────────────────────────────────

def make_palette(n: int) -> list[tuple[int, int, int]]:
    """Return n visually distinct BGR colours spread evenly around the HSV wheel."""
    palette = []
    for i in range(n):
        hue = int(180 * i / max(n, 1))
        hsv = np.uint8([[[hue, 215, 215]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
        palette.append((int(bgr[0]), int(bgr[1]), int(bgr[2])))
    return palette


# ── Annotation loaders ─────────────────────────────────────────────────────────

def load_test_tracks(seq_id: str) -> dict[int, dict[int, tuple]]:
    """
    Parse the XML annotation for a test sequence.

    Returns
    -------
    tracks : {person_id: {frame_index: (xtl, ytl, xbr, ybr, occluded)}}
        Frame index is 0-based. Frames where `outside=1` are excluded because
        the person is not present in the image at that point.
    """
    path = os.path.join(ANNOT_DIR, f"{seq_id}.xml")
    root = ET.parse(path).getroot()
    tracks: dict[int, dict[int, tuple]] = {}

    for track in root.findall("track"):
        tid   = int(track.get("id"))
        boxes = {}
        for box in track.findall("box"):
            if int(box.get("outside", 0)):
                continue
            f = int(box.get("frame"))
            boxes[f] = (
                float(box.get("xtl")), float(box.get("ytl")),
                float(box.get("xbr")), float(box.get("ybr")),
                int(box.get("occluded", 0)),
            )
        if len(boxes) >= MIN_TRACK_LEN:
            tracks[tid] = boxes

    return tracks


def load_train_tracks(seq_id: str, gt_dir: str) -> tuple[dict[int, dict[int, tuple]], list[int]]:
    """
    Load all per-frame .mat ground-truth files for a train/val sequence.

    The .mat format stores a MATLAB struct under image_info with two fields:
      - location : (N, 3) float array  →  columns are [x, y, person_id]
      - number   : scalar count (redundant with len(location))

    Person IDs are consistent across all frames in a sequence, so trajectories
    can be reconstructed by grouping rows with the same ID across files.

    Returns
    -------
    tracks : {person_id: {frame_index: (cx, cy)}}
    frames : sorted list of 0-based frame indices present in this sequence
    """
    seq_num = int(seq_id)
    prefix  = f"GT_img{seq_num:03d}"
    files   = sorted(f for f in os.listdir(gt_dir) if f.startswith(prefix))
    tracks: dict[int, dict[int, tuple]] = defaultdict(dict)
    frames  = []

    for fname in files:
        # Filename: GT_img{seq}{frame:03d}.mat  →  frame number is after prefix
        frame_idx = int(fname[len(prefix):fname.index(".")]) - 1   # convert to 0-based
        frames.append(frame_idx)
        locs = sio.loadmat(os.path.join(gt_dir, fname))["image_info"][0, 0]["location"][0, 0]
        for x, y, pid in locs:
            tracks[int(pid)][frame_idx] = (int(x), int(y))

    return dict(tracks), sorted(frames)


# ── Per-frame renderer ─────────────────────────────────────────────────────────

def _draw_trail(canvas, frame_idx: int, history: dict[int, tuple], color: tuple) -> None:
    """Draw a fading polyline from the last TRAIL_FRAMES centre positions."""
    pts = [
        history[f]
        for f in range(max(0, frame_idx - TRAIL_FRAMES), frame_idx + 1)
        if f in history
    ]
    for i in range(1, len(pts)):
        alpha     = i / len(pts)
        t_color   = tuple(int(c * alpha) for c in color)
        thickness = max(1, int(2 * alpha))
        cv2.line(canvas, pts[i - 1], pts[i], t_color, thickness, cv2.LINE_AA)


def _draw_label(canvas, label: str, x: int, y: int, color: tuple) -> None:
    """Print a numeric ID label with a dark background at (x, y)."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    (lw, lh), base = cv2.getTextSize(label, font, LABEL_SCALE, 1)
    lx = max(0, x - lw // 2)
    ly = max(lh + 2, y - 2)
    cv2.rectangle(canvas, (lx - 1, ly - lh - 1), (lx + lw + 1, ly + base), (0, 0, 0), -1)
    cv2.putText(canvas, label, (lx, ly), font, LABEL_SCALE, color, 1, cv2.LINE_AA)


def render_frame_test(img: np.ndarray, frame_idx: int, tracks: dict,
                      tid_to_color: dict, seq_id: str) -> np.ndarray:
    """
    Overlay bounding boxes, trails, and ID labels onto a test-split frame.
    Occluded boxes are drawn with a thinner stroke (1px vs 2px).
    """
    canvas = img.copy()
    h, w   = canvas.shape[:2]

    for tid, boxes in tracks.items():
        if frame_idx not in boxes:
            continue
        xtl, ytl, xbr, ybr, occ = boxes[frame_idx]
        xtl, ytl, xbr, ybr      = int(xtl), int(ytl), int(xbr), int(ybr)
        cx, cy                   = (xtl + xbr) // 2, (ytl + ybr) // 2
        color                    = tid_to_color[tid]

        # Centre history for trail (derived from box midpoints)
        centre_hist = {
            f: (int((b[0] + b[2]) // 2), int((b[1] + b[3]) // 2))
            for f, b in boxes.items()
        }
        _draw_trail(canvas, frame_idx, centre_hist, color)

        cv2.rectangle(canvas, (xtl, ytl), (xbr, ybr), color, 1 if occ else 2)
        _draw_label(canvas, str(tid), cx, ytl - 2, color)

    n_visible = sum(1 for b in tracks.values() if frame_idx in b)
    cv2.putText(canvas,
                f"Frame {frame_idx + 1:03d}  |  Seq {seq_id}  |  "
                f"{n_visible} visible  |  {len(tracks)} total tracks",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


def render_frame_train(img: np.ndarray, frame_idx: int, tracks: dict,
                       tid_to_color: dict, seq_id: str) -> np.ndarray:
    """
    Overlay head-point dots, trails, and ID labels onto a train-split frame.
    No bounding box is available in .mat annotations — only the head centre.
    """
    canvas = img.copy()

    for tid, pts in tracks.items():
        if frame_idx not in pts:
            continue
        cx, cy = pts[frame_idx]
        color  = tid_to_color[tid]

        _draw_trail(canvas, frame_idx, pts, color)
        cv2.circle(canvas, (cx, cy), DOT_RADIUS, color,     -1, cv2.LINE_AA)
        cv2.circle(canvas, (cx, cy), DOT_RADIUS, (0, 0, 0),  1, cv2.LINE_AA)
        _draw_label(canvas, str(tid), cx, cy - DOT_RADIUS - 2, color)

    n_visible = sum(1 for p in tracks.values() if frame_idx in p)
    cv2.putText(canvas,
                f"Frame {frame_idx + 1:03d}  |  Seq {seq_id}  |  "
                f"{n_visible} visible  |  {len(tracks)} total IDs",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


# ── Sequence renderer ──────────────────────────────────────────────────────────

def render_sequence(seq_id: str, split: str, out_dir: str, raw: bool = False) -> None:
    seq_num   = int(seq_id)
    img_split = "test_data" if split == "test" else "train_data"
    img_dir   = os.path.join(MOT_ROOT, img_split, "images")
    gt_dir    = os.path.join(MOT_ROOT, img_split, "ground_truth")

    if split == "test":
        tracks = load_test_tracks(seq_id)
        frames = sorted({f for t in tracks.values() for f in t})
    else:
        tracks, frames = load_train_tracks(seq_id, gt_dir)

    if not frames:
        print(f"  [!] No annotated frames found for seq {seq_id} ({split})")
        return

    tid_list     = sorted(tracks.keys())
    palette      = make_palette(len(tid_list))
    tid_to_color = {tid: palette[i] for i, tid in enumerate(tid_list)}

    # Read one frame to get resolution
    probe_name = f"img{seq_num:03d}{frames[0] + 1:03d}.jpg"
    probe      = cv2.imread(os.path.join(img_dir, probe_name))
    if probe is None:
        print(f"  [!] Cannot read image {probe_name}")
        return
    h, w = probe.shape[:2]

    os.makedirs(out_dir, exist_ok=True)
    prefix   = "source_train_" if (raw and split == "train") else \
               "source_"       if raw                        else \
               "tracking_train_" if split == "train"         else "tracking_"
    out_path = os.path.join(out_dir, f"{prefix}{seq_id}.mp4")
    writer   = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))

    mode_label = "raw" if raw else split
    print(f"  [{mode_label}] seq {seq_id}  |  {len(frames)} frames  |  {len(tid_list)} IDs  →  {out_path}")

    for fi in frames:
        img_path = os.path.join(img_dir, f"img{seq_num:03d}{fi + 1:03d}.jpg")
        img      = cv2.imread(img_path)
        if img is None:
            img = np.zeros((h, w, 3), dtype=np.uint8)

        if raw:
            frame = img
        elif split == "test":
            frame = render_frame_test(img, fi, tracks, tid_to_color, seq_id)
        else:
            frame = render_frame_train(img, fi, tracks, tid_to_color, seq_id)

        writer.write(frame)

    writer.release()
    print(f"  Done → {out_path}")


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Render DroneCrowd MOT tracking videos with colour-coded IDs and motion trails.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--split", choices=["train", "test"], required=True,
        help="Dataset split to render. 'test' uses XML bounding-box annotations; "
             "'train' uses .mat head-point annotations.",
    )
    parser.add_argument(
        "--seq", nargs="+", required=True, metavar="SEQ_ID",
        help="One or more zero-padded sequence IDs, e.g. 00062 00001 00006.",
    )
    parser.add_argument(
        "--raw", action="store_true",
        help="Export plain source video with no annotations (outputs to videos/source/ by default).",
    )
    parser.add_argument(
        "--out", default=None, metavar="DIR",
        help="Output directory. Defaults to videos/source/ with --raw, videos/gt_tracking/ otherwise.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.out is None:
        args.out = "videos/source" if args.raw else "videos/gt_tracking"
    for seq_id in args.seq:
        render_sequence(seq_id.zfill(5), args.split, args.out, raw=args.raw)
