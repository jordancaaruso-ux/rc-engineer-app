# Auto sector detection — build plan

Status: **planned, not started** (2026-07-21). Detector is proven; nothing is ported yet.
Background: `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`, `docs/VIDEO_TRACE_NORTH_STAR.md`.

## Where we are

- The detector works. Validated on two drivers, same video: 5ms median error vs hand marks,
  and the second driver needed **zero** corner marks — just the first driver's lines.
- It currently runs as an **offline Python script on Jordan's desktop**. Python was chosen because
  the probe was an experiment (OpenCV/numpy = fast to iterate), not because it's the right home.
- Nothing about it is in the app yet.
- Converged recipe `b22-t14`: `band_frac 0.022, extend 0.35, thresh 14, min_area 12, blur 5,
  sel=nearest`. Blurred max-channel colour diff → rotated band mask hugging the line → blob
  closest to the line → sign-flip crossing, sub-frame interpolated.
- Truth set + scripts preserved at `C:\Users\Jordan\Documents\rc-autosnap-results\`.

## The lane we're building

**Client-side WebCodecs.** Port the detector to TypeScript, decode the video in the browser with
`VideoDecoder` (straight through, no seeking), sample only the thin band strips per frame.

Rejected:
- **Server-side** (the existing Python worker): requires uploading a ~1GB heat video before you get
  an answer. Dead trackside. Also contradicts the local-first storage ruling.
- **Native iOS plugin** (AVAssetReader): fastest on phone but iPhone-only, needs TestFlight for
  every change, does nothing for laptops or Android. Possible later accelerator, not the foundation.

### Why the performance works
Python decodes every 4K frame and runs numpy over the whole thing (~2.5 min per lap, ~47 min for a
19-lap run). In the browser, hardware decode does 4K at roughly 100–200fps → a ~700s heat in a few
minutes. And `VideoFrame.copyTo()` takes a rect, so we sample a few thousand pixels per line
instead of 8M per frame.

### "Phone: no" was answering a different question
The failed phone test (`src/app/debug/video-decode-test/page.tsx`) measured `<video>` +
`currentTime` seeking + rVFC — seeks stalled 25s+ on a 1.7GB 4K file. That's Safari's playback
random-access path, which the WebCodecs lane doesn't use at all. **Phone is untested, not ruled out.**

## Steps

1. **Port + re-validate. No UI.** TS detector + WebCodecs decode, run headless via CDP against
   `IMG_4044.MOV`, grade against the preserved truth set (34 Cooper crossings, 5ms median to beat).
   This is the whole de-risk — everything after it is plumbing. **Only step with real uncertainty.**
2. **Re-test phone properly** — new debug page measuring WebCodecs throughput, not seek latency.
   Gives a real yes/no on phones.
3. **"Find crossings" in the Mark step** of `AnalyzeFlowClient` — pre-fills marks, shows confidence,
   manual marking stays available as fallback.
4. **Capability gate** — `VideoDecoder.isConfigSupported()` + a throughput probe decides whether the
   button is offered, degraded ("scan 3 laps"), or hidden with a plain reason.

## Must-handle gotchas (from the two-driver validation)

1. **Never drop excluded/incident laps from the lap-time walk.** They still consume real time;
   dropping them shifted every later prediction by 20–50s and collapsed detection. `videoTimeAtLapSf`
   must use the complete lap list even when the UI excludes some laps from stats.
2. **Bin crossings by SF interval.** In-lap offsets can exceed lap time and wrap into the next lap.
   Grade per-line, never by corner sequence — sequence checks fire false alarms.
3. **Line placement beats detector tuning.** Lines in the fisheye-distorted, low-contrast frame edge
   caused nearly every non-structural miss. Steer users to the clear centre of frame.
4. **Show "not found" honestly.** Incident laps genuinely have no normal crossing. Never invent a time.

## Known risks

- **Codecs, not speed, is the biggest seamlessness risk.** iPhones record HEVC by default; Chrome on
  Windows often can't decode it without the OS HEVC extension. Pre-flight with
  `isConfigSupported()` so it fails clearly. Advise filming **1080p60 H.264** ("Most Compatible") —
  decodes everywhere, decodes faster, and halves timing error vs the current 31.5fps footage.
- **Lines are per camera position.** A new user draws them once (~2 min); every driver after that is
  free. Auto-transferring lines across camera angles via the worker's homography (`align.py`) is v2.
