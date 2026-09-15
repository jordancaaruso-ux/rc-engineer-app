# The race pass — build plan

Status: **a measurement rig, not a product path — for now** (2026-09-09). Naming laps by the timing sheet works to a frame and stays available at `/debug/race-pass`; nothing is wired into the scan button, on purpose: the strip scan already measures every seated driver's start-line crossings itself, and the pass cannot write a rival's (no role key), so wiring it would cost a minute of decoding per scan for a trust line. The sector half is not continuous enough to read a corner off, and a full-resolution tracer seeded from the pass's exact starts is not either on race footage — see the two 2026-09-09 entries before touching any of it.
Background: `docs/VIDEO_TRACE_NORTH_STAR.md` (trust and capture doctrine),
`docs/SECTOR_COMPARE_NORTH_STAR.md`, `docs/VIDEO_AUTO_SECTORS_PLAN.md` (status of what is built).
Every line in the "Reuse" table was checked against the tree on 2026-09-08.

## What it is, in one paragraph

Today the scan hunts for **one driver's car** at each sector line in a thin strip of pixels, and a
chooser picks which of the strip's candidate moments was that car — mostly by asking whether the
timing fits. The race pass turns that round. It reads the race **once**, finds **every moving
thing** against a still picture of the empty track, links each into a path, and **names each path
by the timing sheet**: a path that crosses the start line at the moment the sheet says Cooper
crossed is Cooper, and a path that never crosses the start line at any sheet time is nobody and is
thrown away. Sector crossings are then read off each named path, to the sub-frame, and the strip
detector — still run in the same pass, only where a path approaches a line — supplies the full-
resolution moment. Every start-line crossing is a check against the sheet, every lap, so a swap in
traffic shows up within a lap instead of never. Nothing is uploaded; it runs in the browser like
the scan does now.

## Why (the founder discussion, 2026-09-08)

Measured on the Bendigo 4-driver practice (IMG_4521, job clone `cmtsbp0530001vlfgavwem6wh`):

- The strip method got **8 of 9** crossings within a frame; the one it missed was **284 ms** out.
  The same lap traced from its path was **9 of 9**, that crossing to **8 ms**.
- Its two faults were different mechanisms: one crossing was never recorded (the strip reached past
  the drawn line's end), one was recorded with the best quality of any candidate and lost by
  **0.02 s** to a phantom, because timing fit is the only thing the chooser weighs.
- The "which one is your car?" picker rewarded a person standing beside the track over the car
  (a presence test: 4 of 4 for the person, 3 of 4 for the car). Fixed with an occupancy rule, but
  the design that let a person compete with a car in the first place is the thing being replaced.
- A wrong line time shifts one sector early and the next late; the lap total stays right and the
  error hides. Only a check at the line itself catches it.
- The recorded colour on a crossing did not match the ground pixels when checked. Colour decides
  nothing here until proven on a graded run, as before.

Founder rulings that stand from that discussion:

1. **Seed nowhere.** No "find your car once" step. Identity comes from the sheet, so the shaded
   start line is not a blocker: the car only has to be seen *somewhere* and its path has to pass
   through the start line region at a sheet time.
2. **Prediction aims and warns, never decides.** "The car should reach S3 about now" narrows where
   to look and flags a surprise. It never picks between two things in that moment — a lap's sector
   split is what we are trying to measure, so it cannot also be the assumption.
3. **Faster and more precise, or don't bother.** One decode for paths *and* crossings, at decoder
   pace; crossings interpolated between frames (about 5 ms) rather than "something appeared in
   this frame" (33 ms at 30 fps).
4. **The old scan stays as the fallback**, not as a peer. A car the pass cannot see (the 4 px far
   car on a 1080p fisheye) leaves a gap the strip method fills, marked as such. Nothing is refused.
5. **A learned car detector is the reserve**, not this build. It is only justified once the pass
   shows exactly where a still-picture difference fails.

## What is reused (verified 2026-09-08)

| Piece | Where | How it is used |
|---|---|---|
| Every frame out of the file at decoder speed, one range | `findCrossings/frameSource.ts` — `openFrameSource`, `DecodedSource.readRange(from, to, rate, sink)`; slices the file per `MAX_SLICE_BYTES`, drains at `MAX_DECODE_QUEUE`, forward only | One `readRange` over the whole race span. Playback reader = refuse to persist when `starved`, as the tracer does. |
| Still picture of the empty track | `trace/background.ts` — `medianBackground(frames)` (per-pixel median, odd count), `patchInto` | Built once per race at the coarse scale, from 9 frames spread over the span (5 was per lap). |
| "Changed AND differs from the picture" rule | `imageOps.ts: diffWindowBg` (two-ways rule; never the still picture alone — grain spiral, memory 2026-09-07) | Same rule over the coarse frame. `motionMaskInBandBg` at the lines as now. |
| Blur, dilate, blobs with box/area/compactness | `imageOps.ts: blurFrame, dilate5, findBlobs`; `spans.ts` | As is, on the coarse frame with `fullSpans`. |
| Blob linking, constant-velocity prediction | `findCrossings/tracks.ts: buildTracks` (greedy nearest-first, `maxGapSec` 0.12, reach `maxSpeedPxPerSec`) | Same maths, re-expressed for long-lived tracklets with a size history and an explicit merge rule (below). |
| Full-resolution line strip detector | `detector.ts: WindowScanner` + `resultFromWindow` → `CrossingEvent {t, quality, x, y, dir, source}`; `browserScan.ts: LineCrop` (one `drawImage` sub-rect + one `getImageData`, canvas NOT `willReadFrequently`) | Runs **only on frames where a coarse blob is inside that line's ROI**. Supplies the precise moment and position for a path crossing. |
| Per-line calibration (brightness vs colour, gate = 2× noise floor) | `calibrate.ts: calibrateFromClips / calibrateFromFrames / thresholdFor`; `[scan] cal` lines | As is, per line, before the pass. The coarse gate is the gentlest line's gate, as `browserTrace` does per stretch. |
| Everyone in the race with lap starts on the video clock | `AnalyzeFlowClient.tsx: scanField` → `FieldDriver[] {key, name, role?, lapStarts[]}`; walked by `sync.ts: predictSfStartTime` | **The sheet.** Every driver in every on-video timing session, "other" slots included. |
| The walk drifts; measure the crossings | `lapClock.ts` (Bendigo: +1.71 → +0.74 s over nine laps, most of it in one step) | Naming gate is wide at first and tightens once a driver has one measured crossing. Measured starts written to `perLapSfStart/End` exactly as the scan writes them (`AnalyzeFlowClient.tsx` ~L1960). |
| Minimum-cost assignment | `field.ts: hungarian(cost)` | Path start-line crossings × (driver, lap) slots. |
| Standing things are furniture | `trace/chain.ts: withoutStanding` (`staticShare` 0.5, `staticRadius` 0.6) | Applied per tracklet before naming: a thing that stood still for half its life is not a car. |
| Path-to-line crossing, strict to the drawn ends, sub-frame | `scripts/tmp/step1-tracer-score.mts: crossings()` (segment intersection, `u ∈ [0,1]`); ruling "line ends where drawn" | Promoted into the pure core. |
| Track order at a line crossed twice a lap (hairpin) | `identify.ts: orderFlags`, cluster DP; `direction.ts: LineDir` | Picks the in-order crossing; the other is kept as a candidate with `dir`. |
| Trace storage, drawing, delta chart | `manualVideoAnalysis/types.ts: ManualLapTrace / traceKey`, `parseV2`; `TracePathLayer`, `TraceDeltaChart`, `delta.ts` | A named lap's path is stored as a trace (`recipe: "race-v1"`), so the racing line and delta chart work for every lap with no per-lap "Trace L7" press. |
| Marks and evidence | `ManualFrameMark {source, dir, candidates}`, `ManualScanRecord` rows, the persist block in `AnalyzeFlowClient.tsx` (~L1930–2020) | Written the same way. `source: "rescued"` already means "only tracking saw it" — a path-only crossing is exactly that; no type change. |
| Headless drive and grade | `scripts/dev-drive-scan.mts` (real Chrome, `channel: "chrome"`, dev sign-in, hands the file, streams console lines), `dev-trace-lap.mts --dump`, `scripts/tmp/replay-grade.mts` pattern | Cloned for the pass. **Dump every sighting; grade every downstream change by replay in seconds.** |
| Truth to grade against | IMG_4044 4K: 15 hand marks + recovered probe data (`Documents/rc-autosnap-results/`); IMG_4480 Boronia race: graded clone `cmtc5kkb60001vl0cr6y0swuf` (19/19); IMG_4521 Bendigo practice: the 16 hand-checked truth crossings from step 1 (`scripts/tmp/truth-*.mjs`, `I:/My Drive/IMG_4521.MOV`); IMG_4522/4523 1080p fisheye jobs | The grading set. |

Read before building: the three docs above, then `globals.css` for anything visual.

---

## 0 — Measure the whole-frame read first (half a day, gates everything)

The one number nobody has: what a **coarse whole-frame read costs per frame at 4K** in the
browser. The strip scan reads a few hundred pixels a frame; the pass has to read the whole track
area. The trace north star records the trap: a 4K `drawImage` onto a CPU canvas is **93.8 ms**;
onto a GPU canvas it is **0.2 ms** and only `getImageData` costs, in proportion to the pixels read.

Build `/debug/race-read` (pattern: `/debug/video-decode-test`, `/debug/find-crossings`). It opens a
picked file through `openFrameSource`, reads 300 frames, and times per frame:

| Reader | What it does | Expected |
|---|---|---|
| A. 2D canvas, quarter scale | `drawImage(frame, 0,0,W,H → 0,0,W/4,H/4)`, `getImageData` (960×540 RGBA = 2 MB at 4K) | 3–8 ms |
| B. 2D canvas, half scale | same at W/2 (8 MB) | 10–25 ms |
| C. full scale (baseline, never used) | 33 MB | far too slow |
| D. WebGL (contingency only) | frame as a texture (`texImage2D` accepts a `VideoFrame` in Chrome); shader does the still-picture difference at full res, max-pools to quarter res; `readPixels` 0.5 MB of R8 | 1–3 ms, but new tech in this codebase (no WebGL anywhere in `src/`) |

Plus the CPU work on the coarse frame (two-ways difference, blur, dilate, blobs) timed separately.

**Gate:** decode pace. The tracer measured **~25 ms a frame** end to end at 4K (`L8 489 frames in
13.4 s`, `read 7.6 ms`), so decoding itself is about 15–20 ms; the pass's per-frame work must fit
in **≤ 15 ms** to stay decode-bound. A passes → build on A. Only A fails → B if it fits, else D
(add 2–3 days). Record the numbers in this doc's changelog. Do not skip this step: it decides the
scale every later piece works at.

**Scale rule:** the coarse frame's short side is ~540 px (quarter of 4K, half of 1080p). A 20 px car
at 4K is 5 px coarse — findable against a still picture (the strip detector finds 4 px cars now),
and precision comes from the full-resolution strip at the line, not from the coarse path. A 4 px
far car on a 1080p fisheye is 2 px coarse: **invisible at any scale**, and already beyond the tracer.
That is the fallback's job, by design.

---

## 1 — The pure core: `src/lib/videoAnalysis/racePass/` (3–4 days)

DOM-free. Blobs in, marks and traces out. Every stage is a function over the previous stage's
output so that a dump replays in a second.

### `coarse.ts` — one frame → observations

`class CoarseReader` (browser side, in §2) hands `coarseFrame(crop: FrameCrop, prev: FrameCrop |
null, bg: FrameCrop, thresh, out) → Obs[]`:

1. `diffWindowBg(prev, roi, bg, cur, roi, thresh, mask)` over the whole coarse frame (two-ways
   rule; `inset` 0). The still picture is the `medianBackground` of **9** frames spread over the
   race span, rebuilt once if the shake share (below) says the camera was knocked.
2. **Camera test** = share of the frame that differs, not blob count (memory 2026-09-07). Over
   `SHAKE_SHARE` 0.3 → frame skipped, prediction kept, counted.
3. `dilate5` → `findBlobs(mask, w, h, minArea, fullSpans, seen, stack, support)` with `minArea`
   scaled to the coarse car size, floor 3 px. `MAX_BLOBS_PER_FRAME` 24 (a whole field, marshals,
   the board flapping); a frame over that is kept but flagged `crowded`.
4. Each blob → `Obs { t, x, y, w, h, area }` **in full-frame pixels** (× the scale) so `chain.ts`'s
   `Obs`/`ObsFrame` types are reused unchanged. No colour on the coarse path (ruling above).

### `link.ts` — observations → tracklets

`linkTracklets(frames: ObsFrame[], p: LinkParams) → Tracklet[]`, `Tracklet = { id, points:
Obs[], sizePx: number /* median longest side */, gaps: number }`. `buildTracks`'s greedy
nearest-first with constant-velocity prediction, changed in three ways:

- **Long-lived.** `maxGapSec` 0.5 (a board, a marshal's legs) instead of 0.12; reach in car lengths
  from the tracklet's own measured size, not a band width.
- **Size memory.** A blob outside `[0.4, 2.5]×` the tracklet's median size is not it. Cars keep
  their size across a few frames; a person's legs and a car merging do not.
- **A merge is a cut, never a guess.** When two open tracklets could both take one blob inside
  tolerance, **both end** there and a fresh tracklet starts on the blob. Splitting again later
  produces two fresh tracklets. Nothing carries identity across a merge — the naming step has to
  re-establish it at the next start-line crossing. This is the ambiguity doctrine from `chain.ts`
  applied before identity exists.
- `withoutStanding` per tracklet: a tracklet whose points sit within `staticRadius` for
  `staticShare` of its life is dropped before naming.

### `name.ts` — tracklets × the sheet → drivers

Inputs: tracklets, the start line's `LineGeom`, `FieldDriver[]` (the sheet), the full-resolution
start-line candidates from the strip scanner (§2), the transponder lap times.

1. **Start-line crossings per tracklet** — `pathCrossings(tracklet, sfLine)` (strict to the drawn
   ends, sub-frame). Each is snapped to the nearest strip candidate within `SNAP_SEC` 0.12 and one
   car length; snapped = `confirmed`, unsnapped = `rescued`.
2. **Bridging through the shaded start line.** A tracklet ending within `BRIDGE_SEC` 0.6 before the
   line and one starting within 0.6 after, sizes within `[0.6, 1.6]×`, and a **strip candidate at
   the start line between them** whose time sits on the straight-line join within one frame → the
   two are joined *through that candidate*. The candidate is the crossing (`confirmed`); the join
   is a `hole: "lost"` in the path, never drawn as a line. No strip candidate → no bridge.
3. **Assignment.** Rows = every start-line crossing on every tracklet; columns = every (driver,
   lap) slot from the sheet. Cost `|Δt| / gate`, `FORBIDDEN` beyond the gate, `UNMATCHED` 1.0 for an
   empty slot or an unnamed crossing (the constants and `hungarian` from `field.ts`). **Gate is
   wide then narrow:** `NAME_GATE_FIRST_SEC` 1.2 against the walked start (`lapClock.ts` measured
   1.7 s of drift), then for a driver with one confirmed crossing every later slot is predicted
   from **that measured time + the sheet's lap times** with `NAME_GATE_SEC` 0.35.
4. **Consistency across laps is the tiebreak the single-crossing matcher never had.** A tracklet
   that lives across several start-line crossings must take all of its slots from **one** driver;
   the cheapest single-driver assignment wins, and a tracklet whose crossings fit two drivers
   equally on every lap is a **tie** — reported, never guessed (the "two yours 0.4 s apart" open
   item). Twins on matching lap times are separated by position continuity: each has its own
   crossing time, so each takes its own slot.
5. **A swap is a cut.** A tracklet whose crossings fit driver A for laps 3–5 and driver B for lap 6
   is cut at the point after lap 5's crossing where its path was nearest another tracklet's end
   (the merge the linker missed), and each half named separately.
6. **The sheet check.** For every named driver, consecutive measured crossings against the sheet's
   lap time: `|Δ| ≤ CLOCK_GATE_SEC` 0.15 (the transponder gate, `compareTransponder.ts`) →
   `sfMatched`; over it → that lap is `unsure` and the review says so. Median over the race is
   the trust line the screen quotes.
7. **Unnamed tracklets are dropped.** A person, a marshal, a parked car, grain, the board. They are
   counted (`unnamed`) for the review and the drive log, and never produce a crossing.
8. **"Doesn't line up."** If fewer than `MIN_NAMED_SHARE` 0.5 of the sheet's (driver, lap) slots for
   the scanned drivers get a crossing, the pass **writes nothing** and says the timing and the
   footage disagree — check the sync. A wrong anchor must produce that, not wrong names.

Output: `NamedLap { key, role?, lapNumber, startSec, endSec, path: Obs[], holes, sfMatched }` per
(driver, lap), plus `{ unnamed, ties, cuts }`.

### `pathCrossings.ts` — a named lap → sector crossings

For each corner line, intersections of consecutive path points with the drawn segment, `u ∈
[0,1]`, `t` interpolated (the step-1 rig's function, promoted, with a test). Then:

- **Snap** to a strip candidate at that line within `SNAP_SEC` 0.12 and one car length →
  `confirmed`, the candidate's `t`, `x`, `y`, `dir`. No candidate → the path's own moment,
  `rescued`. A path hole across the line → **missing** for this pass.
- **Track order.** Crossings in a lap must come in drawn order `SF → S1 … → SF`; where a line is
  crossed twice (a hairpin's return leg), the in-order one is the crossing and the other goes on
  the mark's `candidates` with its `dir`. The DP is `identify.ts: orderFlags`' cluster walk over one
  lap's crossings. Prediction (the line's usual offset on other laps) breaks a remaining tie only
  when the two are further apart than `MIN_SECTOR_GAP_SEC` 0.3 and one is outside `FIELD_GATE_SEC`
  0.8 of usual; otherwise **both are kept and the cell is `unsure`** (ruling 2: prediction never
  decides between two things in the same moment).
- A crossing further than `SURPRISE_SEC` 1.0 from the line's usual offset is kept and flagged
  `surprise` for the review — a lap where the driver lost a second there, or a wrong path.

### `toSession.ts` — marks, traces, evidence

Pure: `NamedLap[]` + crossings → `{ marks: ManualFrameMark[], rows: ManualScanRow[], traces:
Record<string, ManualLapTrace>, measuredLapStarts, verdict }`.

- Marks for **participants** (`sessionModel.ts: participants`) only fill empty cells; a hand mark
  always wins (the existing rule). Non-participant drivers' crossings go into `lastScan` rows the
  way `fieldCrossings` do now (the ⚑ partial rivals).
- `ManualLapTrace` per participant lap: `points` from the coarse path (full-frame normalised, box
  from the blob), `holes`, `segments` from the crossings, `quality.ok` from coverage ≥ `OK_COVERAGE`
  0.6 and `sfMatched`, `recipe: "race-v1"`. **Size cap:** traces are written for participants only;
  if the total exceeds `MAX_TRACES_BYTES` 1.5 MB the points are thinned to every second frame (the
  chart and the line do not need 30 fps). `manualJson` is loaded on every open of the job.
- `measuredLapStarts` → `perLapSfStart/End`, as the scan writes them today.
- `lastRace: { at, recipe, span, frames, readMs, scale, drivers: [{ key, name, role?, laps:
  [{ lapNumber, coverage, sfMatched, cuts }] }], unnamed, ties, verdict }` — new optional field on
  `ManualVideoSessionV2`, parsed explicitly in `parseV2` (an unknown field is dropped there).

### `record.ts` — the dump

`RacePassRecord = { at, span, scale, frameW, frameH, cal, frames: ObsFrame[], strip:
Record<lineKey, CrossingEvent[]>, sheet: FieldDriver[] }`. Everything after `coarse.ts` is a
pure function of this record. `dev-drive-race.mts --dump` writes it; `dev-replay-race.mts` re-runs
`link → name → pathCrossings → toSession` over it. Ten laps of coarse blobs is a few MB of JSON.

### Tests — `racePass/*.test.ts`, `npm run test:race-pass`

Extend `trace/synthetic.ts` into a **field scene**: N cars on the same loop with different lap
times (the sheet is generated from the scene), a shade band where a car's contrast drops under the
gate, an occluding board, a person standing beside S3 all race, a marshal walking across S3 during
one lap, a hairpin line the loop crosses twice, one camera bump frame, grain. Rendered whole at
the coarse scale and pushed through `coarse → link → name → pathCrossings → toSession`.

| Scene | Must hold |
|---|---|
| Three cars, different lap times, clean | every car named on every lap; every crossing within one frame; lap times vs the scene's sheet within 5 ms |
| Person standing beside S3 all race | never named; zero crossings from it; counted in `unnamed` |
| Marshal walks across S3 during my lap 4 | my S3 crossing is my path's, not the marshal's; the marshal's tracklet is unnamed |
| Shade band over the start line, car invisible 0.3 s | bridged through the strip candidate; lap named; the bridge is a `lost` hole, not a drawn line |
| Two cars merge for 0.4 s mid-sector | both tracklets cut; both re-named at the next start line; the merged stretch is a hole for both; no swap |
| Sync anchor wrong by a whole lap | `verdict: "doesnt-line-up"`; nothing written |
| Hairpin line crossed twice a lap | the in-order crossing chosen; the other on `candidates` with the opposite `dir` |
| Twins on identical lap times, 0.4 s apart at the line | separated by position continuity; no tie |
| Twins on identical lap times, same place, every lap | reported as a `tie`, not guessed |
| Far car 2 px coarse | no path; its targets are `missing`; the fallback list names them |
| Camera bump on one frame | skipped, counted, no tracklet broken |
| Replay | `dev-replay` over a dump reproduces the marks byte for byte |

---

## 2 — The browser runner: `racePass/browserRace.ts` (2 days)

`"use client"`. `runRacePass({ video, file, frameW, frameH, lines, field, laps, marks, span,
onProgress, signal }) → RacePassOutcome`.

1. **Span.** From the earliest lap start on the sheet − 2 s to the latest lap end + 2 s, clipped to
   the file. That is the race, not the whole file (IMG_4521 is 54 913 frames; the practice laps are
   90 s of it).
2. **Calibrate every line** as the scan does (`calibrateFromClips` over four clips across the span,
   quietest clip's noise). Coarse gate = the gentlest line's gate.
3. **Still picture**: 9 frames spread over the span, read at the coarse scale, `medianBackground`.
   One extra decode pass of nine seeks (~3 s).
4. **One `readRange(spanFrom, spanTo)`.** Per frame:
   - `CoarseReader.read(image)` (the §0 winner) → `coarseFrame` → `Obs[]`.
   - For each line whose ROI contains a coarse blob (or contained one within the last 5 frames —
     the strip needs a run-in): `LineCrop.read` + `WindowScanner.push`, exactly as `browserScan`
     does. Most frames touch 0–2 lines. Per-line `WindowScanner`s live for the whole pass; their
     `samples` are cut into `CrossingEvent[]` per line at the end with `resultFromWindow`'s
     tracker config (or `eventsFromSamples` directly).
   - Progress every 30 frames: `fraction`, `note` (`"Reading the race · 2:14 of 6:02"`).
5. **Console lines, drive-script style:** `[race] cal s3 → luma @ 8 · …`, `[race] read 10812
   frames in 271 s · per frame draw 0.3 read 4.1 coarse 3.8 strip 1.9 ms · shake 2 crowded 0`,
   `[race] tracklets 61 · standing 7 dropped`, `[race] named me 10/10 Cooper 9/10 Justin 8/10 ·
   unnamed 43 · ties 0 · cuts 2`, `[race] sheet check median 6 ms worst 41 ms`, one `[review]`
   line per crossing in the scan's existing format (found / suspect / missing) so
   `dev-grade-*` reads both the same way.
6. **Abort** through `checkAbort` + `Aborted`; the runner owns nothing after `close()`.
7. **Playback reader** (no `VideoDecoder`): runs, but the outcome is `starved` and nothing is
   persisted — the scan's own rule.

Cost, honestly: with the per-frame work at decode pace, a six-minute 4K race is **3–5 minutes**
(10 800 frames × 20–30 ms), a 1080p one about a third of that. Today's scan with two drivers and
six lines already reads most of the race (windows merge into segments), so this is the same
order — and it replaces the scan **and** every per-lap "Trace" press (13 s a lap, re-decoded each
time). Struggling never costs more: there is no per-lap chain fighting itself, the linker is
linear in blobs. A hard cap anyway: `MAX_WALL_MS` = 3 × the span, then stop, keep what was read,
and say so.

---

## 3 — Wiring (2 days)

- **The button.** The Mark step's "Find every crossing" (`AnalyzeFlowClient.tsx` ~L4110) runs the
  race pass when `VideoDecoder` exists and a file is in hand; `learnTheLap` / the picker /
  `findEveryCrossing` become the **fallback path**: (a) the whole thing when the pass cannot run
  (playback reader, no start line drawn — the sheet needs one), (b) the **bracket pass only**
  (`bracketTargets` + `findCrossingsInBrowser`) for the pass's `missing` targets, exactly as the
  second pass fills gaps today. `autoState` gains no new values; the review panel is the same
  panel with more to say.
- **The review panel** (`autoState === "review"`): per driver one row — laps named, the sheet
  check (`median 6 ms`), crossings found / filled by the strip / missing, ties. A tie or a
  `doesnt-line-up` verdict is a quiet chip with one action (`Check the sync`). Words on chips
  only; no sentences (the standing UI rule).
- **Persist** through the existing block: marks (empty cells only), `lastScan` rows, `perLapSf*`,
  `traces`, `lastRace`. `parseV2` gains `lastRace`; `sessionModel.ts: swapDriverRoles /
  removeParticipant / setParticipantAnchor` treat `lastRace` like `lastScan` (dropped when the
  role's clock moves).
- **The compare step** needs nothing: traces with `recipe: "race-v1"` draw through
  `TracePathLayer` and chart through `TraceDeltaChart` as the per-lap traces do. The "Trace L7"
  chip stays for a lap the pass left without a path.
- **Retire nothing yet.** The picker, `bootstrap.ts`, `lapFit.ts` and `field.ts`'s claims are the
  fallback's machinery. Deletion is a separate pass after two graded sessions on the race pass.

---

## 4 — Rigs, grading, iteration (3–4 days)

- `scripts/dev-drive-race.mts <jobId> <video> [--dump dir] [--headless]` — clone of
  `dev-drive-scan.mts`: real Chrome, dev sign-in, MARK chip, the button, streams `[frames]`
  `[race]` `[review]`, GETs the job, writes `e2e/.shots/race-<job>.json` + a screenshot.
  **Always on a clone** (`scripts/dev-clone-job.mjs` / `scripts/tmp/clone-job.mjs`).
- `scripts/dev-replay-race.mts <dump>` — `link → name → pathCrossings → toSession` over a dump,
  prints the `[review]` lines. A rule change is graded here first; only a change to what the pass
  *sees* needs a drive.
- `scripts/dev-grade-race.mts <job|dump> --truth <file>` — per crossing: pass vs truth, source,
  within-one-frame; per driver: named laps, sheet check; a summary table in the format of
  `step1-table.mts`.

**Grading set and bars** (a bar not met is a finding to record, not a reason to lower the bar):

| Footage | Truth | Bar |
|---|---|---|
| IMG_4044 · 4K TFTR, Jordan vs Cooper | 15 hand marks; probe data; transponder lap times | all 15 within one frame; lap times vs transponder median ≤ 5 ms; both drivers named on every lap |
| IMG_4480 · Boronia race, six cars, traffic | graded clone `cmtc5kkb60001vl0cr6y0swuf` (19/19, 0 wrong car) | ≥ 19/19 found, **0 wrong-car**, merges appear as cuts + holes, never swaps |
| IMG_4521 · Bendigo practice, four drivers, shaded start line | 16 hand-checked truth crossings (step 1 rigs); the lap 10 s4 two-pass region checked by hand | ≥ 15/16 within one frame; **lap 5 s3 within one frame** (was 284 ms); laps 2 and 6 named despite the shade (bridged) |
| IMG_4522 / 4523 · Bendigo 1080p fisheye | sector board; the far 4 px car | zero wrong numbers; far-line cells `missing` and filled by the fallback; `ok=false` on any lap the pass could not follow |

Every graded run: numbers into this doc's changelog with the job id, the dump path and the
console summary line.

---

## 5 — Docs and memory (half a day)

`VIDEO_AUTO_SECTORS_PLAN.md` step 3 gets a "race pass" status line and a changelog entry;
`VIDEO_TRACE_NORTH_STAR.md` current-state table gains the row; `SECTOR_COMPARE_NORTH_STAR.md`
"Find crossings" paragraph notes that the recipe is now the pass with the strip as its
instrument. A memory note with the rulings and the numbers.

---

## Sequence

1. §0 — the read rig, the numbers, the scale decision. **Stop and record if A fails.**
2. §1 `coarse.ts` + `link.ts` + the field scene + their tests.
3. §1 `name.ts` + `pathCrossings.ts` + `toSession.ts` + `record.ts` + the rest of the tests.
4. §2 runner + `[race]` lines + §4 drive/replay/grade scripts. **Grade on IMG_4044 before any UI.**
5. §3 wiring, review panel, persistence, fallback.
6. §4 the other three videos; iterate by replay.
7. §5 docs + memory.

Roughly **11–13 working days**, plus 2–3 if §0 forces WebGL. The pricing page still lists video and
sector analysis as "soon", so nothing live depends on the old scan staying as it is.

## Risks, and what is baked in against each

- **The read cost is unmeasured.** §0 first; three readers; the scale rule keeps a 4K car ≥ 5 px.
- **`manualJson` bloat.** Participants' traces only; 1.5 MB cap with thinning; `lastRace` is a
  summary, the dump lives on disk.
- **The shaded start line.** No seeding; bridging through the start-line strip candidate, which
  the existing start-line scan already finds there (`sfCheck` median 1 ms on this footage).
- **Nose-to-tail cars.** A merge is a cut; both halves re-named at the next start line; the merged
  stretch is a hole; the fallback fills the cells it can, marked.
- **A wrong sync.** The "doesn't line up" verdict writes nothing. A wrong anchor must never
  produce confident wrong names.
- **Twins on matching lap times.** Position continuity separates most; the rest are reported ties.
- **A far car below the coarse scale.** Honest `missing` + fallback; the capture doctrine (4K, 60
  fps, high) is the real fix and the UI should keep saying so.
- **Phone lane.** Not in this build. `/debug/race-read` doubles as the phone gate later.
- **Colour.** Decides nothing. The coarse path carries none; the strip's `colour` is stored on
  candidates as now and used by nothing new.

## Do not re-propose (measured dead ends, from memory — read those notes before arguing)

- The still picture **alone** as the motion rule (grain spiral, 2026-09-07). Two-ways only.
- Counting blobs as the camera test (says nothing against a still picture). Share of the frame.
- Lowering the gate globally for a small car; shrinking a lost window; adaptive frame spacing.
- Learning the road from more laps to rescue a weak lap (57→62 %, 42→43 %, 60→60 % — no).
- An absolute colour threshold from the start-line reference; colour as identity at all.
- A "find your car once" seed step. The sheet is the identity.
- Any rule that lets prediction pick between two candidates in the same moment.

## Traps (from memory — do not relearn)

- **Saving any `src/` file while a headless drive runs reloads the page and kills the pass.**
  `scripts/` and `docs/` are safe. Never edit `src/` while Jordan is driving the app.
- HEVC needs real Chrome/Edge with the GPU (`channel: "chrome"`); Playwright's bundled Chromium
  decodes nothing and produces fake-perfect results. Orphaned headless browsers starve every
  later read.
- The canvas must NOT be `willReadFrequently` (93.8 ms vs 0.2 ms).
- A seek does not clear what is on screen; frames outside the range are skipped, not trusted.
- Finished jobs open on DONE; the button is on MARK (chip text "Mark", uppercased by CSS).
- Node paths for the footage are `I:/My Drive/…`, never `/i/…`.
- `git branch --show-current` before every commit; parallel sessions move HEAD.
- Big heredocs and `node -e` with backticks die silently: write a `.mts` and run it.

## Verification order

`npx tsc --noEmit` → `npm run test:race-pass`, `test:trace`, `test:find-crossings`,
`test:manual-video-analysis`, `test:driver-compare` → `npx next build` → drive it: `dev-drive-race`
on a clone of IMG_4044, then the Mark step by hand in real Chrome at 1440 and 390 px, screenshots of
the review panel and the compare step drawing a `race-v1` trace.

---

**Changelog:**
- 2026-09-09 (afternoon, measured; two rig fixes, no product code) — **The tracer seeded from
  exact start-line crossings does not hold a car through race traffic either, and the hand-
  checked truth at two of the five lines is a different definition of the line, not a detector
  miss.** Driven on a clone of the Boronia job (`cmtta9h7g0001vlg8rfb3e719`, four truth laps,
  `--corners-off`, dumps in the scratchpad `boronia-trace/`) and graded with
  `scripts/tmp/grade-boronia-trace.mts`; every replay experiment is a `scripts/tmp/*.mts`.

  | | |
  |---|---|
  | tracer, four laps, all reported OK | crossings found 7 of 19 · within a frame 0 · median 131 ms |
  | of those four laps | two right, one muddled by traffic (123 ambiguous frames), **one on the wrong car from 0.8 s in** |
  | chained coarse fragments, best of four prototypes | found 8–13 of 19 · within a frame 0–1 · fragments claimed by two drivers 3–56 |

  **Findings, each measured:**
  1. **The strip and the path agree with each other and both sit ~80 ms before the eye.** Path
     crossing minus truth: median −86 ms; nearest strip candidate minus truth: median −70 ms;
     the two agree to a millisecond where both saw the crossing. It is not a clock offset —
     the start line measures +21 to +36 ms against the same reviewer and +15 to +27 ms against
     the transponder walk — it is per line (s1 ≈ −85, s4 ≈ −145, s5 ≈ +25 ms), consistent
     across laps and drivers, almost certainly the blob's centre pulled by the car's shadow.
     A per-line constant cancels in every comparison at the same line.
  2. **Sectors 2 and 3 are drawn 16 and 18 px long where the track folds back, and the car
     passes BESIDE them.** Widening the end tolerance from half a car to three cars changed
     nothing: the path never changes side of those lines at the truth moment; it does so about
     two seconds later on the return leg. The old scan (+1.9 s / −1.4 s on every lap of both
     drivers), the pass's strip candidates (byte-identical to the old scan's marks) and the
     tracer all read the return leg. That is a drawing problem with a nudge that already
     exists (`shortLine`, "lengthen the line"), not a detection problem — and the truth file's
     "within a frame" bar was never met by the old scan either (3 of 19).
  3. **The old scan was never 19/19 against this truth.** Against `boronia-IMG_4480-2026-08-27.json`
     its marks are median −73 ms, 3 of 19 within a frame, 7 within 100 ms. The 19/19 in the
     grading table came from a different reference. What it IS good at is repeating itself:
     a fresh end-to-end scan on a cleared clone (`cmttaxeqn0001vlh8rxsmnb0e`) reproduced the
     08-29 marks to the millisecond, 98 found · 2 held back · 0 missing.
  4. **Why the tracer left its car (competitor L11).** Fragment #268 crossed the start line and
     ran off the left edge of the picture 0.6 s later; the car came back 0.77 s after that as a
     NEW fragment (#271, 1.6 car lengths from its heading). The tracer re-acquired instead on
     #258, a car that had been in view for five seconds. **A lost car can only come back as
     something that appeared after it vanished**; anything already being followed at the
     moment of loss is another car. The chain prototypes had the same bug in disguise —
     clipping fragments to the lap window made pre-existing cars look newborn — and fixing it
     there was necessary but not sufficient: in the crowded far zone (60 % of all sightings sit
     in the top 100 px) other cars' fragments are born constantly too, and a lap needs seven
     hand-offs. The rule belongs in `trace/chain.ts`, where the path is chosen, and is the next
     thing to build for the tracer; it is not built.
  5. **Fragments do not die where the car is slow** (speed before a death ≈ overall) and only
     1 % of frames are empty. Deaths per sighting are flat across the picture. Do not re-propose
     a slower-diff or a lower gate for this.

  **Product decision (best judgement, 2026-09-09).** The pass is not wired into the scan: the
  strip scan already measures every seated driver's start-line crossings (`lapStartError`,
  `measuredLapStarts`), `toSession` emits starts for seated roles only and a rival has no role
  key to write to, so the pass would add a trust line for a minute of decoding. It stays at
  `/debug/race-pass` with its rigs. The ship bar for sector times is **lap-to-lap consistency per
  line**, not agreement with a reviewer's eye — see `VIDEO_AUTO_SECTORS_PLAN.md` 2026-09-09.

  Rig fixes: `dev-trace-lap.mts` and `dev-drive-scan.mts` hand the file over on the set-up step
  when a job with an uploaded copy asks for none on open (it opens on compare and plays the
  copy). Measurement clones left on the Videos list: `cmtta9h7g0001vlg8rfb3e719` (traces),
  `cmttaxeqn0001vlh8rxsmnb0e` (fresh scan, 98 marks added by the new button) — delete when done.
- 2026-09-09 (diagnosis, no code changed) — **Detection is not the wall, and the reason nothing
  lands is architectural.** Measured by replay over `boronia-dump.json`, so every number below
  cost seconds, not a browser run. Scripts: `scripts/tmp/diagnose-detection.mts`,
  `diagnose-rivals.mts`, `diagnose-truth-paths.mts`, `diagnose-handoff.mts`, `diagnose-vanish.mts`.

  **The car is in the picture, it is held by a path, and it is never the driver's own path.**

  | at each of the 20 hand-checked crossings | |
  |---|---|
  | a coarse sighting sat on the drawn line | **15 of 20** (19 of 20 within two car lengths) |
  | that sighting belonged to some path | **15 of 15** |
  | that path was the one named to this driver's lap | **0 of 20** |

  So the earlier verdict — *measure detection next* — is answered, and it was the wrong place to
  look. The quarter-scale two-ways difference finds the car at the corner nearly every time, and
  the linker holds it. What fails is the step in between.

  **The mechanism, and it is a design limit rather than a setting.** A path can only be named
  where the sheet has a time to match it against, which is the start line. Paths live a median
  of **2.47 s**; a Boronia lap is **18 s**. One lap is therefore carried by about **seven paths in
  a row**, and exactly one of them — whichever spans the start line — can ever be named. Of 372
  paths, **65 were named and 307 were dropped as nobody**, and the discarded ones are the pieces
  holding every corner crossing. Naming is not weak here; it is measured at 100 % of the sheet.
  It simply cannot reach six sevenths of the evidence.

  **The obvious repair does not work as stated.** Walking forward from a named path and absorbing
  whichever unnamed path carries on from where it stopped (≤1 s, ≤4 car lengths, size-checked)
  takes lap coverage from **12 % to 34 %**, and at ≤2 s / ≤8 cars to 56 % — and still puts
  **0 of 20** crossings on the right car. Two failure shapes, both visible in the detail: some
  chains stop at the first hand-off and never restart, and some walk onto a neighbouring car
  (`competitor L11 s2` has a sighting at exactly the truth moment, 2.6 car lengths off the line —
  that is another car's). Coverage is not the measure; whose car it is, is.

  **Why a path ends at all**, within 1.5 car lengths of where the car was heading, over 367 lost
  endings:

  | | |
  |---|---|
  | nothing there — the car left the picture for over half a second | **54 %** |
  | a usable blob was right there, and the path lost the contest for it | **41 %** |
  | one blob too big for one car — two cars genuinely became one | 4 % |

  The 41 % is two paths following one car: the winner is an established path (median age 86
  sightings) whose prediction was a median 106 px nearer, so the greedy assignment is behaving
  correctly and the fault is upstream of it — a second path exists for that car at all. Only 1 %
  of frames have nothing moving in them, and the median frame holds 5 sightings for 6 drivers,
  so the picture is not short of signal.

  **What this changes about the next step.** Not detection, and not the crossing rules. The two
  candidates are (a) make one path last a lap — the 41 % duplicate-path share and the 54 %
  vanish share are separate problems with separate fixes, and the vanish share is the one that
  needs the picture rather than the bookkeeping; or (b) let identity reach a fragment that never
  touches the start line, checked at the next start line the chain does reach, so a chain is
  only trusted once the sheet confirms where it came out. (b) is nearer the doctrine already
  written here — the sheet decides, prediction only aims — but the naive version above is
  measured dead, so it needs the arrival check to be the gate rather than an afterthought.
- 2026-09-08/09 (§1–§2 built, §4 graded) — **Naming by the sheet works; reading sectors off the
  coarse path does not.** Both halves measured on the Boronia race (IMG_4480, 1376×600, six cars,
  259 s, clone `cmtsppnoe0001vlpc3vbzpx7s`) against the 20 hand-checked crossings in
  `scripts/truth/boronia-IMG_4480-2026-08-27.json`.

  **What works, and it is the part the whole design rests on.**

  | | |
  |---|---|
  | drivers named | **6 of 6, every lap** (75 laps) |
  | share of the sheet given a measured crossing | **100 %** |
  | measured lap length against the sheet's own | **median 4 ms, worst 14 ms** |
  | read time for a 259 s race | 52 s at quarter scale, 137 s at full |

  A path that lines up with a driver's start-line crossings is that driver's car, and it holds up
  against a transponder gate of 150 ms by a factor of thirty. It also survived a picture full of
  noise: on the Bendigo practice, with 7 865 paths of which 7 501 were nobody, it still named six
  laps of six to a 26 ms median. **The sheet is a far stronger instrument than anything in the
  picture, and this is the evidence for it.**

  **What does not work.** Sector crossings read off the coarse path: **0 of 19 within a frame**.
  The reason is not the naming and not the geometry — it is that the path is not continuous
  enough to read from. Paths die every **0.6 s** against a lap of 17.5 s, so lap coverage is
  **4 %** and not one of 75 laps had a whole path. Every attempt to buy coverage bought error:

  | change | coverage | truth |
  |---|---|---|
  | a path may go unseen 0.5 s (safe) | 5 % | 0 of 19 found |
  | …2 s | 44 % | 12 found, **0 within a frame, median 1.9 s** |

  The 2 s paths join onto other cars — `competitor L11 s4` read 4.4 s early because that was the
  car's s3 pass on somebody else's path. That is the trade the doctrine forbids, so the shipped
  default stays at 0.5 s and the sector half is **not wired to anything**.

  **Findings worth keeping, each measured:**
  1. **A merge must not cut the path.** Cutting on suspicion ended 1 387 of 1 506 paths and left
     lap coverage at 4 %. Identity is the naming step's job: it checks every path against the
     sheet at every start-line crossing, and cutting early throws away the evidence that would
     have settled it. Merges are now recorded as doubts on the path (`Tracklet.doubts`).
  2. **The line is shorter than the car.** Boronia's corner lines measure 16, 18, 40 and 45 px
     against a 56 px car — three of five are under a third of a car. A path of blob centres
     almost never passes through 16 px, so 301 of 310 crossings came back missing while the same
     paths crossed the 168 px start line on 62 laps of 64. A crossing is now allowed half a car
     past a drawn end — half a CAR, never a share of the line's length, which is the reach that
     made a car running wide register as crossing.
  3. **A crossing over a gap is not a crossing.** Interpolating across a two-second hole found
     nine crossings with a median error of 1.3 s. Only watched steps count now.
  4. **A lap's path may not take two sightings at once.** Pooling several named paths gave lap
     coverage of 151 % — more sightings than frames — and a path zigzagging between two cars.
  5. **Downscaling helps a car hold together.** At full resolution the two-ways difference gives
     thin slivers rather than one lump: paths got *worse* (life 0.90 s against 2.47 s, 4 836 of
     them) even though naming got better (100 % against 90 %). Do not assume more pixels is more
     signal here.
  6. **The search must be confined to the track.** The hull of the drawn lines, plus a margin,
     covers half the picture at Boronia and removes the trees, the stand and the crowd. Without
     it the Bendigo footage gave 24+ moving things a frame on a third of its frames.
  7. **A practice session is not a race** — see `raceSpans`. Four drivers ran at different times
     down a 29-minute file, so one bracket over the sheet is 51 000 frames.

  **Where it should go next, on this evidence.** The strip reads a line at full resolution with a
  calibrated gate and is far more precise than a quarter-scale path; the path is the only thing
  that can say *whose* crossing it was. Making the path **choose among the strip's candidates**,
  rather than supply the moment itself, is half-built (`sectorCrossings` vouching) and took the
  hand-checked hits from 6 to 12 — but the path still has to be continuous enough to vouch, and
  on this footage it is not. **The next thing to measure is detection, not any of the rules on
  top of it.**

  **Rigs, and they are the reason any of this is known:** `/debug/race-read` and
  `scripts/dev-drive-race-read.mts` (step 0); `/debug/race-pass` and `scripts/dev-drive-race.mts`
  (reads a real job, writes nothing, `--dump` saves every sighting); `scripts/dev-replay-race.mts`
  (re-runs link → name → sectors over a dump **in a second**, any `LinkParams` field overridable
  from the command line, `--truth` grades against hand-checked crossings, `--detail` prints every
  one); `scripts/dev-grade-race.mts` (grades a log against a job's marks and a truth set).
  Dump kept: `scratchpad/boronia-dump.json` (7 776 frames of sightings).
- 2026-09-08 (step 0, measured) — **The read is affordable at quarter scale: 8.7 ms a frame all in,
  against a 15 ms gate.** Driven on IMG_4521 (3840×2160, real Chrome, 200 timed frames a pass,
  `/debug/race-read` + `scripts/dev-drive-race-read.mts`). WebGL is NOT needed; build on A.

  | | median | p90 |
  |---|---|---|
  | read, eighth scale 480×270 | 2.0 ms | 6.3 ms |
  | **read, quarter scale 960×540** | **3.3 ms** | 5.4 ms |
  | read, half scale 1920×1080 | 5.8 ms | 6.9 ms |
  | read, full scale 3840×2160 | 19.8 ms | 27.7 ms |
  | **`CoarseDetector` (brightness, blurred, spread over the mask's own rows)** | **5.4 ms** | 5.7 ms |

  Four findings, each measured, **do not re-litigate:**
  1. **One reader per decode pass.** The first cut of the rig timed three readers inside one loop
     and reported 13.9 ms for the quarter-scale read; alone it is 3.3 ms. `getImageData` stalls
     the pipeline, so several readbacks a frame queue behind one another. That artifact alone
     produced a “WebGL is needed, add 2–3 days” verdict that was entirely wrong.
  2. **Blur anyway.** Drawing 4K down to a quarter box-filters it, so the blur looks droppable and
     it is 3.2 ms. Measured, dropping it costs **74 blobs a frame against 7.9** — the downscale is
     not enough and grain fires. That is the death spiral that emptied three sectors on
     2026-09-07, and it is not being paid for again to save three milliseconds.
  3. **Spread the mask only over the rows that hold any of it.** Four hundredths of one per cent
     of a frame moves. Row spans taken from the mask itself take the dilation from 8.0 ms to
     0.1 ms and change no blob.
  4. **The general-purpose loops were the cost.** `gaussianBlur3` walks an interleaved image of
     any channel count and `diffWindowBg` carries the arithmetic for two crops cut from different
     places in the frame, because a window that follows a car needs that. Here the picture is one
     channel and the rectangle is the whole frame and never moves. Writing both out again in
     `racePass/coarse.ts` — same arithmetic, held to it by a byte-for-byte test against the
     originals — took the per-frame work from 12.0 ms to **5.4 ms** in the same run.

  **Scale ruling: quarter.** A 20 px car at 4K reads as 5 coarse pixels, which `findBlobs` traces
  with real area. An eighth reads faster (2.0 ms) but puts the same car at 2.5 px, below the floor
  that keeps grain out. Precision never comes from the coarse picture anyway — a crossing's moment
  is read off the full-resolution strip at the line.

  **Deviation to note:** IMG_4044 is not on this machine; only `hand-marks.json` and the probe
  data survive, in `Documents/rc-autosnap-results/`. The 4K grading bar moves to IMG_4521, which
  is 4K, has four drivers, and carries the lap 5 s3 fault this whole rebuild exists for.
- 2026-09-08 — Initial. Written after the founder discussion that ended step 1 of the ground-up
  redesign (unanchored tracing proved 9/9 within a frame; seeding at a shaded start line proved to
  be the blocker; "seed nowhere, name by the sheet" chosen over "seed once and follow"). Rulings
  and dead ends above. Nothing built.
