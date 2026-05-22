"""Object detection and multi-object tracking."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np


@dataclass
class Detection:
    x1: float
    y1: float
    x2: float
    y2: float
    score: float

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2


@dataclass
class TrackState:
    track_id: int
    last_det: Detection
    history: list[tuple[float, float, float]] = field(default_factory=list)  # t, cx, cy
    missed: int = 0


def _iou(a: Detection, b: Detection) -> float:
    ix1 = max(a.x1, b.x1)
    iy1 = max(a.y1, b.y1)
    ix2 = min(a.x2, b.x2)
    iy2 = min(a.y2, b.y2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (a.x2 - a.x1) * (a.y2 - a.y1)
    area_b = (b.x2 - b.x1) * (b.y2 - b.y1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class IoUTracker:
    """Simple IoU association tracker (ByteTrack-lite)."""

    def __init__(self, iou_thresh: float = 0.25, max_missed: int = 15) -> None:
        self.iou_thresh = iou_thresh
        self.max_missed = max_missed
        self._tracks: dict[int, TrackState] = {}
        self._next_id = 1

    def update(self, detections: list[Detection], t_sec: float) -> list[TrackState]:
        assigned: set[int] = set()
        for det in detections:
            best_id = None
            best_iou = self.iou_thresh
            for tid, tr in self._tracks.items():
                if tid in assigned:
                    continue
                iou = _iou(det, tr.last_det)
                if iou > best_iou:
                    best_iou = iou
                    best_id = tid
            if best_id is not None:
                tr = self._tracks[best_id]
                tr.last_det = det
                tr.history.append((t_sec, det.cx, det.cy))
                tr.missed = 0
                assigned.add(best_id)
            else:
                tid = self._next_id
                self._next_id += 1
                self._tracks[tid] = TrackState(
                    track_id=tid, last_det=det, history=[(t_sec, det.cx, det.cy)]
                )
                assigned.add(tid)

        to_drop: list[int] = []
        for tid, tr in self._tracks.items():
            if tid in assigned:
                continue
            tr.missed += 1
            if tr.missed > self.max_missed:
                to_drop.append(tid)
        for tid in to_drop:
            del self._tracks[tid]

        return list(self._tracks.values())


class YoloDetector:
    """Ultralytics YOLO — filters to vehicle-like COCO classes."""

    VEHICLE_CLASSES = {2, 3, 5, 7}  # car, motorcycle, bus, truck

    def __init__(self, model_name: str = "yolov8n.pt", conf: float = 0.25) -> None:
        from ultralytics import YOLO

        self.model = YOLO(model_name)
        self.conf = conf

    def detect(self, frame_bgr: np.ndarray) -> list[Detection]:
        results = self.model.predict(frame_bgr, conf=self.conf, verbose=False)
        dets: list[Detection] = []
        if not results:
            return dets
        r0 = results[0]
        if r0.boxes is None:
            return dets
        for box in r0.boxes:
            cls = int(box.cls.item())
            if cls not in self.VEHICLE_CLASSES:
                continue
            xyxy = box.xyxy[0].tolist()
            score = float(box.conf.item())
            dets.append(Detection(xyxy[0], xyxy[1], xyxy[2], xyxy[3], score))
        return dets


class MotionDetector:
    """Fallback when YOLO unavailable — MOG2 blobs."""

    def __init__(self, min_area: int = 120) -> None:
        self.bg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=40, detectShadows=False)
        self.min_area = min_area

    def detect(self, frame_bgr: np.ndarray) -> list[Detection]:
        mask = self.bg.apply(frame_bgr)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        dets: list[Detection] = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < self.min_area:
                continue
            x, y, w, h = cv2.boundingRect(c)
            if w < 8 or h < 8:
                continue
            aspect = w / max(h, 1)
            if aspect < 0.4 or aspect > 4.0:
                continue
            dets.append(Detection(float(x), float(y), float(x + w), float(y + h), min(1.0, area / 5000)))
        return dets


def create_detector(prefer_yolo: bool = True) -> Any:
    if prefer_yolo:
        try:
            return YoloDetector()
        except Exception:
            pass
    return MotionDetector()
