# Crowd Tracking — DroneCrowd POC

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

---

## Annotation formats

**Train/Val** — one `.mat` per frame, `(N, 3)` array: `[x, y, person_id]`. Head centre only, no bounding box. Scripts draw a filled circle.

**Test** — one `.xml` per sequence. Each `<track id="N">` holds a `<box>` per frame: `xtl, ytl, xbr, ybr`, `outside`, `occluded`. Ground-truth boxes, not predictions.

Both formats get the same rendering layers: per-ID HSV colour, 30-frame fading motion trail, ID label, frame-count HUD.

---

## Video outputs

```
videos/
  source/         Raw frames — no overlays
  gt_tracking/    Ground-truth annotations (boxes / head dots, colour-coded per ID)
  yolo_tracking/  Model predictions — YOLOv8-VisDrone + SAHI + ByteTrack (no GT used)
```

---

## Scripts

```bash
# GT annotation overlay → videos/gt_tracking/
python src/tracking_visualizer.py --split test --seq 00062
python src/tracking_visualizer.py --split train --seq 00001 00006 00040 00100

# Raw source video (no annotations) → videos/source/
python src/tracking_visualizer.py --split test --seq 00062 --raw

# YOLO+SAHI+ByteTrack prediction → videos/yolo_tracking/
source venv_sam3/bin/activate
python src/yolo_tracker.py --seq 00062 --frames 60
python src/yolo_tracker.py --seq 00062 --frames 300 --conf 0.2
```

**`yolo_tracker.py`** — YOLOv8l fine-tuned on VisDrone ([mshamrai/yolov8l-visdrone](https://huggingface.co/mshamrai/yolov8l-visdrone)), sliced through SAHI (640×640 tiles, 20% overlap) to handle tiny aerial people, tracked with ByteTrack. Runs on MPS (Apple Silicon) at ~2 fps.

---

## Validated GT videos

Rendered and manually reviewed. Rejected for visual inconsistencies (ID swaps, erratic jumps): `tracking_00011`, `tracking_00022`, `tracking_train_00008`.

---

## Next Steps

- [ ] Quantitative evaluation — run YOLO tracker on full 300-frame sequences, score against GT with MOTA / MOTP / IDF1
- [ ] Real venue footage — static overhead recording of a live music event (Festival of Lights Lyon on Zenodo, Glastonbury webcam archive)
- [ ] Flow clustering — group tracklet velocities to detect crowd pressure buildup, bottlenecks, and directional flow patterns

---

## Stack

| Layer | Tool |
|-------|------|
| Detection | YOLOv8l, fine-tuned on VisDrone |
| Sliced inference | SAHI (640×640 tiles) |
| Tracking | ByteTrack (via supervision) |
| Data loading | `scipy.io`, `xml.etree`, `opencv-python-headless` |
| Visualization | `opencv`, `matplotlib` |
