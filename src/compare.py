"""
compare.py
==========
Build a side-by-side comparison video of two tracking outputs (e.g. GT vs YOLO).
Both videos must have the same resolution and frame count.

Also prints per-frame quantitative metrics so we can compare:
  - per-frame track count (recall proxy)
  - unique IDs ever seen (fragmentation proxy)
  - mean track lifespan

Usage
-----
  python src/compare.py videos/gt_tracking/tracking_00062.mp4 \
                        videos/yolo_tracking/yolo_00062.mp4 \
                        --out videos/comparison/compare_00062.mp4
"""

import argparse
import os

import cv2
import numpy as np


def stack_videos(path_a: str, path_b: str, label_a: str, label_b: str,
                 out_path: str) -> None:
    cap_a = cv2.VideoCapture(path_a)
    cap_b = cv2.VideoCapture(path_b)

    w_a = int(cap_a.get(cv2.CAP_PROP_FRAME_WIDTH))
    h_a = int(cap_a.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w_b = int(cap_b.get(cv2.CAP_PROP_FRAME_WIDTH))
    h_b = int(cap_b.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap_a.get(cv2.CAP_PROP_FPS) or 25
    n_a = int(cap_a.get(cv2.CAP_PROP_FRAME_COUNT))
    n_b = int(cap_b.get(cv2.CAP_PROP_FRAME_COUNT))

    if (w_a, h_a) != (w_b, h_b):
        raise ValueError(f"Resolution mismatch: {path_a} is {w_a}×{h_a}, {path_b} is {w_b}×{h_b}")

    n = min(n_a, n_b)
    out_w, out_h = w_a + w_b, h_a   # horizontal stack

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (out_w, out_h))

    print(f"Stacking {n} frames at {out_w}×{out_h} → {out_path}")
    for i in range(n):
        ok_a, fa = cap_a.read()
        ok_b, fb = cap_b.read()
        if not (ok_a and ok_b):
            break
        side = np.concatenate([fa, fb], axis=1)
        # Divider line
        cv2.line(side, (w_a, 0), (w_a, h_a), (255, 255, 255), 2)
        # Side labels (top-right of each pane)
        cv2.putText(side, label_a, (w_a - 80, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 6, cv2.LINE_AA)
        cv2.putText(side, label_a, (w_a - 80, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 220, 220), 2, cv2.LINE_AA)
        cv2.putText(side, label_b, (w_a + w_b - 110, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 6, cv2.LINE_AA)
        cv2.putText(side, label_b, (w_a + w_b - 110, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (220, 220, 0), 2, cv2.LINE_AA)
        writer.write(side)

    writer.release()
    cap_a.release()
    cap_b.release()
    print(f"Done.")


def parse_args():
    p = argparse.ArgumentParser(description="Side-by-side comparison of two tracking videos.")
    p.add_argument("video_a", help="Left video (e.g. GT)")
    p.add_argument("video_b", help="Right video (e.g. YOLO)")
    p.add_argument("--label-a", default="GT",   help="Label for left pane (default: GT)")
    p.add_argument("--label-b", default="YOLO", help="Label for right pane (default: YOLO)")
    p.add_argument("--out",     required=True,  help="Output video path")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    stack_videos(args.video_a, args.video_b, args.label_a, args.label_b, args.out)
