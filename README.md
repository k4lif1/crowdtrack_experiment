# Crowd Tracking — DroneCrowd POC

## What you're looking at

The five videos below are rendered by `src/tracking_visualizer.py` from the **ground-truth annotations** that ship with the DroneCrowd dataset. The script reads the XML/`.mat` files, draws colour-coded boxes (or head dots) per `person_id`, adds motion trails and a HUD, and exports an MP4 — pure visualization, no model involved.

**The work in progress** (see [Reconstruction pipeline](#reconstruction-pipeline) below) is reproducing those same results from the raw video using detection + tracking. Once it works end-to-end, the same pipeline runs on any overhead crowd video — not just sequences that ship with annotations.

---

## Ground-truth videos (rendered from dataset annotations)

<table>
  <tr>
    <td align="center" width="50%">
      <b>Test · Seq 00062 · 184 tracks · bounding boxes</b><br><br>
      <video src="videos/gt_tracking/tracking_00062.mp4" poster="assets/previews/tracking_00062.jpg" controls width="100%"></video>
    </td>
    <td align="center" width="50%">
      <b>Train · Seq 00001 · 142 IDs · medium density</b><br><br>
      <video src="videos/gt_tracking/tracking_train_00001.mp4" poster="assets/previews/tracking_train_00001.jpg" controls width="100%"></video>
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Train · Seq 00006 · 433 IDs · dense</b><br><br>
      <video src="videos/gt_tracking/tracking_train_00006.mp4" poster="assets/previews/tracking_train_00006.jpg" controls width="100%"></video>
    </td>
    <td align="center">
      <b>Train · Seq 00040 · 150 IDs · varied scene</b><br><br>
      <video src="videos/gt_tracking/tracking_train_00040.mp4" poster="assets/previews/tracking_train_00040.jpg" controls width="100%"></video>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <b>Train · Seq 00100 · 514 IDs · densest validated</b><br><br>
      <video src="videos/gt_tracking/tracking_train_00100.mp4" poster="assets/previews/tracking_train_00100.jpg" controls width="50%"></video>
    </td>
  </tr>
</table>

Manually reviewed; rejected for visible ID swaps or erratic motion: `tracking_00011`, `tracking_00022`, `tracking_train_00008`.

---

## Reconstruction pipeline

`src/yolo_tracker.py` reproduces the GT tracking format from raw video alone — no annotations, just pixels. Three stages:

1. **YOLOv8l fine-tuned on VisDrone** ([mshamrai/yolov8l-visdrone](https://huggingface.co/mshamrai/yolov8l-visdrone)) — same dataset family as our footage.
2. **SAHI sliced inference** — slice each 1920×1080 frame into overlapping 640×640 tiles before detection so YOLO sees a useful pixel density on tiny aerial people.
3. **ByteTrack + post-processing** — assigns IDs across frames, then a custom stitch + interpolate pass merges fragments that drop and reappear nearby.

### Latest result (seq 00062, first 60 frames)

| Stage | Unique IDs | Notes |
|---|---|---|
| Raw ByteTrack output | **301** | heavy fragmentation — same person gets new ID after each detection miss |
| After stitch + interpolate | **189** | merge fragments where end→start is close in time and space, fill gaps linearly |
| GT (target) | **184** | |

The stitch step closes 112 fragment merges and interpolates 1,413 missing-frame boxes. Stitching uses two compatibility checks: a relative bound (`box_size × time_gap × 0.5`) and an absolute velocity cap (12 px/frame ≈ fast running) — the latter prevents large boxes teleporting across the frame purely because they're large. The remaining gap to GT (189 vs 184) is mostly detection recall, not tracking.

### Running it

```bash
source venv_sam3/bin/activate

python src/yolo_tracker.py --seq 00062 --frames 60          # ~30s on M4 Pro MPS
python src/yolo_tracker.py --seq 00062 --frames 300         # full sequence
python src/yolo_tracker.py --seq 00062 --stitch-gap 0       # disable stitching to compare

# Side-by-side GT vs reconstruction:
python src/compare.py videos/gt_tracking/tracking_00062.mp4 \
                      videos/yolo_tracking/yolo_00062.mp4 \
                      --out videos/comparison/compare_00062.mp4
```

---

## Dataset — DroneCrowd MOT (VisDrone, CVPR 2021)

**Paper:** [Detection, Tracking, and Counting Meets Drones in Crowds](https://openaccess.thecvf.com/content/CVPR2021/papers/Wen_Detection_Tracking_and_Counting_Meets_Drones_in_Crowds_A_Benchmark_CVPR_2021_paper.pdf)

1920×1080, 25 fps, 70 outdoor scenes, 300 frames per sequence (~12 sec).

| Split | Sequences | Frames | Annotations |
|-------|-----------|--------|-------------|
| Train | 82 | 24,600 | `.mat` — `(x, y, person_id)` head points |
| Val   | 30 | 360    | `.mat` — sparse (12 frames/seq) |
| Test  | 30 | 9,000  | `.xml` — bounding boxes with persistent `track_id` |

Train: 15,347 unique IDs · 147 people/frame avg · up to 455 in the densest scenes · IDs persistent across all 300 frames.

Download: [Google Drive](https://drive.google.com/drive/folders/1EUKLJ1WmrhWTNGt4wFLyHSfspJAt56WN) · [Baidu Yun](https://pan.baidu.com/s/1hjXoVZJ16y9Tf7UXcJw3oQ) (code `ml1u`) → `data/dronecrowd/mot_full/`

**Annotation formats** — train/val store one `.mat` per frame with head-only `(x, y, person_id)`; test stores one XML per sequence with full `xtl, ytl, xbr, ybr` boxes plus `outside` and `occluded` flags. The visualizer handles both.

---

## Video outputs

```
videos/
  source/         Raw frames — no overlays
  gt_tracking/    Dataset annotations rendered as colour-coded ID boxes + trails
  yolo_tracking/  Pipeline reconstruction — YOLO + SAHI + ByteTrack + stitching
  comparison/     Side-by-side GT vs reconstruction
```

---

## Scripts

```
src/
  tracking_visualizer.py    GT renderer — read XML/.mat, draw IDs, write MP4
  yolo_tracker.py           Reconstruction pipeline — raw video → tracked IDs
  compare.py                Side-by-side video stack of any two outputs
```

---

## Next Steps

- [ ] Run the reconstruction pipeline on full 300-frame sequences and score MOTA / MOTP / IDF1 against GT
- [ ] Apply the pipeline to a real venue recording (static overhead camera, music event) — the eventual production target
- [ ] Flow clustering on tracked velocities to detect crowd pressure, bottlenecks, directional flow

---

## Stack

| Layer | Tool |
|-------|------|
| Detection | YOLOv8l, fine-tuned on VisDrone |
| Sliced inference | SAHI (640×640 tiles) |
| Tracking | ByteTrack via `supervision`, custom stitching pass |
| Data loading | `scipy.io`, `xml.etree`, `opencv-python-headless` |
| Visualization | `opencv` |
