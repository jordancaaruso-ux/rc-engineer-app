"""Align new session frame to reference via ORB + homography."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def compute_alignment(
    reference_bgr: np.ndarray,
    query_bgr: np.ndarray,
    max_features: int = 4000,
) -> dict[str, Any]:
    """Return homography (query -> reference) and quality metrics."""
    ref_gray = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2GRAY)
    qry_gray = cv2.cvtColor(query_bgr, cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=max_features)
    kp1, des1 = orb.detectAndCompute(ref_gray, None)
    kp2, des2 = orb.detectAndCompute(qry_gray, None)

    if des1 is None or des2 is None or len(kp1) < 8 or len(kp2) < 8:
        return {
            "ok": False,
            "error": "insufficient_features",
            "inlier_ratio": 0.0,
            "reprojection_error_px": None,
            "homography": None,
        }

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    matches = sorted(matches, key=lambda m: m.distance)[:500]
    if len(matches) < 8:
        return {
            "ok": False,
            "error": "insufficient_matches",
            "inlier_ratio": 0.0,
            "reprojection_error_px": None,
            "homography": None,
        }

    src_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)

    h_mat, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    if h_mat is None:
        return {
            "ok": False,
            "error": "homography_failed",
            "inlier_ratio": 0.0,
            "reprojection_error_px": None,
            "homography": None,
        }

    inliers = int(mask.sum()) if mask is not None else 0
    inlier_ratio = inliers / max(len(matches), 1)

    reproj_errors: list[float] = []
    for m, inl in zip(matches, mask.ravel() if mask is not None else []):
        if not inl:
            continue
        p_q = np.array([*kp2[m.trainIdx].pt, 1.0])
        p_r = np.array([*kp1[m.queryIdx].pt, 1.0])
        warped = h_mat @ p_q
        warped = warped[:2] / warped[2]
        reproj_errors.append(float(np.linalg.norm(warped - p_r[:2])))

    reproj = float(np.median(reproj_errors)) if reproj_errors else None

    return {
        "ok": inlier_ratio >= 0.25 and (reproj is None or reproj < 12.0),
        "error": None if inlier_ratio >= 0.25 else "low_inlier_ratio",
        "inlier_ratio": round(inlier_ratio, 4),
        "reprojection_error_px": round(reproj, 3) if reproj is not None else None,
        "homography": h_mat.tolist(),
        "match_count": len(matches),
        "inlier_count": inliers,
    }
