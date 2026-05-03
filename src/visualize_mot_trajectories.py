"""
Visualize ground-truth MOT trajectories from DroneCrowd full dataset.
Uses the XML annotations with persistent track IDs and per-frame bounding boxes.
"""

import os
import xml.etree.ElementTree as ET
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from PIL import Image

MOT_ROOT   = "data/dronecrowd/mot_full"
SEQ_ID     = "00011"
SEQ_NUM    = int(SEQ_ID)         # 11
BG_FRAME   = 150                 # background image (1-indexed)
TRAIL_LEN  = None                # None = full trajectory; int = last N frames
MIN_FRAMES = 10                  # skip tracks shorter than this
OUT_PATH   = "trajectory_mot_viz.png"


def load_tracks(seq_id):
    """Parse XML → dict of track_id -> list of (frame, cx, cy, w, h, occluded)."""
    xml_path = os.path.join(MOT_ROOT, "annotations", f"{seq_id}.xml")
    tree = ET.parse(xml_path)
    root = tree.getroot()

    tracks = {}
    for track in root.findall("track"):
        tid   = int(track.get("id"))
        boxes = []
        for box in track.findall("box"):
            frame    = int(box.get("frame"))
            outside  = int(box.get("outside", 0))
            occluded = int(box.get("occluded", 0))
            if outside:
                continue
            xtl = float(box.get("xtl"))
            ytl = float(box.get("ytl"))
            xbr = float(box.get("xbr"))
            ybr = float(box.get("ybr"))
            cx  = (xtl + xbr) / 2
            cy  = (ytl + ybr) / 2
            w   = xbr - xtl
            h   = ybr - ytl
            boxes.append((frame, cx, cy, w, h, occluded))
        if boxes:
            boxes.sort(key=lambda b: b[0])
            tracks[tid] = boxes
    return tracks


def load_bg(seq_num, frame_id):
    name = f"img{seq_num:03d}{frame_id:03d}.jpg"
    path = os.path.join(MOT_ROOT, "test_data", "images", name)
    return np.array(Image.open(path))


def draw(tracks, bg, out_path):
    long = {tid: t for tid, t in tracks.items() if len(t) >= MIN_FRAMES}
    print(f"  Total tracks: {len(tracks)}, tracks ≥{MIN_FRAMES} frames: {len(long)}")

    fig, axes = plt.subplots(1, 2, figsize=(22, 9), dpi=120,
                              gridspec_kw={"width_ratios": [2, 1]})

    # ── Left: full-frame trajectory overlay ──────────────────────────────────
    ax = axes[0]
    ax.imshow(bg)
    cmap   = cm.hsv
    tids   = sorted(long.keys())
    colors = {tid: cmap(i / len(tids)) for i, tid in enumerate(tids)}

    for tid, boxes in long.items():
        trail = boxes if TRAIL_LEN is None else boxes[-TRAIL_LEN:]
        xs = [b[1] for b in trail]
        ys = [b[2] for b in trail]
        c  = colors[tid]
        ax.plot(xs, ys, "-", color=c, linewidth=1.0, alpha=0.7)
        ax.plot(xs[-1], ys[-1], "o", color=c, markersize=3, alpha=0.95)

    n_frames = max(b[0] for t in tracks.values() for b in t) + 1
    ax.set_title(
        f"DroneCrowd MOT — Seq {SEQ_ID}  |  {len(long)} individuals  |  {n_frames} frames",
        fontsize=11, pad=6
    )
    ax.axis("off")

    # ── Right: movement heatmap (track density) ───────────────────────────────
    ax2 = axes[1]
    h, w = bg.shape[:2]
    heat = np.zeros((h, w), dtype=np.float32)
    for boxes in long.values():
        for b in boxes:
            cx, cy = int(b[1]), int(b[2])
            if 0 <= cx < w and 0 <= cy < h:
                heat[cy, cx] += 1

    from scipy.ndimage import gaussian_filter
    heat = gaussian_filter(heat, sigma=12)
    ax2.imshow(bg, alpha=0.45)
    ax2.imshow(heat, cmap="inferno", alpha=0.65,
               vmin=0, vmax=np.percentile(heat[heat > 0], 95) if heat.max() > 0 else 1)
    ax2.set_title("Movement density heatmap", fontsize=11, pad=6)
    ax2.axis("off")

    fig.suptitle("DroneCrowd Full Dataset — Ground-truth trajectories (MOT annotations)",
                 fontsize=13, y=1.01)
    fig.tight_layout(pad=0.5)
    fig.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close(fig)
    print(f"  Saved → {out_path}")


if __name__ == "__main__":
    print(f"Loading tracks for sequence {SEQ_ID}...")
    tracks = load_tracks(SEQ_ID)

    print(f"Loading background frame {BG_FRAME}...")
    bg = load_bg(SEQ_NUM, BG_FRAME)

    print("Rendering...")
    draw(tracks, bg, OUT_PATH)
