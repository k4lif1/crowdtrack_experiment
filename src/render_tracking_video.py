"""
Render a tracking visualization video from DroneCrowd MOT annotations.
Each person gets a unique color + ID label + motion trail across frames.
"""

import os
import xml.etree.ElementTree as ET
import numpy as np
import cv2
from collections import defaultdict

MOT_ROOT   = "data/dronecrowd/mot_full"
IMAGES_DIR = os.path.join(MOT_ROOT, "test_data", "images")
ANNOT_DIR  = os.path.join(MOT_ROOT, "annotations")
OUT_DIR    = "videos"

TRAIL_FRAMES  = 30    # how many past frames to draw as motion trail
FPS           = 25
MIN_VIS_TRACK = 5     # skip tracks appearing in fewer frames


def load_tracks(seq_id):
    """Parse XML → {track_id: {frame: (xtl,ytl,xbr,ybr,occluded)}}"""
    path = os.path.join(ANNOT_DIR, f"{seq_id}.xml")
    tree = ET.parse(path)
    root = tree.getroot()
    tracks = {}
    for track in root.findall("track"):
        tid = int(track.get("id"))
        boxes = {}
        for box in track.findall("box"):
            if int(box.get("outside", 0)):
                continue
            f   = int(box.get("frame"))
            occ = int(box.get("occluded", 0))
            boxes[f] = (
                float(box.get("xtl")), float(box.get("ytl")),
                float(box.get("xbr")), float(box.get("ybr")),
                occ
            )
        if len(boxes) >= MIN_VIS_TRACK:
            tracks[tid] = boxes
    return tracks


def make_color_palette(n):
    """Generate n visually distinct BGR colors."""
    colors = []
    for i in range(n):
        hue = int(180 * i / n)
        hsv = np.uint8([[[hue, 220, 220]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
        colors.append((int(bgr[0]), int(bgr[1]), int(bgr[2])))
    return colors


def draw_frame(img, frame_idx, tracks, tid_to_color, tid_list):
    out = img.copy()
    h, w = out.shape[:2]

    for tid in tid_list:
        boxes = tracks[tid]
        if frame_idx not in boxes:
            continue

        color = tid_to_color[tid]
        xtl, ytl, xbr, ybr, occ = boxes[frame_idx]
        xtl, ytl, xbr, ybr = int(xtl), int(ytl), int(xbr), int(ybr)
        cx, cy = (xtl + xbr) // 2, (ytl + ybr) // 2

        # ── Motion trail ────────────────────────────────────────────────────
        trail_pts = []
        for f in range(max(0, frame_idx - TRAIL_FRAMES), frame_idx + 1):
            if f in boxes:
                bx = boxes[f]
                trail_pts.append((int((bx[0]+bx[2])//2), int((bx[1]+bx[3])//2)))

        for i in range(1, len(trail_pts)):
            alpha = i / len(trail_pts)
            thickness = max(1, int(2 * alpha))
            t_color = tuple(int(c * alpha) for c in color)
            cv2.line(out, trail_pts[i-1], trail_pts[i], t_color, thickness, cv2.LINE_AA)

        # ── Bounding box (dashed for occluded) ──────────────────────────────
        box_thick = 1 if occ else 2
        cv2.rectangle(out, (xtl, ytl), (xbr, ybr), color, box_thick)

        # ── ID label ────────────────────────────────────────────────────────
        label    = str(tid)
        font     = cv2.FONT_HERSHEY_SIMPLEX
        scale    = 0.38
        lthick   = 1
        (lw, lh), baseline = cv2.getTextSize(label, font, scale, lthick)
        lx = max(0, min(cx - lw // 2, w - lw - 2))
        ly = max(lh + 2, ytl - 2)
        # dark background for readability
        cv2.rectangle(out, (lx - 1, ly - lh - 1), (lx + lw + 1, ly + baseline), (0,0,0), -1)
        cv2.putText(out, label, (lx, ly), font, scale, color, lthick, cv2.LINE_AA)

    # ── Frame counter ────────────────────────────────────────────────────────
    cv2.putText(out, f"Frame {frame_idx+1:03d}  |  Seq {seq_id}  |  {len(tid_list)} tracks",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 1, cv2.LINE_AA)

    return out


def render_sequence(seq_id):
    seq_num   = int(seq_id)
    tracks    = load_tracks(seq_id)
    tid_list  = sorted(tracks.keys())
    n_tracks  = len(tid_list)
    colors    = make_color_palette(n_tracks)
    tid_to_color = {tid: colors[i] for i, tid in enumerate(tid_list)}

    all_frames = sorted({f for t in tracks.values() for f in t.keys()})
    n_frames   = len(all_frames)

    # Determine frame size from first image
    first_img_name = f"img{seq_num:03d}{all_frames[0]+1:03d}.jpg"
    first_img_path = os.path.join(IMAGES_DIR, first_img_name)
    sample = cv2.imread(first_img_path)
    if sample is None:
        print(f"  [!] Cannot read {first_img_path}, skipping.")
        return
    h, w = sample.shape[:2]

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"tracking_{seq_id}.mp4")
    fourcc   = cv2.VideoWriter_fourcc(*"mp4v")
    writer   = cv2.VideoWriter(out_path, fourcc, FPS, (w, h))

    print(f"  Rendering {n_frames} frames, {n_tracks} tracks → {out_path}")
    for frame_idx in all_frames:
        img_name = f"img{seq_num:03d}{frame_idx+1:03d}.jpg"
        img_path = os.path.join(IMAGES_DIR, img_name)
        img = cv2.imread(img_path)
        if img is None:
            img = np.zeros((h, w, 3), dtype=np.uint8)
        rendered = draw_frame(img, frame_idx, tracks, tid_to_color, tid_list)
        writer.write(rendered)

    writer.release()
    print(f"  Done → {out_path}")


if __name__ == "__main__":
    # Render a few representative sequences from test_data
    sequences = ["00011", "00022", "00062"]
    for seq_id in sequences:
        print(f"\nSequence {seq_id}:")
        render_sequence(seq_id)
