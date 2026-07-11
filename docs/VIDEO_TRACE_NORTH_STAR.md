# Video Data Trace North Star

**Status:** **Locked** (founder, 2026-07-12). **Owner:** Jordan.

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

**What does not exist yet (the actual build):** metric ground-plane calibration; continuous per-frame position export (worker currently exports only line crossings); distance-along-track parameterization; speed channels; dashboard//analysis entry doors for the compare surface; a manual-mode (marks-based) adapter for the compare lib; Engineer integration. The lap-vs-lap and car-vs-car **time-delta surface is built** (Phase 1, 2026-07-10) pending real-footage validation.

---

## Rollout

| Phase | Scope | Gate | Status |
|:--:|---|---|---|
| **0** | Sector timing pipeline + transponder gate + ghost overlay | `passesGate0_15` on real footage | ✅ Built |
| **1** | **Corner-by-corner time delta surface** — lap-vs-lap per-sector delta from **existing** sector-crossing data (no new calibration, no metric survey). Same-video car-vs-car included. UI interview-locked 2026-07-10 — see "Phase 1 UI spec" below. | Founder reads a real two-lap delta and trusts it | 🟡 **Built + verified on synthetic results 2026-07-10** (`lapCompare.ts` + `LapComparePanel` in the session expanded view, `SectorClipPlayer` ghost clips; preview: `/debug/lap-compare-preview`). Gate still open — needs a real worker-results job. Deviations from spec: section (not tab) in the expanded view to match its flat structure; inline picker (not bottom sheet); dashboard//analysis doors not built yet. |
| **2** | **Metric layer** — survey UX on track camera profile (tap points + entered distances), ground-plane homography in meters, car-height parallax correction, continuous per-frame track export from worker | Integrated distance/time reproduces transponder lap times (free ground truth) | ⬜ |
| **3** | **Speed channels** — distance-along-track + smoothed speed; lap-vs-lap speed deltas; same-video car-vs-car speed comparison; absolute speed shown as labeled estimate | Relative deltas stable across repeated laps at steady pace | ⬜ |
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
- 2026-07-10 — **Phase 1 built**: `src/lib/videoAnalysis/lapCompare.ts` (splits→segments math, absolute clip windows, template summary; tests in `test:video-analysis`), `LapComparePanel` section in the session expanded view (`RunHistoryTable` RunDetail), `SectorClipPlayer` (same video ×2, ghosted, dual-seeked to each lap's crossing, range-clamped). Verified headless on synthetic worker results + generated timecode video via `/debug/lap-compare-preview` (delta math, ranked/track sort, car-vs-car picker, ghost sync ±0.05s, end clamp). Legacy `VideoOverlayClient` found orphaned (propless, file-picker only) — clip player built fresh instead. Real-footage gate + entry doors + manual-mode adapter still open.
- 2026-07-10 — Phase 1 UI interview-locked (two further rounds + interactive prototype): ranked cards, session Compare tab, best-vs-2nd default, template hero prose, order strip kept, real ghost clips on tap, car-vs-car in v1.
- 2026-07-10 — Initial draft from founder interview (two rounds: capture reality, per-channel trust ruling, calibration budget, channel ranking) + code audit + accuracy analysis.
