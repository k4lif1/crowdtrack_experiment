# Crowd Segmentation & Movement Tracking — POC

A research experiment for tracking and segmenting individual movement in dense crowds during live music events, using drone top-down footage.

---

## Research Goal

Build a pipeline that can:
1. Ingest a static top-down drone shot of a live music crowd
2. Segment individual people from one another
3. Track each person's movement trajectory over time
4. Visualize motion patterns, flow, and density

The intended production setup is a **fixed overhead camera** mounted on a truss or crane arm at a venue — giving an unlimited-runtime static top-down view without drone battery/airspace constraints.

---

## Dataset — DroneCrowd (VisDrone CVPR 2021)

**Paper:** [Detection, Tracking, and Counting Meets Drones in Crowds (CVPR 2021)](https://openaccess.thecvf.com/content/CVPR2021/papers/Wen_Detection_Tracking_and_Counting_Meets_Drones_in_Crowds_A_Benchmark_CVPR_2021_paper.pdf)

Two sub-datasets are used:

### Crowd Counting (CC) — Challenge Version
- 112 sequences, ~30 frames each at 1920×1080
- Annotations: `frame, x, y` head-point per person (no persistent IDs)
- Used for: initial trajectory reconstruction via nearest-neighbour matching

### Multi-Object Tracking (MOT) — Full Version
| Split | Sequences | Frames | Annotation format |
|-------|-----------|--------|-------------------|
| Train | 82 | 24,600 | `.mat` files — `(x, y, person_id)` head points with persistent IDs |
| Val   | 30 | 360    | `.mat` files — sparse (12 frames/seq) |
| Test  | 30 | 9,000  | XML files — `<track id>` bounding boxes across 300 frames/seq |

**Key stats (train set):**
- 15,347 unique tracked individuals
- Average 147 people per frame
- Maximum 455 people in a single frame (seq 008)
- 100% ID persistence across consecutive frames (verified)

Dataset is not included in this repo. Download links:
- Google Drive (full): https://drive.google.com/drive/folders/1EUKLJ1WmrhWTNGt4wFLyHSfspJAt56WN
- CC challenge: https://drive.google.com/file/d/1HY3V4QObrVjzXUxL_J86oxn2bi7FMUgd/view
- Baidu Yun (full, code `ml1u`): https://pan.baidu.com/s/1hjXoVZJ16y9Tf7UXcJw3oQ

---

## Directory Structure

```
dor_seg_exp/
├── src/
│   ├── visualize_trajectories.py       # CC challenge — NN-matched trajectory overlay (static image)
│   ├── visualize_mot_trajectories.py   # MOT test set — ground-truth XML trajectory overlay (static image)
│   ├── render_tracking_video.py        # MOT test set — annotated tracking video renderer
│   └── render_train_video.py           # MOT train set — annotated tracking video renderer
├── assets/
│   ├── trajectory_viz.png              # CC challenge visualization (seq 00009)
│   └── trajectory_mot_viz.png          # MOT ground-truth + heatmap (seq 00011)
├── videos/
│   ├── tracking_00062.mp4              # Test seq 00062 — 184 tracks, 300 frames
│   ├── tracking_train_00001.mp4        # Train seq 00001 — 142 IDs, medium density
│   ├── tracking_train_00006.mp4        # Train seq 00006 — 433 IDs, dense
│   ├── tracking_train_00040.mp4        # Train seq 00040 — 150 IDs, varied scene
│   └── tracking_train_00100.mp4        # Train seq 00100 — 514 IDs, densest
└── data/                               # (gitignored — download separately)
    └── dronecrowd/
        ├── VisDrone2020-CC/            # CC challenge split
        └── mot_full/                   # MOT full dataset
            ├── annotations/            # 112 XML files (test + val ground truth)
            ├── train_data/             # images + .mat GT (82 sequences)
            ├── val_data/               # images + .mat GT (30 sequences, sparse)
            └── test_data/              # images + XML GT (30 sequences, 300 frames each)
```

---

## Visualization Pipeline

### Static image (trajectory map + heatmap)
```bash
python src/visualize_mot_trajectories.py
# Output: trajectory_mot_viz.png
# Shows all trajectories overlaid on a mid-sequence frame + movement density heatmap
```

### Tracking video (color-coded individuals)
```bash
# For MOT test sequences (XML bounding boxes)
python src/render_tracking_video.py

# For MOT train sequences (.mat head points)
python src/render_train_video.py
```

Each video frame shows:
- **Unique color per person ID** — consistent across all frames
- **ID number label** on every visible individual
- **Motion trail** — last 30 frames of each person's path
- **Frame counter + visible/total track counts**

---

## Next Steps

- [ ] Integrate **SAM 3** (Meta, released Nov 2025) for pixel-level crowd segmentation
- [ ] Source a static top-down live music event video for domain-specific testing
  - Candidates: Festival of Lights Lyon (Zenodo, public), BBC Glastonbury webcam, stock footage
  - Production plan: fixed camera on venue truss (eliminates drone battery/airspace limits)
- [ ] Download remaining MOT train/val frames once Google Drive quota resets
- [ ] Experiment with flow clustering to identify group behavior patterns

---

## Tools & Models Considered

| Task | Tool | Notes |
|------|------|-------|
| Instance segmentation | SAM 3 / SAM 3.1 | Text-prompted, unified detect+segment+track |
| Detection + tracking | YOLOv8 + ByteTrack | Fast, strong on small aerial pedestrians |
| Optical flow | RAFT / DIS | Per-person trajectory smoothing |
| Pretrained weights | VisDrone YOLOv8 | Fine-tuned on drone crowd data |

---

## Requirements

```
opencv-python-headless
matplotlib
scipy
Pillow
gdown
```
