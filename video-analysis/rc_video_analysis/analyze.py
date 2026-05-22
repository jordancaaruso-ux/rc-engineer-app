"""Main analysis pipeline."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from rc_video_analysis.align import compute_alignment
from rc_video_analysis.geometry import NormLine, crossing_time_between_frames, warp_point
from rc_video_analysis.tracker import IoUTracker, create_detector


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def parse_sector_lines(cfg: dict[str, Any]) -> list[NormLine]:
    lines: list[NormLine] = []
    for item in cfg.get("sector_lines", []):
        lines.append(
            NormLine(
                id=str(item["id"]),
                label=str(item.get("label", item["id"])),
                x1=float(item["x1"]),
                y1=float(item["y1"]),
                x2=float(item["x2"]),
                y2=float(item["y2"]),
            )
        )
    return lines


def analyze_video(
    video_path: Path,
    config: dict[str, Any],
    *,
    sample_every_n: int = 1,
    max_frames: int | None = None,
    prefer_yolo: bool = True,
) -> dict[str, Any]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {video_path}")

    fps = float(config.get("fps") or cap.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sector_lines = parse_sector_lines(config)

    ref_path = config.get("reference_frame_path")
    homography = config.get("homography")
    alignment_meta: dict[str, Any] | None = None

    ret, first_frame = cap.read()
    if not ret:
        cap.release()
        raise RuntimeError("Empty video")

    if ref_path and not homography:
        ref_img = cv2.imread(str(ref_path))
        if ref_img is not None:
            alignment_meta = compute_alignment(ref_img, first_frame)
            if alignment_meta.get("homography"):
                homography = alignment_meta["homography"]
    elif config.get("align_reference_path") and not homography:
        ref_img = cv2.imread(str(config["align_reference_path"]))
        if ref_img is not None:
            alignment_meta = compute_alignment(ref_img, first_frame)
            if alignment_meta.get("homography"):
                homography = alignment_meta["homography"]

    # Pixel lines on reference; warp endpoints to query frame via inverse H
    h_inv = None
    if homography is not None:
        h = np.array(homography, dtype=np.float64)
        try:
            h_inv = np.linalg.inv(h)
        except np.linalg.LinAlgError:
            h_inv = None

    def line_in_frame(norm_line: NormLine) -> tuple[float, float, float, float]:
        px = norm_line.to_pixels(width, height)
        if h_inv is None:
            return px
        pts = []
        for x, y in ((px[0], px[1]), (px[2], px[3])):
            pt = np.array([x, y, 1.0])
            out = h_inv @ pt
            pts.extend([float(out[0] / out[2]), float(out[1] / out[2])])
        return tuple(pts)  # type: ignore

    pixel_lines = {ln.id: line_in_frame(ln) for ln in sector_lines}

    detector = create_detector(prefer_yolo=prefer_yolo)
    tracker = IoUTracker()
    crossings: dict[int, dict[str, list[float]]] = {}  # track_id -> line_id -> [times]
    frame_idx = 0
    processed = 0
    id_swap_hints: list[dict[str, Any]] = []

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every_n != 0:
            frame_idx += 1
            continue
        if max_frames is not None and processed >= max_frames:
            break

        t_sec = frame_idx / fps
        dets = detector.detect(frame)
        tracks = tracker.update(dets, t_sec)

        for tr in tracks:
            tid = tr.track_id
            if len(tr.history) < 2:
                continue
            t_prev, cx_prev, cy_prev = tr.history[-2]
            t_curr, cx_curr, cy_curr = tr.history[-1]
            for line_id, line_px in pixel_lines.items():
                ct = crossing_time_between_frames(
                    t_prev, t_curr, (cx_prev, cy_prev), (cx_curr, cy_curr), line_px
                )
                if ct is None:
                    continue
                crossings.setdefault(tid, {}).setdefault(line_id, []).append(ct)

        frame_idx += 1
        processed += 1

    cap.release()

    # Build laps from start/finish line crossings
    sf_id = config.get("start_finish_line_id", "sf")
    track_results: list[dict[str, Any]] = []
    for tid, line_times in crossings.items():
        sf_times = sorted(line_times.get(sf_id, []))
        laps: list[dict[str, Any]] = []
        for i in range(1, len(sf_times)):
            lap_start = sf_times[i - 1]
            lap_end = sf_times[i]
            lap_time = lap_end - lap_start
            if lap_time < 3.0 or lap_time > 120.0:
                continue
            sectors: dict[str, float] = {}
            for line_id, times in line_times.items():
                if line_id == sf_id:
                    continue
                in_lap = [t for t in times if lap_start < t < lap_end]
                if len(in_lap) >= 1:
                    # sector time = first crossing after previous sector boundary
                    sectors[line_id] = round(in_lap[0] - lap_start, 4)
            laps.append(
                {
                    "lapIndex": len(laps) + 1,
                    "lapTimeSec": round(lap_time, 4),
                    "startSec": round(lap_start, 4),
                    "endSec": round(lap_end, 4),
                    "sectorTimesSec": sectors,
                }
            )
        if laps:
            best = min(laps, key=lambda l: l["lapTimeSec"])
            track_results.append(
                {
                    "motTrackId": tid,
                    "lapCount": len(laps),
                    "bestLapSec": best["lapTimeSec"],
                    "laps": laps,
                    "crossingCount": sum(len(v) for v in line_times.values()),
                }
            )

    # Heuristic ID swap hint: tracks with very close crossing times on same line
    for line_id in pixel_lines:
        events: list[tuple[float, int]] = []
        for tid, lt in crossings.items():
            for t in lt.get(line_id, []):
                events.append((t, tid))
        events.sort()
        for j in range(1, len(events)):
            if events[j][0] - events[j - 1][0] < 0.05 and events[j][1] != events[j - 1][1]:
                id_swap_hints.append(
                    {
                        "lineId": line_id,
                        "timeSec": round(events[j][0], 3),
                        "trackIds": [events[j - 1][1], events[j][1]],
                    }
                )

    sector_defs = [
        {"id": ln.id, "label": ln.label, "x1": ln.x1, "y1": ln.y1, "x2": ln.x2, "y2": ln.y2}
        for ln in sector_lines
    ]

    return {
        "version": 1,
        "videoPath": str(video_path),
        "fps": fps,
        "frameSize": {"width": width, "height": height},
        "framesProcessed": processed,
        "alignment": alignment_meta,
        "homography": homography,
        "sectorLines": sector_defs,
        "tracks": track_results,
        "idSwapHints": id_swap_hints[:200],
        "detector": type(detector).__name__,
    }


def write_results(data: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
