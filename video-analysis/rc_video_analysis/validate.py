"""Compare video-derived lap times to transponder / LiveRC CSV."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def load_transponder_csv(path: Path) -> list[dict[str, Any]]:
    """CSV columns: lap_number, lap_time_sec [, driver]"""
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lap_num = int(row.get("lap_number") or row.get("lapNumber") or row.get("lap") or 0)
            t = float(row.get("lap_time_sec") or row.get("lapTimeSec") or row.get("time") or 0)
            if lap_num > 0 and t > 0:
                rows.append({"lapNumber": lap_num, "lapTimeSec": t, "driver": row.get("driver")})
    return rows


def validate_results(
    results: dict[str, Any],
    transponder_laps: list[dict[str, Any]],
    *,
    mot_track_id: int | None = None,
) -> dict[str, Any]:
    tracks = results.get("tracks", [])
    if not tracks:
        return {"ok": False, "error": "no_tracks_in_results"}

    if mot_track_id is not None:
        target = next((t for t in tracks if t["motTrackId"] == mot_track_id), None)
    else:
        target = max(tracks, key=lambda t: t.get("lapCount", 0))

    if not target:
        return {"ok": False, "error": "track_not_found"}

    video_laps = sorted(target.get("laps", []), key=lambda l: l["lapIndex"])
    video_times = [l["lapTimeSec"] for l in video_laps]
    ref_times = [r["lapTimeSec"] for r in sorted(transponder_laps, key=lambda r: r["lapNumber"])]

    n = min(len(video_times), len(ref_times))
    deltas = [abs(video_times[i] - ref_times[i]) for i in range(n)]
    median_delta = sorted(deltas)[len(deltas) // 2] if deltas else None
    within_015 = sum(1 for d in deltas if d <= 0.15)
    within_025 = sum(1 for d in deltas if d <= 0.25)

    return {
        "ok": True,
        "motTrackId": target["motTrackId"],
        "comparedLaps": n,
        "medianDeltaSec": round(median_delta, 4) if median_delta is not None else None,
        "pctWithin0_15s": round(within_015 / n, 3) if n else 0,
        "pctWithin0_25s": round(within_025 / n, 3) if n else 0,
        "deltasSec": [round(d, 4) for d in deltas],
        "videoLapTimesSec": video_times[:n],
        "transponderLapTimesSec": ref_times[:n],
        "idSwapHintCount": len(results.get("idSwapHints", [])),
        "passesGate0_15": median_delta is not None and median_delta <= 0.15 and (within_015 / max(n, 1)) >= 0.8,
    }
