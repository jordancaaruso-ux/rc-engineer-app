# Video Data Trace North Star

**Status:** **Locked** (founder, 2026-07-12; amended 2026-09-06). **Owner:** Jordan.

> **Founder ruling 2026-09-06:** the racing line and the **time-delta line** come first, with
> **no distance calibration** — same-video relative, a place on the picture is a place on the
> track. The delta is a **chart under the player**, not colour on the line. Speed in km/h stays
> later, and the route to a scale is **the car's own known size** (190 mm × ~360 mm) read off
> the picture, not a tape survey; the trace stores every blob's box so that needs no re-trace.
> Built the same day — see the changelog.

> **Founder ruling 2026-07-12:** corner-by-corner sector deltas deliver the majority of a speed trace's value. Phases 2–3 (metric survey → speed channels) stay queued *after* the rework's Phase C cleanup, and their bar is "worth the extra precision," not "core to the product."

The behavioral spec for turning **fixed-camera video into race data**. `PRODUCT_NORTH_STAR.md` ranks video analysis (pillar 6); this doc says what the video pipeline is becoming, which outputs are trustworthy at what level, and in what order to build. When a video feature feels off-scope or an accuracy claim feels optimistic, check here.

Sources: founder interview 2026-07-10 (two structured rounds) + code audit of `video-analysis/` (Python worker) and `src/lib/videoAnalysis/` + first-principles accuracy analysis (same session).

---

## North star sentence

> **Turn a video of a run into a data trace the driver and the Engineer read the way full-size motorsport reads MoTeC — leading with the channels the physics makes near-perfect, and labeling the rest exactly as trustworthy as they are.**

---

## The goal

Two layers, one pipeline:

1. **Compare two laps visually** — position-synced ghost overlay (two videos at 50% opacity, aligned by track position). **Already working well** (`src/components/videos/`).
2. **Turn fixed-view video into data** — calibrate the image to real distances by picking surveyed points, track the car(s), and derive timing/speed channels per lap.

Strategic context: this is the **video half of the PWM-logger hypothesis** ("video + simple PWM logger ≈ 95% of telemetry value", `PRODUCT_NORTH_STAR.md` 12–24mo). Every validated channel here de-risks that bet.

---

## Trust doctrine (the core founder ruling, 2026-07-10)

**Trust is per-channel.** Ship the channels the physics makes near-perfect as the headline; label estimates as estimates; never present a noisy channel with instrument confidence. MoTeC-grade *absolute* speed from a drivers'-stand phone video is **not achievable** and is a non-goal — but the channels below answer the questions MoTeC answers.

### Channel ranking (founder-ordered)

| # | Channel | Trust tier | Achievable accuracy | Why it ranks here |
|---|---|---|---|---|
| **1** | **Corner-by-corner time delta between two laps** | Near-perfect | Sub-frame crossing interpolation; calibration errors cancel between laps | **The headline.** Directly interpretable by driver *and* Engineer — "you gained 0.3s in the sweeper" needs no data-line literacy. |
| **2** | **Same-video relative comparison (car vs car, same race)** | Near-perfect relative | Same camera, same calibration, same conditions → systematic errors cancel almost entirely | Compare your car to a rival **in the same heat** — where they gain, where you gain. Multi-car tracking already exists in the worker. |
| **3** | **Lap & sector times** (virtual timing lines) | Near-perfect | ±5–15ms (60fps + sub-frame interpolation); gated against transponder | Already built + validated (`validate.py`, 0.15s gate). |
| **4** | **Speed trace (relative / lap-vs-lap)** | Good | ~1–2% between laps from the same camera position | Where run A carried more speed than run B. |
| **5** | **Speed trace (absolute km/h)** | Labeled estimate | ±3–5% in well-resolved zones, worse far-side | Useful, honest, never headline. UI always presents as estimate. |
| — | MoTeC-grade absolute speed (±0.5%) | **Non-goal** | Not achievable from this capture setup | Chasing it burns trust on channels 1–4. |

**UI rule:** trust tier is visible wherever a channel is shown (styling/wording, not disclaimers-in-fine-print). Relative channels lead; absolute speed never appears without its estimate framing.

---

## Physics constraints (what sets the accuracy ceiling)

Worked for the standard capture case — iPhone 4K/60 on tripod, drivers' stand ~3–4m up, TC track ~30×20m:

- **Camera height is the dominant accuracy lever.** Far-side elevation angle ~8–9° means: depth resolution degrades to several cm/px, boards occlude long ground shadows, and car-body height (~4–5cm above the track plane) projects its apparent ground position **~30cm off**. Every meter of height improves all three at once.
- **Car-height parallax is systematic and correctable** — camera pose from calibration lets the worker back it out. It must be corrected, not ignored: it's the difference between a hack and a trustworthy trace.
- **Speed = differentiated position** → smoothing over ~0.2s windows is mandatory; corner minimum speeds are mildly low-passed.
- **Errors that are identical for two laps (or two cars) in the same video cancel** — this is why relative channels sit two trust tiers above absolute ones.

### Capture doctrine

- 4K/60, locked tripod, **as high as physically possible** — data quality is set at filming time.
- Mark the mount position on the stand (already in the worker README checklist) — same position across a session means one registration for all comparisons.
- Degrade gracefully on lesser footage; never refuse, but trust tiers drop and the UI says so.

---

## Calibration doctrine

The founder constraint: heavy calibration is acceptable **once per track**, not per camera angle or per use. The design splits accordingly:

| Step | Frequency | Effort | What it is |
|---|---|---|---|
| **Metric survey** | Once per **track + layout** | Tape-measure 4–8 distances between durable landmarks (board joints, apex markers); tap those points on a reference image | Upgrades the existing camera-profile reference from image-space to **meters**. Stored on the track entity; a layout change invalidates it (layouts are already first-class on tracks). |
| **Registration** | Once per **camera position** | ~60s: existing homography alignment (`align.py`) maps a new video onto the reference frame — already built and automatic | If the tripod doesn't move all session, this happens once for every run filmed that day. |

No per-use calibration. Auto-matching landmarks to make registration zero-tap is a later upgrade, not a requirement.

---

## Current state (built — do not re-spec)

The pipeline is substantially further along than "overlay only":

| Piece | Where | Status |
|---|---|---|
| Ghost overlay, position/frame-lock synced | `src/components/videos/` (`videoOverlaySync`, `VideoOverlayClient`) | ✅ Working well (founder, 2026-07-10) |
| Python worker: YOLO detection (+ motion-only fallback), MOT tracking, sub-frame sector crossings | `video-analysis/rc_video_analysis/` (`analyze.py`, `tracker.py`, `geometry.py`) | ✅ Built |
| Homography alignment of new video → reference frame | `align.py`; `TrackCameraProfile.lastAlignmentJson` | ✅ Built (image-space only, not metric) |
| Per-track camera profiles + sector lines + lens intrinsics | `TrackCameraProfile` / `TrackSectorLine` (Prisma), `TrackCameraProfileEditor` | ✅ Built |
| Worker JSON import, multi-car sector matrix, MOT id-swap corrections | `src/lib/videoAnalysis/` (`types.ts`, `sectorStats.ts`), job routes | ✅ Built |
| Transponder validation gate (median lap delta ≤0.15s, ≥80% within) | `validate.py`, `compareTransponder.ts` | ✅ Built |

**What does not exist yet (the actual build):** metric ground-plane calibration; speed channels; dashboard//analysis entry doors for the compare surface; Engineer integration. **Built 2026-09-06 without metres:** continuous per-frame position per lap (the in-browser tracer, `src/lib/videoAnalysis/trace/`, opt-in "Trace L7" on the compare step), distance-along-the-lap in picture units, the racing line on the player, and the continuous delta line between two traced laps, checked against the sector board. The lap-vs-lap and car-vs-car **time-delta surface is built** (Phase 1, 2026-07-10).

---

## Rollout

| Phase | Scope | Gate | Status |
|:--:|---|---|---|
| **0** | Sector timing pipeline + transponder gate + ghost overlay | `passesGate0_15` on real footage | ✅ Built |
| **1** | **Corner-by-corner time delta surface** — lap-vs-lap per-sector delta from **existing** sector-crossing data (no new calibration, no metric survey). Same-video car-vs-car included. UI interview-locked 2026-07-10 — see "Phase 1 UI spec" below. | Founder reads a real two-lap delta and trusts it | 🟡 **Built + verified on synthetic results 2026-07-10** (`lapCompare.ts` + `LapComparePanel` in the session expanded view, `SectorClipPlayer` ghost clips; preview: `/debug/lap-compare-preview`). Gate still open — needs a real worker-results job. Deviations from spec: section (not tab) in the expanded view to match its flat structure; inline picker (not bottom sheet); dashboard//analysis doors not built yet. |
| **1b** | **Racing line + delta line** (2026-09-06) — per-lap tracer in the browser pinned to the scan's crossings; the path drawn on the compare player; the time delta between two traced laps as a chart under it, sector lines as ticks, checked against the board at every line. No metres. | Curve agrees with the sector board at every line within 0.08 s on real footage | 🟢 **Built + graded on Bendigo IMG_4522** (S3–S6 within 7 ms lap-vs-lap; far-end sectors are honest holes) |
| **2** | **Scale** — the founder's route is the car's known size read off the picture (every trace point carries the blob's box), a labelled estimate; a tape survey stays possible but is not the plan. Car-height parallax correction as before. | Integrated distance/time reproduces transponder lap times (free ground truth) | ⬜ |
| **3** | **Speed channels** — distance-along-track + smoothed speed; lap-vs-lap speed deltas; same-video car-vs-car speed comparison; absolute speed shown as labeled estimate. The slope of the delta line already says where one lap carried more speed. | Relative deltas stable across repeated laps at steady pace | ⬜ |
| **4** | **Engineer integration** — sector deltas + speed-by-section as evidence tied to runs/setup changes ("stiffer springs: +0.2s in the sweeper, −0.1s in the chicane") | Engineer cites video evidence correctly in real answers | ⬜ |

**Legend:** ✅ done · 🟡 partial · ⬜ not started

**Sequencing rule (inherited from `PRODUCT_NORTH_STAR.md`):** this remains pillar 6 — phases 2+ don't start while pillar 1/2 work (logging seamlessness, Engineer trust) has open fires. Phase 1 is cheap enough to slot opportunistically.

### Phase 1 UI spec (interview-locked 2026-07-10)

Prototype (approved direction): https://claude.ai/code/artifact/9ad952ee-3dec-414e-9216-899a894c58c4 — port faithfully per the visual-iteration workflow.

| Decision | Founder ruling |
|---|---|
| **Form** | **Ranked gain/loss cards** — sectors sorted by \|delta\|, biggest story first; prose-legible, no chart literacy required. Near-even sectors (\|Δ\| < ~0.02s) collapse to quiet single rows. Diverging-bar / cumulative-line forms rejected as primary. |
| **Placement** | **Compare tab in the session expanded view**; entry tabs/doors from dashboard and `/analysis` open the same surface. |
| **Default compare** | **My best lap vs my 2nd-best**, auto-selected on open — value before any picking. Lap picker (bottom sheet) to change. |
| **Hero** | Big total delta (mono, gain/loss color) + a **deterministic template sentence** from sector math ("almost all of it in two corners") — not an LLM call, never wrong. |
| **Order strip** | **Keep** — thin segmented lap-in-order strip (width ∝ sector duration, green/red intensity ∝ delta) above the cards; tap a segment jumps to its card. Coexists with the Biggest-first / Track-order sort toggle. |
| **Clip interaction** | Tap a sector card → **real ghost-overlay video**, seeked to that sector's crossing times for both laps, inline. Reuses the working overlay player. |
| **Car-vs-car** | **Ships in v1** — "Another car" segment in the lap picker; same surface, different lap source. Same-video trust framing shown in the picker. |
| **Trust line** | Footer, mono faint: sector timing from video, validated vs transponder (quotes the gate). |
| **Color/type** | Per `VISUAL_NORTH_STAR.md`: green/red = pace deltas only, yellow = tap targets only, mono for all times/deltas, Sora for names/prose. |

---

## Non-goals

| Not the goal | Why |
|---|---|
| MoTeC-grade absolute speed | Physics of low-elevation phone video; chasing it erodes trust in the honest channels. |
| Moving / handheld / panning camera support | Fixed camera is the contract; panning breaks the homography model entirely. |
| Live real-time processing trackside | Post-session analysis; worker runs offline. |
| Replacing transponder timing | Transponders stay the venue clock and our validation ground truth. |
| Driving-line coaching product | Line data falls out of tracking and may be *shown*, but coaching UX is not in scope here. |

---

## Success signals

- Founder makes a real setup/driving decision from a corner-delta view at an actual meeting.
- Phase 2 gate holds across ≥3 tracks (integrated traces reproduce transponder times).
- Engineer answers citing video sector evidence rate well in the existing quality loop.

---

## Implementation map

| Concern | Where it lives |
|---|---|
| Python worker (detect / track / align / crossings) | `video-analysis/rc_video_analysis/` |
| Worker JSON contract | `src/lib/videoAnalysis/types.ts` (`VideoAnalysisResultV1`) |
| Camera profiles, sector lines | `TrackCameraProfile`, `TrackSectorLine` (Prisma); `TrackCameraProfileEditor.tsx` |
| Sector stats, transponder compare | `src/lib/videoAnalysis/sectorStats.ts`, `compareTransponder.ts` |
| Ghost overlay | `src/components/videos/` |
| Analysis UI hub | `src/components/videoAnalysis/`, `/videos/analysis` routes |

---

**Changelog:**
- 2026-09-07 (third pass, driven) — **The tracer learns the track from laps it has already
  followed, and the delta line stops claiming things it cannot show.** Two findings ran the pass.
  **(1) The delta at a sector line was never actually pinned to that line.** A checkpoint only
  moved the search's starting segment and let the running position fall back; the value was still
  the nearest point on your line, which where two drivers take a corner differently sits a little
  before or after the crossing, always the same way. One Bendigo line read 32 ms early in 25 of 25
  pairs. Both laps' crossing of a line is the one moment in the whole comparison that is measured
  rather than inferred, so it is now a pin: the raw projection is warped so each crossing lands
  where it belongs and the stretch between two of them is stretched to match (`pinToCheckpoints`).
  The chart under the player and the table above it are now the same measurement, and the step
  that used to appear where a checkpoint snapped the line is spread across the sector.
  **(2) Pinning made the sector board unable to check the readings, so the board is asked a
  harder question instead**: every crossing is withheld from the projection in turn, and where it
  cannot then find that crossing within a quarter of a second the stretches either side carry no
  line — the readings AT the crossings stay, because they are two measured moments subtracted and
  the projection has no part in them (`MAX_HELD_OUT_SLIP_SEC`). Held out, the old projection was
  289 ms out on average and 2.8 s at worst, against the 13 ms the un-held-out check had been
  reporting. **(3) The tracer learns the track** (`road.ts`): every lap already traced off the same
  video contributes the stretches it followed cleanly, and where a lost window used to carry a
  one-second-old heading it now looks where the track goes. Measured first — in every stretch that
  was followed properly, the laps ran within 0.2 to 2.1 car lengths of each other at the same
  point of it. **(4) The road also judges what is being followed.** Aiming a lost window was only
  half of it; the worse failure is following something that is not the car, and at the Bendigo
  start line one lap spent its whole first sector on a flickering patch of the drivers' stand,
  never lost and never doubted. Six car lengths off the road for six frames now lets it go —
  but only between two crossings the scan actually found, because a crossing it could only put a
  time to makes the share of the sector a guess (a 4K lap lost two thirds of its frames to that
  before it was spelt out). **(5) A stretch that comes near neither of the crossings it runs
  between** is not a path through it (`segmentUnverified`) — it carries no delta and the line on
  the picture breaks across it. **(6) A thing that stands still for half a stretch is furniture,
  not a car**, and is dropped before the chain sees it (`withoutStanding`); **(7) a frame thrown
  out as the camera moving takes its two neighbours with it**, since one displaced frame spoils
  the difference on both sides of it and which side the guard notices is a coin toss.
  **(8) A leap that comes straight back is a spike the window could not see.** Reading the pace
  over a third of a second catches a stretch that is wrong and stays wrong, and is blind to an
  excursion that returns two frames later, because across the window the two halves cancel. On
  screen those are the tall thin needles that stretch the chart's whole axis: the biggest was
  0.596 s between two neighbouring places, and 43 of 52 pairs held one over 0.1 s. Nothing swaps
  half a second of advantage in a four-hundredth of a lap; what makes them is the projection
  standing still, so the time at that place is any of the moments in the stall. The same pace test
  now also runs neighbour to neighbour at a looser bound (`SPIKE_RATIO_MAX`), which costs 0.4 % of
  the drawn line and turns each needle into a short honest break.
  Against the same fifteen laps, graded the same honest way at both ends: mean coverage 90.3 →
  91.7 %, holes 13 → 2, ambiguous frames 63 → 9, **the share of the lap drawn AND independently
  checkable 55.4 → 71.2 %**, **readings lost at the sector lines 22.6 → 6.4 %**, the held-out
  reading error 23.3 → 17.1 ms mean and 57 → 42 ms at the ninetieth, readings the board disagrees
  with 8 → 3, and 8.0 → 6.8 s to trace a lap (the car is lost less, and a lost window is the
  expensive one). Tried and reverted, each on measurements: keeping the most car-sized blobs
  rather than the biggest (a recovered sector turned out to be a fixed point six hundred pixels
  away); charging more to skip a frame that held something moving (a real gain until the road
  filled the hole it was patching, then a loss on every count); gating the delta on how far a
  path landed from its crossings (cost 6 % of the line and removed no disagreement); shrinking a
  lost window because the road says where to look (coverage 92 → 87 %); and spreading the moving
  mask once instead of twice for a small car (the drawn line fell 72 → 51 %). Rigs:
  `scripts/tmp/replay-grade.mts` (re-chooses every path from sightings already read, so a change
  to the choosing is graded in a second rather than an hour), `why-hole`, `slipdist`,
  `checkpoint-slip`, `anchor-vs-board`, `line-spread`, `path`. Still open: the video's own lap
  time and the transponder's agree to 12 ms on the median pair and 98 ms at the ninetieth, and
  every one of the worst three is IMG_4523 lap 14, whose crossings the scan reads about a tenth
  of a second out — a crossing-detector question, not a tracer one.
- 2026-09-07 (later, driven) — **The car is found against a picture of the empty track, and the
  delta line stops drawing things that cannot have happened.** The camera was measured first,
  because everything below depends on it: sampling all four graded clips and lining every frame up
  against the first (`scripts/tmp/camera-drift.mts`), the picture never jolts — 0.00–0.01 px from
  one frame to the next on every clip — and creeps half a pixel over five minutes on the 1080p
  footage, 10.8 px over twelve minutes on the 4K, which is under half a pixel across any one lap.
  A phone on a tripod is what this product is for, so a still picture of the track is valid for a
  whole lap. **(1) The empty track** (`trace/background.ts`): one extra decode pass keeps five whole
  frames spread across the lap and takes the middle value of every pixel, so the cars vanish; costs
  2.2 s a lap (6.2 → 8.4 s). **(2) The difference is read two ways at once**
  (`diffWindowBg` in `imageOps.ts`): a pixel counts when it CHANGED, exactly as before, or when it
  both differs from the empty track and changed at least half as much as the gate asks. The pure
  still-picture difference was tried first and was a disaster — grain differs from the empty track
  too, a median of 181 blobs in one far sector against two for the frame before, the tracer steered
  onto grain, its idea of the car's size collapsed 24 → 8 px, which let more grain through, and
  three sectors went to zero. The two-ways rule is the one `motionMaskInBandBg` already uses at the
  sector lines. **(3) The shake guard was counting blobs**, which means nothing against a still
  picture where everything that is not track shows up; it threw away 211 frames of one lap. Since
  the camera provably does not move, the only test left is the honest one — a camera that moves
  lights up the whole window. **(4) "Two cars look equally good" was widened by a tenth of the best
  chain's own cost**, so the net was cast widest exactly where there were most candidates: 160
  ambiguous frames became 39 without changing a single reading, and the absolute figure is not
  sensitive (1.0 and 3.0 grade identically). **(5) The projection could leap 8 % of a lap in one
  frame** and did — 5.55 % while the car moved 0.22 % — putting one sector line's reading 1.2 s
  out. Its reach is now what the car itself travelled, times four, which still opens up across a
  hole. **(6) Nothing checked the line BETWEEN the sector lines**, and that is what a driver looks
  at: a seventh of every reading on the grading set implied one lap being twice the other's pace or
  worse, many of them the other lap taking negative time, and one pair's line climbed to "you are a
  second slower" inside a sector the board says you won by 0.281 s. Two properly followed laps hold
  that ratio under 1.59 (the cleanest pair on the set, median 1.05), so a stretch implying worse
  than three is blanked — except within two places of a line, where both moments come from the
  crossing scan and the projection has no say. Against the same fifteen laps: mean sector coverage
  87.5 → 90.3 %, holes 22 → 11, every lap now passing, readings lost at the sector lines 35.3 →
  23.0 %, disagreements with the board unchanged at 1 of 34 (0.089 s), and **the share of the lap
  drawn AND physically possible 63.7 → 67.1 %** (the raw drawn share falls 74.7 → 67.2 %, which is
  the point: what went was the impossible part). Rigs: `camera-drift.mts`, `pace-ratio.mts`,
  `curve-spikes.mts`, `proj-debug.mts`, `trace-backup.mts`. Still open: the far first sector
  (`sf→s1`, `s1→s2`) is where nearly every remaining gap is; the projection still steps visibly
  where a checkpoint snaps it at a line; and on IMG_4523 lap 14 the video's own crossings disagree
  with the transponder by 0.10 s, which is the crossing detector and not the tracer.
- 2026-09-07 — **Why the tracer loses the car, measured on the fifteen real traces; four fixes;
  one disagreement left in 34 pairs.** Counters first, changes second: every sector now records
  `frames { read, saw, shake }` and the tracer keeps the times it threw out, so a weak sector says
  which of the three things went wrong. Of the 1012 frames lost across the 41 sectors under 90 %,
  **58 % were seen and refused by the chain**, 16 % thrown out as camera shake, 15 % called
  ambiguous, and 11 % genuinely invisible — the small-and-slow far car, which was the fix everyone
  would have built first, is the smallest of the four. (`blind` counts shaken frames too: they are
  pushed with no blobs.) The 58 % had one cause: `browserTrace` handed `chainThrough` the car size
  the sector LINES imply, 6 px on a fisheye, while the tracer's own blobs measured 23–28 px (48 on
  the 4K). Every rule in `chain.ts` is in car lengths — `tolerance = carPx × (0.5 + 6dt)` is 4 px at
  30 fps — so ordinary centroid jitter cost more than `missPerFrame` and the programme found it
  cheaper to skip the car than to follow it. Four changes, each graded on all fifteen laps:
  **(1)** the chain is told the size the tracer measured (the median of `LapTracer.sizeAtT` over
  the stretch), **(2)** a busy frame is only the camera when nothing owns the movement — the top
  two blobs holding under 60 % of the moving mass, or one blob over 60 % of the window, which is
  what dilation welds a whole-scene shift into (measured against the WINDOW, never the car: keying
  it to the car deadlocks, since the car's size is only known from frames that were kept),
  **(3)** `MIN_SEGMENT_COVERAGE` 0.35 → 0.55, because the first two turned three sectors from
  honest gaps into confident lines 1.2–1.7 s wrong and took disagreements from 3 of 34 pairs to 9,
  and **(4)** no delta is read at a line either lap never located on the picture (`TraceSegment
  .pinned`), blanked on the road at the tick rather than in either lap's own clock — near such a
  line what is in doubt is exactly where the other lap's moment lands on the road. Result against
  the untouched tracer on the same footage: mean sector coverage 82.0 → 88.3 %, sectors under 60 %
  seen 17 → 9, under 90 % 41 → 23, share of the lap the delta line is drawn on 72 → 75 %, and
  **disagreements with the sector board 3 of 34 pairs → 1** (0.089 s, against a 0.08 s tolerance
  and the crossing detector's own accuracy). Cost: about 1.4 s a lap. Rigs live in `scripts/tmp/`:
  `parse-retrace.mjs` (where the lost frames went), `compare-runs.mjs` (two drive logs side by
  side), `cost-per-frame.mjs`, `gate-test.mts` (grades any trust rule against the board without
  re-tracing). Still open: "two cars look equally good" is now the main reason for a gap, and its
  margin is an absolute cost that no longer matches the cost scale the size fix produced.
- 2026-09-06 (driven) — **Twelve laps, three videos, two drivers: 31 of 34 delta pairs agree with
  the sector board at every line.** Traced through the app's own chips in real Chrome. Per video:
  IMG_4522 (Bendigo 1080p fisheye, Jordan + Justin) 8 laps, 25 pairs, 1 line over 0.08 s;
  IMG_4523 (same camera, Jordan) 4 laps, 6 pairs, none; IMG_4044 (4K TFTR, Jordan) 3 laps, 3
  pairs, 2 lines — all three on one lap whose opening sector was seen in 2 % of its frames.
  Coverage 65–95 % (the 4K lap is the best of them at 95 %), 4–17 s a lap, every crossing met on
  10 of 12 laps. Typical agreement per line is 5–50 ms; the whole-lap total lands within 10–40 ms
  of the transponder's lap-time difference, which is the crossing detector's own accuracy.
  Four faults found by the driving and fixed, each a rule now: **a sector the tracer saw in under
  35 % of its frames carries no delta** (7 % once drew a number 1.35 s wrong, 26 % drew 1.0–1.7 s;
  44 % and up agreed to hundredths); **both laps are carried out to their start and finish
  crossings** at the speed they were doing, so the lap reads line to line rather than
  first-frame-seen to last-frame-seen (this was biasing whole-lap totals by ~0.19 s), and the
  other lap is pinned to those two lines exactly as the checkpoints pin it at every line between —
  but only where your own lap reached them; **a hole is mapped through the carried-out path**, or
  a gap that begins at a crossing falls outside the range and is silently skipped; **a reading with
  a gap against it is not a reading**. Rig: `scripts/dev-trace-lap.mts … --laps 8,5,4 --their 16`
  traces many laps in one session, `scripts/tmp/grade-all.mts` prints every trace and every pair.
  Still open: the far end of a fisheye (the 4-pixel car), and a lap whose first sector is nearly
  unseen drifts at the next line (IMG_4044 L10, 0.30 s).
- 2026-09-06 — **Racing line + delta line built and graded, calibration-free.** After a
  discussion of "video telemetry" the founder chose: line and delta first, chart under the
  player, km/h later from the car's size. `src/lib/videoAnalysis/trace/`: `tracker.ts` (a crop
  window follows the car; heading and turn from 0.3 s of sightings; lost → the window grows with
  the last speed plus an acceleration bound and is drawn to the next crossing; the car's size is
  measured from the blobs it follows — on a fisheye the lines are all far and short and say
  6 px for a car that reads 20–40 px under the camera), `chain.ts` (every blob the window saw is
  kept; the path is the cheapest chain **pinned to the crossings at both ends**, a 2 s lookback
  with a hole edge from the best chain so far, jump cap 60 so another car costs more than a
  two-second hole; a second chain within 3 + 10 % is "ambiguous" and becomes a hole),
  `delta.ts` (the other lap projected onto the base lap's path with a monotone forward window
  and sector-line checkpoints; delta(s) = you − them, positive = you slower, holes stay null),
  `browserTrace.ts` (WebCodecs read of the lap once; every line calibrated as the scan does,
  each stretch read at the gentler of its two lines' gates; the SF and hand marks seeded off the
  footage). Stored on `manualJson.traces`; drawn by `TracePathLayer` inside `SectorClipPlayer`
  and `TraceDeltaChart` under it, with a quiet line naming any sector where the curve and the
  board disagree by > 0.08 s. Graded on Bendigo IMG_4522 (1080p fisheye): Jordan L8 86 %
  coverage, 8/8 crossings, no holes, 453 frames in ~4 s; L5 82 %, 8/8, three honest ambiguous
  holes at the far end; Justin L16 69 %, 7/8. Delta vs the board: S3–S6 within 7 ms (L8 vs
  L5), S3–S5 within 46 ms (L8 vs L16). Rigs: `scripts/dev-trace-lap.mts`,
  `scripts/dev-grade-trace.mts`; 22 unit tests in `npm run test:trace`. Not graded: IMG_4044
  (4K) and the Boronia race. Open: the 4 px far-end car (the known far-line limit), a
  nose-to-tail rival for under two seconds, the phone lane.
- 2026-07-10 — **Phase 1 built**: `src/lib/videoAnalysis/lapCompare.ts` (splits→segments math, absolute clip windows, template summary; tests in `test:video-analysis`), `LapComparePanel` section in the session expanded view (`RunHistoryTable` RunDetail), `SectorClipPlayer` (same video ×2, ghosted, dual-seeked to each lap's crossing, range-clamped). Verified headless on synthetic worker results + generated timecode video via `/debug/lap-compare-preview` (delta math, ranked/track sort, car-vs-car picker, ghost sync ±0.05s, end clamp). Legacy `VideoOverlayClient` found orphaned (propless, file-picker only) — clip player built fresh instead. Real-footage gate + entry doors + manual-mode adapter still open.
- 2026-07-10 — Phase 1 UI interview-locked (two further rounds + interactive prototype): ranked cards, session Compare tab, best-vs-2nd default, template hero prose, order strip kept, real ghost clips on tap, car-vs-car in v1.
- 2026-07-10 — Initial draft from founder interview (two rounds: capture reality, per-channel trust ruling, calibration budget, channel ranking) + code audit + accuracy analysis.
