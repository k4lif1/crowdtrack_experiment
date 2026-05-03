# Crowd Segmentation & Movement Tracking — POC

---

## Dataset — DroneCrowd MOT (VisDrone, CVPR 2021)

**Paper:** [Detection, Tracking, and Counting Meets Drones in Crowds](https://openaccess.thecvf.com/content/CVPR2021/papers/Wen_Detection_Tracking_and_Counting_Meets_Drones_in_Crowds_A_Benchmark_CVPR_2021_paper.pdf)

All footage is 1920×1080, 25fps, captured from a drone at varying altitudes across 70 different outdoor scenes in Chinese cities. Each sequence is 300 frames (~12 seconds).

| Split | Sequences | Frames | Annotation format |
|-------|-----------|--------|-------------------|
| Train | 82 | 24,600 | `.mat` — `(x, y, person_id)` head points, persistent IDs |
| Val   | 30 | 360    | `.mat` — sparse (12 frames/seq) |
| Test  | 30 | 9,000  | `.xml` — bounding boxes with persistent `track_id` per frame |

**Train set highlights:**
- 15,347 unique tracked individuals across 82 sequences
- 147 people per frame on average; up to 455 in the densest scenes
- Person IDs are 100% persistent across all 300 frames of each sequence — no interpolation needed

The test set annotations are richer: full bounding boxes (not just head points) with occlusion flags, making them better suited for evaluating segmentation quality. Train annotations are head-point only, suited for trajectory and density work.

Dataset is not included in this repo — download separately:
- Google Drive: https://drive.google.com/drive/folders/1EUKLJ1WmrhWTNGt4wFLyHSfspJAt56WN
- Baidu Yun (code `ml1u`): https://pan.baidu.com/s/1hjXoVZJ16y9Tf7UXcJw3oQ

Expected local path after download: `data/dronecrowd/mot_full/`

---

## Dataset annotations vs. what the scripts produce

The raw dataset ships as images and annotation files — no visualizations. The annotation format differs between splits, and that difference directly affects what the rendering scripts can draw.

**Train / Val** annotations are one `.mat` file per frame (`GT_img{seq}{frame}.mat`). Each file contains a single `(N, 3)` array where the three columns are `x, y, person_id`. Only the head centre point is recorded — the dataset does not include bounding boxes for training data. Scripts working with train annotations draw a filled circle at the head position.

**Test** annotations are one `.xml` file per sequence. Each `<track id="N">` element holds a `<box>` per frame with `xtl, ytl, xbr, ybr` coordinates plus `outside` (person not in frame) and `occluded` flags. These are ground-truth bounding boxes, not model predictions. Scripts working with test annotations draw rectangles with a thinner stroke when occluded.

The rendering scripts layer the following on top of these raw coordinates:

- **Colour assignment** — each `person_id` gets a unique BGR colour from an evenly-spaced HSV palette, held constant across all frames of the sequence.
- **Motion trail** — the last 30 frame-centre positions are drawn as a fading polyline, giving a visual sense of direction and speed.
- **ID label** — the numeric track ID is printed above each annotation with a dark background for readability at high density.
- **HUD** — frame counter, sequence ID, and visible/total counts burned into the top-left corner.

---

## Tracking visualizer

`src/tracking_visualizer.py` is the primary script. It handles both splits through a single CLI and documents the annotation format differences inline.

```bash
# Test split — renders bounding boxes from XML ground truth
python src/tracking_visualizer.py --split test --seq 00062

# Train split — renders head-point dots from .mat ground truth
python src/tracking_visualizer.py --split train --seq 00001 00006 00040

# Custom output directory
python src/tracking_visualizer.py --split train --seq 00100 --out my_videos/
```

Output: `videos/tracking_{seq_id}.mp4` (test) or `videos/tracking_train_{seq_id}.mp4` (train).

---

## Validated videos

All sequences were rendered and manually reviewed by watching each video in full. Sequences where individual trajectories looked visually incorrect — misassigned IDs, erratic jumps, or tracks that clearly didn't correspond to real movement — were discarded. Only videos that passed this eye test are committed to the repo.

Rejected after review: `tracking_00011`, `tracking_00022`, `tracking_train_00008`.

<br>

<table>
  <tr>
    <td align="center" width="50%">
      <b>Test · Seq 00062 · 184 tracks · bounding boxes</b><br><br>
      <video src="videos/tracking_00062.mp4" poster="assets/previews/tracking_00062.jpg" controls width="100%"></video>
    </td>
    <td align="center" width="50%">
      <b>Train · Seq 00001 · 142 IDs · medium density</b><br><br>
      <video src="videos/tracking_train_00001.mp4" poster="assets/previews/tracking_train_00001.jpg" controls width="100%"></video>
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Train · Seq 00006 · 433 IDs · dense</b><br><br>
      <video src="videos/tracking_train_00006.mp4" poster="assets/previews/tracking_train_00006.jpg" controls width="100%"></video>
    </td>
    <td align="center">
      <b>Train · Seq 00040 · 150 IDs · varied scene</b><br><br>
      <video src="videos/tracking_train_00040.mp4" poster="assets/previews/tracking_train_00040.jpg" controls width="100%"></video>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <b>Train · Seq 00100 · 514 IDs · densest validated</b><br><br>
      <video src="videos/tracking_train_00100.mp4" poster="assets/previews/tracking_train_00100.jpg" controls width="50%"></video>
    </td>
  </tr>
</table>

---

## Scripts

```
src/
  tracking_visualizer.py          Unified tracking video renderer — test (XML bbox) and train (.mat head points)
  visualize_mot_trajectories.py   Static trajectory map + density heatmap (test split, matplotlib)
```

---

## Next Steps

- [ ] Integrate **SAM 3** (Meta, Nov 2025) for pixel-level instance segmentation — supports text prompts, unified detect + segment + track in a single forward pass
- [ ] Source a real live music event video from a static overhead angle for domain-specific validation
  - Leading candidates: Festival of Lights Lyon dataset (Zenodo, public, ~5k attendees overhead-tracked), BBC Glastonbury multi-camera webcam archive
  - Production plan: fixed venue camera replaces drone entirely
- [ ] Evaluate **YOLOv8 + ByteTrack** (pretrained on VisDrone) as a faster inference alternative to SAM 3 for real-time use
- [ ] Flow clustering to detect group movement patterns and crowd pressure buildup

---

## Stack

| Layer | Tool |
|-------|------|
| Segmentation | SAM 3 / SAM 3.1 |
| Detection + tracking | YOLOv8 + ByteTrack, pretrained on VisDrone |
| Optical flow | RAFT |
| Data loading | `scipy.io`, `xml.etree`, `opencv-python-headless` |
| Visualization | `matplotlib`, `opencv` |
| Dataset download | `gdown` |
