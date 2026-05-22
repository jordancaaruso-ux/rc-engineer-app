# RC video sector timing (Python worker)

Post-session analysis: detect cars, track IDs, record sector line crossings, export JSON for [rc-engineer-app](../README.md).

## Setup

```bash
cd video-analysis
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

## Phase 0 — validate on your footage

1. Record **1080p60** fisheye heat from a **fixed mount** (slight drift is OK).
2. Export a **reference still** (frame 0) and save sector lines in `examples/config.example.json` (normalized 0–1 coords).
3. Export LiveRC / transponder laps to CSV (`lap_number`, `lap_time_sec`).

```bash
# Alignment only
python -m rc_video_analysis align --reference reference.jpg --video heat.mp4 --output align.json

# Full analysis (sample every 2 frames for speed)
python -m rc_video_analysis analyze --video heat.mp4 --config my-config.json --output results.json --sample-every 2

# Compare to transponder
python -m rc_video_analysis validate --results results.json --transponder laps.csv --output report.json
```

**Stop/go gate:** `passesGate0_15` in validate report — median lap delta ≤ 0.15 s and ≥ 80% laps within 0.15 s.

Use `--motion-only` if YOLO weights are unavailable (worse on full heats, OK for single-car motion tests).

## JSON contract (version 1)

Imported by the app via **Video analysis → Import worker JSON**. Fields: `version`, `tracks[]` with `motTrackId`, `laps[]`, `sectorTimesSec`, `idSwapHints`, `alignment`, `homography`.

## Footage checklist

- [ ] 2–3 heats at the same track with LiveRC link
- [ ] Same camera position (mark mount on stand)
- [ ] Start/finish line drawn across the timing straight (centroid crossing ≈ loop plane)
