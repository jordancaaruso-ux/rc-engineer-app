"""Line geometry and crossing detection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class NormLine:
    """Line segment in normalized [0,1] reference coordinates."""

    id: str
    label: str
    x1: float
    y1: float
    x2: float
    y2: float

    def to_pixels(self, width: int, height: int) -> tuple[float, float, float, float]:
        return (
            self.x1 * width,
            self.y1 * height,
            self.x2 * width,
            self.y2 * height,
        )


def _orient(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_intersect(
    p1: tuple[float, float],
    p2: tuple[float, float],
    q1: tuple[float, float],
    q2: tuple[float, float],
) -> bool:
    o1 = _orient(p1, p2, q1)
    o2 = _orient(p1, p2, q2)
    o3 = _orient(q1, q2, p1)
    o4 = _orient(q1, q2, p2)
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    return False


def crossing_time_between_frames(
    t_prev: float,
    t_curr: float,
    p_prev: tuple[float, float],
    p_curr: tuple[float, float],
    line: tuple[float, float, float, float],
) -> float | None:
    """Return interpolated crossing time if path segment crosses line segment."""
    lx1, ly1, lx2, ly2 = line
    if not segments_intersect(p_prev, p_curr, (lx1, ly1), (lx2, ly2)):
        return None
    # Linear interpolation along motion for sub-frame estimate
    dx = p_curr[0] - p_prev[0]
    dy = p_curr[1] - p_prev[1]
    denom = dx * dx + dy * dy
    if denom < 1e-9:
        return t_curr
    # Project to midpoint of segment as simple estimate
    alpha = 0.5
    for _ in range(8):
        mid = (p_prev[0] + alpha * dx, p_prev[1] + alpha * dy)
        # binary search for crossing
        test_prev = p_prev if alpha > 0.5 else mid
        test_curr = mid if alpha > 0.5 else p_curr
        if segments_intersect(test_prev, test_curr, (lx1, ly1), (lx2, ly2)):
            alpha *= 0.5
        else:
            alpha = alpha + (1 - alpha) * 0.5
    return t_prev + alpha * (t_curr - t_prev)


def warp_point(
    x: float, y: float, homography: list[list[float]] | None
) -> tuple[float, float]:
    if homography is None:
        return x, y
    import numpy as np

    h = np.array(homography, dtype=np.float64)
    pt = np.array([x, y, 1.0], dtype=np.float64)
    out = h @ pt
    if abs(out[2]) < 1e-9:
        return x, y
    return float(out[0] / out[2]), float(out[1] / out[2])
