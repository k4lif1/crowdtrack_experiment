"""
Render tracking visualization videos from DroneCrowd train_data.
Ground truth format: GT_img{seq}{frame}.mat with (x, y, person_id) head points.
"""

import os
import numpy as np
import cv2
import scipy.io as sio
from collections import defaultdict

TRAIN_ROOT = "data/dronecrowd/mot_full/train_data"
GT_DIR     = os.path.join(TRAIN_ROOT, "ground_truth")
IMG_DIR    = os.path.join(TRAIN_ROOT, "images")
OUT_DIR    = "videos"

TRAIL_FRAMES = 30
FPS          = 25
DOT_RADIUS   = 6    # head-point circle radius


def load_seq_tracks(seq_id):
    """Load all .mat files for a sequence → {person_id: {frame: (x, y)}}"""
    seq_num = int(seq_id)
    prefix  = f"GT_img{seq_num:03d}"
    files   = sorted(f for f in os.listdir(GT_DIR) if f.startswith(prefix))
    tracks  = defaultdict(dict)
    frames  = []
    for fname in files:
        frame_idx = int(fname[len(prefix):fname.index(".")]) - 1   # 0-indexed
        frames.append(frame_idx)
        mat  = sio.loadmat(os.path.join(GT_DIR, fname))
        locs = mat["image_info"][0, 0]["location"][0, 0]           # (N, 3): x, y, id
        for x, y, pid in locs:
            tracks[int(pid)][frame_idx] = (int(x), int(y))
    return dict(tracks), sorted(frames)


def make_color_palette(n):
    colors = []
    for i in range(n):
        hue = int(180 * i / n)
        hsv = np.uint8([[[hue, 220, 220]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
        colors.append((int(bgr[0]), int(bgr[1]), int(bgr[2])))
    return colors


def draw_frame(img, frame_idx, tracks, tid_to_color, tid_list, seq_id):
    out = img.copy()

    for tid in tid_list:
        pts = tracks[tid]
        if frame_idx not in pts:
            continue

        color  = tid_to_color[tid]
        cx, cy = pts[frame_idx]

        # ── Motion trail ────────────────────────────────────────────────────
        trail = [(pts[f]) for f in range(max(0, frame_idx - TRAIL_FRAMES), frame_idx + 1) if f in pts]
        for i in range(1, len(trail)):
            alpha = i / len(trail)
            t_color = tuple(int(c * alpha) for c in color)
            cv2.line(out, trail[i-1], trail[i], t_color, 1, cv2.LINE_AA)

        # ── Head dot ────────────────────────────────────────────────────────
        cv2.circle(out, (cx, cy), DOT_RADIUS, color, -1, cv2.LINE_AA)
        cv2.circle(out, (cx, cy), DOT_RADIUS, (0, 0, 0), 1, cv2.LINE_AA)

        # ── ID label ────────────────────────────────────────────────────────
        label = str(tid)
        font  = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.32
        (lw, lh), base = cv2.getTextSize(label, font, scale, 1)
        lx = cx - lw // 2
        ly = cy - DOT_RADIUS - 2
        cv2.rectangle(out, (lx - 1, ly - lh - 1), (lx + lw + 1, ly + base), (0, 0, 0), -1)
        cv2.putText(out, label, (lx, ly), font, scale, color, 1, cv2.LINE_AA)

    n_visible = sum(1 for t in tracks.values() if frame_idx in t)
    cv2.putText(out,
                f"Frame {frame_idx+1:03d}  |  Seq {seq_id}  |  {n_visible} visible  |  {len(tid_list)} total IDs",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def render_sequence(seq_id):
    seq_num = int(seq_id)
    tracks, frames = load_seq_tracks(seq_id)
    if not frames:
        print(f"  [!] No frames found for seq {seq_id}")
        return

    tid_list     = sorted(tracks.keys())
    colors       = make_color_palette(len(tid_list))
    tid_to_color = {tid: colors[i] for i, tid in enumerate(tid_list)}

    first_img = os.path.join(IMG_DIR, f"img{seq_num:03d}{frames[0]+1:03d}.jpg")
    sample    = cv2.imread(first_img)
    if sample is None:
        print(f"  [!] Cannot read {first_img}")
        return
    h, w = sample.shape[:2]

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"tracking_train_{seq_id}.mp4")
    writer   = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))

    print(f"  Rendering {len(frames)} frames, {len(tid_list)} IDs → {out_path}")
    for fi in frames:
        img_path = os.path.join(IMG_DIR, f"img{seq_num:03d}{fi+1:03d}.jpg")
        img = cv2.imread(img_path)
        if img is None:
            img = np.zeros((h, w, 3), dtype=np.uint8)
        writer.write(draw_frame(img, fi, tracks, tid_to_color, tid_list, seq_id))

    writer.release()
    print(f"  Done → {out_path}")


if __name__ == "__main__":
    # Diverse selection: 2 densest, 2 medium density, 1 sparse
    sequences = [
        "00008",   # densest  (avg 396 ppl/frame)
        "00100",   # densest  (avg 414 ppl/frame)
        "00006",   # dense    (avg 376 ppl/frame)
        "00001",   # medium   (avg ~104 ppl/frame)
        "00040",   # varied scene
    ]
    for seq_id in sequences:
        print(f"\nSequence {seq_id}:")
        render_sequence(seq_id)
