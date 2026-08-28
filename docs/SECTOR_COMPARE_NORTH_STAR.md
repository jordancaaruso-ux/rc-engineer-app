# Sector Compare North Star (driver vs driver)

**Status:** **Draft v1** — core rulings interview-locked via artifact 2026-07-21; details expected to
be refined ("definitely need to be refined — but the ideas are good"). **Owner:** Jordan.

**Prototype (all real data — keep this URL for iterations):**
https://claude.ai/code/artifact/78d2bf57-f6c3-471c-b83f-48ae00ba2b60

The behavioral spec for comparing **two drivers' sector pace from the same video** — aggregates
(top-5 / best), every number one tap from the footage behind it, and driven-line overlays. Extends
`docs/VIDEO_TRACE_NORTH_STAR.md` Phase 1 (lap-vs-lap deltas, locked) from single-lap compare to
**session-aggregate driver-vs-driver**; lives inside the IA of `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`
(sessions-first, `LapComparePanel` is the results home). Trust doctrine is inherited wholesale:
same-video relative comparison is a near-perfect channel; nothing here needs metric calibration.

Grounding data: the validated two-driver session of 2026-07-21 (Jordan vs Cooper Webster,
`IMG_4044.MOV`, recipe b22-t14 — 5 ms median vs hand marks; see agent memory
`autosnap-validation-results` + `sector-compare-workflows`).

---

## North star sentence

> **Pick a rival from the same video and see exactly where they beat you — every number opens the
> footage that proves it, every unreliable detection says so, and the driven line can be read
> without watching a single clip.**

---

## Interview-locked rulings (artifact rounds, 2026-07-21)

| Decision | Ruling |
|---|---|
| **Primary surfaces** | ~~Story cards + Sector matrix.~~ **Superseded 2026-08-28 evening: the Sector board** — the video, then ONE table in the lap sheet's grammar (you as the flat base, one driver as the coloured overlay, rows = laps), a Fastest chip per sector. Story cards, the matrix and the heat-grid tab are gone; the board IS the heat grid. Track map still secondary, not built. |
| **Basis** | **Top-5 average LEADS; best lap is the toggle.** (Founder initially chose best-first, reversed after using the prototype — race pace is the honest headline.) Top-5 = mean of the 5 fastest *clean* times per segment per driver. |
| **Sector click-through** | **"Right — build this."** Clicking any sector time opens the **time owner's** footage cropped to that sector. Beside the player: a **ranked rail of YOUR times for that segment** (each row shows its parent lap + lap time). Tapping a rail row **ghosts that lap over the playing clip** (identical clip padding ⇒ both start at sector entry, sync by construction). No intermediate page. |
| **Line overlay** | **Core feature**, not a toy. Static driven-line comparison on the real camera frame, **path only** for v1 (no speed color, no scatter — those must earn their place later). Founder accepted minutes-per-lap desktop compute and an imperfect fisheye edge. |
| **Lap heat-grid** (replaces "timeline") | Equal-width sector cells per lap. Color = delta vs the driver's **own median** (not the rival) — the job is "watch the car fall away down the run". **Purple = session-best** (either driver, racing convention). Width-proportional bars were **rejected** as unintuitive. Per-lap time + delta vs own median at row end. |
| **Suspect detections** | Segment values **>25 % off that segment's median** are detection artifacts (late/early crossing on a neighbouring line, crash windows) — flag ⚑, exclude from top-5 / spread / fastest-single, but **keep visible**. Never silently dropped, never invented. Incident laps likewise flagged and excluded from aggregates. |
| **Story cards form** | Ranked by |Δ| on the current basis, deterministic template sentence ("You take 0.158 s/lap out of Cooper in S4 → S5"), near-even sectors (|Δ| < 0.02 s) collapse to quiet rows. Order strip on top (width ∝ sector duration, tap → card). Inherits the locked Phase-1 card doctrine. |
| **Matrix form** | Rows = segments; cols = you-best · rival-best · Δbest · you-top-5 · rival-top-5 · Δtop-5 · your ±sd spread; LAP totals row. Every figure clickable → player. Mono, dense, right-aligned. |
| **Driver identity colors** | Two validated categorical hues (prototype: Jordan #d0772f — his car is literally orange on camera — rival #3e8fd0). Green/red stay reserved for pace deltas; yellow stays tap-targets-only per `VISUAL_NORTH_STAR.md`. |
| **Compare scope** | **Same-video only for v1** (trust tier 2 — systematic errors cancel). Cross-session/cross-video rival compare is out of scope until the doctrine says otherwise. |

---

## The surface

One compare surface, four tabs + shared chrome, reachable from the session expanded view
(`LapComparePanel` grows a "vs driver" mode — same home as lap-vs-lap, different lap source, exactly
as the locked Phase-1 spec's "Another car" picker anticipated).

- **Header**: both drivers (identity dots), hero totals on current basis + signed delta (mono,
  gain/loss color), deterministic template sentence naming the biggest edge — and the biggest
  give-back when one exists ("…but S5 → SF goes to Cooper, +0.027").
- **Basis toggle**: `Top-5 avg | Best lap` — re-bases every tab.
- **Tabs**: Story cards · Sector matrix · Track map · Lap heat-grid. (Line overlay is the fifth
  surface; it may live as a tab or inside the track-map tab — refine at build time.)
- **Track map tab**: the real camera frame (dimmed) + the profile's sector lines + one delta chip
  per segment positioned **on the driver's actual driven line** (mid-segment tracked point;
  fallback to line midpoint; clamp to the visible frame region). Chip tap → player.
- **Trust line footer** (mono, faint): detection recipe, validation numbers, and the
  suspect/incident exclusion rule, stated in one line.

### The sector player (shared by every tab)

- Opens on any sector-time tap with the **owner's** clip: the segment's video window
  (crossing-to-crossing from the compare data) **+ fixed pad (0.5 s) both sides**, cropped to the
  segment's region so the car is actually visible (see crop rules below).
- **Rail**: your times for that segment ranked fastest-first — `rank · time · L{n} · lap {t}` —
  with ⚑ suspect and incident chips inline. Rows with no watchable window are stated honestly.
- **Ghost**: tap a rail row → second `<video>` at ~55 % opacity over the main, both seeked to
  sector entry; equal padding means zero sync math. Drift-correct >80 ms. Ghost label shows lap,
  time, and signed delta vs the playing clip. Toggle ghost ⇄ replace.
- **Controls**: restart · pause/play · ½-speed (applies to both videos).
- Open refinement (founder listed "needs work" options unprompted-adjacent): whether ghost
  auto-enables with your best when opening a rival's sector, and whether side-by-side beats
  50 %-opacity stacking. Prototype ships tap-to-ghost; revisit after real use.

### Clip crop rule (from prototype iteration — these broke twice before working)

Per-segment crop = **percentile(3–97) bbox of tracked-path points inside the segment window,
UNION the two boundary lines' endpoints (lines must NEVER be percentile-clipped), + pad, clamped
to the visible fisheye region**. Same box for every clip of a segment (ghost alignment depends on
it). Full-frame clips are useless — a TC at 4 K full-frame is ~15 px after downscale.

---

## Data pipeline

### Aggregation layer (new lib — `src/lib/videoAnalysis/driverCompare.ts` or similar)

Input: two drivers' crossing times on the same profile's lines (detected via Find-crossings, or
hand marks — both already land in manualJson v2), plus each driver's **complete transponder lap
list**. Output: per-lap segment times + video windows, per-driver aggregates (best-lap segments,
top-5, median, ±sd on clean values, fastest-single with lap ref), ranked per-segment rails, and
suspect/incident flags.

Non-negotiable correctness rules (each one cost real debugging time in the offline loop —
see `autosnap-validation-results`):

1. **Walk lap starts over the COMPLETE lap list** including incident laps (excluded-from-stats
   laps still consume real time; dropping them shifted every later prediction by 23–53 s).
2. **Bin crossings by SF interval, never "its own lap"** — on real tracks in-lap offsets exceed
   lap time and wrap into the next lap. Also means: no corner-order/chain-violation metric.
3. **Honest not-found** — incident laps genuinely have no normal crossing; render gaps, never
   interpolate a time.
4. **Suspect filter** (>25 % off segment median) before any top-5 / fastest-single / spread stat.
5. Cross-check on first build: the lib must reproduce the reference aggregates in
   `Documents/rc-autosnap-results` (`compare-summary.json`) exactly.

### Sector times at scale: Find crossings (prerequisite for full rails)

Hand-marking gives 3 laps/driver; the rails and heat-grid want every lap. The **desktop-lane
"Find crossings"** action (already ruled: capability-gated button in the analyze flow, converged
recipe `b22-t14`: band_frac 0.022 · thresh 14 · blur 5 · min_area 12 · extend 0.35 ·
nearest-to-prediction) is what fills them. One SF anchor per driver; a second driver on the same
lines needs **zero** corner marks. ~2.5 min/lap at 4 K on the dev desktop; advise 1080p60 filming.

### Line overlay pipeline ("Trace lap" — per-lap, opt-in, desktop lane)

Port of the offline tracker **v2** (scratchpad `track_line.py`, design captured in memory
`sector-compare-workflows`):

- b22-t14 motion primitives at 0.75× (blurred max-channel frame diff, thresh 10), but
  **multi-track every moving blob** (greedy NN association, spawn on unmatched, TTL 15) and then
  **select the track that best matches the six trusted crossing times** (waypoint scoring:
  within ±0.4 s and ≤90 px of the line). Single-track v1 failed both possible ways — seeded on a
  traffic car at SF, and lost the car at the fisheye edge — the waypoint selection is the fix,
  not a nice-to-have.
- **Validation gate before drawing**: waypoint score ≥ 5/7 (and crossings from the traced path
  within a few frames of detected ones), else **refuse to draw that lap** — Jordan's bobble lap
  L12 scored 3/7 because the tracker followed something else; drawing it would be a lie.
- **Edge honesty**: clip points outside the visible fisheye ellipse
  (center 0.5/0.5 · rx 0.37 · ry 0.47 · ×0.92 — per-camera constants, derive from the frame) and
  render breaks; annotate "edge-zone junk excluded (n pts)". Never bridge a gap.
- Cost: ~15–20 min/lap at 0.75× on the dev desktop — hence per-lap opt-in ("Trace this lap"),
  results cached on the job (polyline `[xNorm, yNorm, tRel][]` per traced lap; storage on
  `VideoAnalysisJob.manualJson` or a sibling JSON column — decide at build).
- Overlay UI: real frame + up to ~3 lap polylines (solid per driver color; second same-driver lap
  dashed/lighter), faint sector lines for orientation, legend with lap + time, breaks note.

---

## Rollout

| Phase | Scope | Gate | Status |
|:--:|---|---|---|
| **1** | **Aggregation lib + cards & matrix + basis toggle** in the session compare surface, driver-vs-driver mode on `LapComparePanel`'s stack (`manualCompareAdapter` → new aggregate layer). Works with whatever crossings exist (hand marks ok). | Lib reproduces the reference dataset exactly; founder reads a real compare and trusts it | ⬜ |
| **2** | **Sector player** — owner clip + ranked rail + ghost (windows from Phase 1 data; video via the linked `VideoAsset`, local-first caveats apply — clips are seek windows into the one file, not transcodes) | Ghost sync ≤ 80 ms; founder uses it on a real rival sector | ⬜ |
| **3** | **Find crossings** (desktop lane, b22-t14 port to JS/wasm) → full rails + every-lap data without hand marking | Re-validate vs the same truth sets (Cooper 34/34 5 ms, Jordan SF 20/20 3 ms) | ⬜ |
| **4** | **Heat-grid + track map tabs** (pure rendering over Phase 1/3 data) | — | ⬜ |
| **5** | **Line overlay** — tracker v2 port + "Trace lap" + overlay render | Waypoint gate holds on ≥ 2 more videos (only IMG_4044 so far — one-video overfit risk) | ⬜ |

Sequencing rationale: Phases 1–2 deliver the locked winners with data that already exists; 3
removes the marking cost; 4–5 are additive views. Pillar-6 rule from `PRODUCT_NORTH_STAR.md`
still applies — slot opportunistically, don't displace pillar 1/2 fires.

---

## Non-goals (v1)

| Not the goal | Why |
|---|---|
| Cross-video / cross-session rival compare | Trust doctrine: same-camera cancellation is what makes the channel near-perfect. |
| Speed-colored driven lines | Founder: path only until the bare form earns more. Speed color re-enters via VIDEO_TRACE Phase 3 if ever. |
| Auto multi-car field scan (track everyone) | Ruled v2 in the auto-snap loop (needs field-lap imports for fingerprint matching; Speedhive personal imports lack them). |
| Live/trackside processing | Desktop lane, post-session. |
| Metric calibration for any of this | Everything here is same-camera relative — the survey stays a Phase-2 VIDEO_TRACE concern. |

---

## Open refinements (founder: "will definitely need to be refined")

- Ghost default: auto-overlay your best when opening a rival's sector, vs tap-to-ghost (shipped in prototype).
- Ghost readability: 55 % stack vs side-by-side option.
- Purple semantics: session-best-either-driver (prototype) vs personal-best split (classic green/purple timing-screen convention).
- Heat-grid color scale: prototype caps full intensity at 8 % of own median — feel-check on more sessions.
- Suspect threshold: 25 % of median caught all four real artifacts in the reference data; verify it doesn't over-flag on tighter tracks.
- Near-even card threshold (0.02 s) under top-5 basis.
- Clip pad (0.5 s) and ½-speed default for short sectors (< 2 s sectors are over in a blink).
- Where the line overlay lives (own tab vs layer on the track map).
- S5/fisheye zone: steer line placement to the frame centre (known from validation) — the compare
  surface should surface per-line detection quality so bad line placement is visible, not mysterious.

---

## Implementation map

| Concern | Where |
|---|---|
| Aggregation lib (binning, suspect filter, rails, windows) | new `src/lib/videoAnalysis/driverCompare.ts` (+ tests in `npm run test:video-analysis`) |
| Compare surface + tabs + player | grows out of `LapComparePanel` / `SectorClipPlayer` (`src/components/videoAnalysis/`) |
| Crossing/mark data | manualJson v2 (`src/lib/manualVideoAnalysis/sessionModel.ts` — `videoTimeAtLapSf`, multi-driver roles already modeled) |
| Segment math precedent | `src/lib/manualVideoAnalysis/sectors.ts` (`computeLapBreakdown`), `src/lib/videoAnalysis/lapCompare.ts` |
| Lines / profiles | `TrackCameraProfile` + `TrackSectorLine` (Prisma); line sets per `analyze-flow-lines-step` |
| Find crossings recipe + truth sets | `Documents/rc-autosnap-results` (scripts, loop-results, compare-summary) — preserved outside the repo |
| Tracker v2 reference implementation | scratchpad `track_line.py` (session dc85d2a6…, 2026-07-21) — design also captured in memory `sector-compare-workflows` |
| Prototype to port faithfully | https://claude.ai/code/artifact/78d2bf57-f6c3-471c-b83f-48ae00ba2b60 |

---

**Changelog:**
- 2026-07-21 — Initial draft from the artifact prototype + two interview rounds (surfaces, basis
  reversal to top-5, click-through verdict, line-overlay-as-core, heat-grid respec with purple).
  All prototype numbers real (Jordan vs Cooper, recipe b22-t14). Founder: ideas good, details to refine.
