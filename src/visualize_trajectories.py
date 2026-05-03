"""
Visualize crowd movement trajectories from DroneCrowd CC annotations.
Annotation format: frame_id, x, y (head points, no persistent IDs).
Trajectories are reconstructed via greedy nearest-neighbor matching across frames.
"""

import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from PIL import Image
from scipy.spatial.distance import cdist
from collections import defaultdict

DATA_ROOT = "data/dronecrowd/VisDrone2020-CC"
SEQ_ID = "00009"
MAX_MATCH_DIST = 40   # pixels — max distance to link a point to an existing track
OUT_PATH = "trajectory_viz.png"


def load_annotations(seq_id):
    path = os.path.join(DATA_ROOT, "annotations", f"{seq_id}.txt")
    frames = defaultdict(list)
    with open(path) as f:
        for line in f:
            fid, x, y = line.strip().split(",")
            frames[int(fid)].append((int(x), int(y)))
    return dict(sorted(frames.items()))


def load_frame(seq_id, frame_id):
    path = os.path.join(DATA_ROOT, "sequences", seq_id, f"{frame_id:05d}.jpg")
    return np.array(Image.open(path))


def greedy_match(prev_pts, curr_pts, max_dist):
    """Match curr_pts to prev_pts greedily by nearest neighbour. Returns list of (prev_idx, curr_idx)."""
    if not prev_pts or not curr_pts:
        return []
    D = cdist(np.array(prev_pts), np.array(curr_pts))
    matches = []
    used_prev, used_curr = set(), set()
    for _ in range(min(len(prev_pts), len(curr_pts))):
        idx = np.unravel_index(np.argmin(D), D.shape)
        pi, ci = idx
        if D[pi, ci] > max_dist:
            break
        matches.append((pi, ci))
        used_prev.add(pi)
        used_curr.add(ci)
        D[pi, :] = np.inf
        D[:, ci] = np.inf
    return matches


def build_tracks(annotations):
    """Return list of tracks, each track is a list of (frame_id, x, y)."""
    track_id_counter = 0
    # active_tracks: list of (track_id, last_frame, last_point)
    active_tracks = {}   # track_id -> list of (frame_id, x, y)
    last_frame_pts = {}  # track_id -> (x, y)

    all_frame_ids = sorted(annotations.keys())

    for fid in all_frame_ids:
        curr_pts = annotations[fid]
        prev_ids = list(last_frame_pts.keys())
        prev_pts = [last_frame_pts[tid] for tid in prev_ids]

        matches = greedy_match(prev_pts, curr_pts, MAX_MATCH_DIST)
        matched_prev = {m[0] for m in matches}
        matched_curr = {m[1] for m in matches}

        # Continue matched tracks
        for pi, ci in matches:
            tid = prev_ids[pi]
            active_tracks[tid].append((fid, curr_pts[ci][0], curr_pts[ci][1]))
            last_frame_pts[tid] = curr_pts[ci]

        # Kill unmatched previous tracks
        for i, tid in enumerate(prev_ids):
            if i not in matched_prev:
                del last_frame_pts[tid]

        # Spawn new tracks for unmatched current points
        for ci, pt in enumerate(curr_pts):
            if ci not in matched_curr:
                tid = track_id_counter
                track_id_counter += 1
                active_tracks[tid] = [(fid, pt[0], pt[1])]
                last_frame_pts[tid] = pt

    return list(active_tracks.values())


def draw(tracks, bg_frame, out_path):
    fig, ax = plt.subplots(figsize=(16, 9), dpi=120)
    ax.imshow(bg_frame)

    # Only draw tracks that span at least 5 frames (filter noise)
    long_tracks = [t for t in tracks if len(t) >= 5]
    print(f"  Total tracks: {len(tracks)}, tracks ≥5 frames: {len(long_tracks)}")

    colors = cm.hsv(np.linspace(0, 1, len(long_tracks)))
    np.random.shuffle(colors)

    for track, color in zip(long_tracks, colors):
        xs = [pt[1] for pt in track]
        ys = [pt[2] for pt in track]
        # Draw trail
        ax.plot(xs, ys, '-', color=color, linewidth=1.2, alpha=0.75)
        # Mark head at last known position
        ax.plot(xs[-1], ys[-1], 'o', color=color, markersize=3, alpha=0.9)

    ax.set_title(
        f"DroneCrowd — Sequence {SEQ_ID} | {len(long_tracks)} tracked individuals (≥5 frames)",
        fontsize=12, pad=8
    )
    ax.axis("off")
    fig.tight_layout(pad=0.5)
    fig.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close(fig)
    print(f"  Saved → {out_path}")


if __name__ == "__main__":
    print(f"Loading sequence {SEQ_ID}...")
    annotations = load_annotations(SEQ_ID)
    frame_ids = sorted(annotations.keys())
    print(f"  Frames: {len(frame_ids)}  |  Annotations total: {sum(len(v) for v in annotations.values())}")

    print("Building tracks...")
    tracks = build_tracks(annotations)

    mid_frame_id = frame_ids[len(frame_ids) // 2]
    print(f"  Using frame {mid_frame_id} as background")
    bg = load_frame(SEQ_ID, mid_frame_id)

    print("Rendering...")
    draw(tracks, bg, OUT_PATH)
