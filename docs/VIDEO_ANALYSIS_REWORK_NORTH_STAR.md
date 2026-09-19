# Video Analysis Rework North Star

**Status:** **Locked** (founder, 2026-07-12). **Owner:** Jordan.

The UX/IA spec for reworking the video analysis system into the Technical v2 app. Complements `docs/VIDEO_TRACE_NORTH_STAR.md` (which owns channels/accuracy doctrine — what the data means); this doc owns **where video lives, how the flows work, and what gets retired**. Founder verdict driving it: the old surfaces "feel very out of date relative to the rest of the app."

---

## North star sentence

> **Video is part of the run record, not a separate mini-app: film a run, sync it in a minute on your phone, and the session shows where the time went — in the same design language as everything else.**

---

## Interview-locked rulings (2026-07-10)

| Decision | Ruling |
|---|---|
| **Entry model** | **Sessions-first + slim tools page.** Start and results live on the run/session (the `LapComparePanel` pattern); a slim "Video" door under `/analysis` keeps the library, orphan videos, and cross-session work. |
| **Engines** | **One flow, two engines.** A single "Analyze video" flow; manual marking is the built-in engine, worker-JSON import is the advanced lane. Results land in one place regardless of engine. |
| **Worker investment** | **Import lane only** — restyled, otherwise untouched. No server-side worker until the pipeline earns it (platform-bet rule). |
| **Device contract** | **Truly mobile-first for the analyze flow** — marking at the track between runs is the point. Touch scrubbing, big targets, thumb reach are first-class, not adaptations. |
| **Camera profiles** | **Move to the track entity** (Assets → Tracks → detail gets a Video/camera section). Analyze flows deep-link there when a profile is missing. |
| **Library home** | **Inside the Video tools page** (not Assets) — videos are analysis material. |
| **Storage doctrine** | **Local-first (locked 2026-07-12).** Heat videos assumed ~1GB — too heavy to upload by default. Videos stay on the phone; "save to library" is opt-in for keepers. Clips in the compare surface work only for saved videos, labeled as such. |
| **Process** | **Spec → artifact prototype → founder refines in artifact → build phase by phase.** |
| **Build order** | **Reachability → flow → tools.** |

---

## Audited current state (2026-07-10 — the "why")

Full audit in session history; the load-bearing facts:

1. **Everything funnels to one URL.** `/videos/analysis`, `/videos/overlay`, nav, and the `/analysis` card all collapse to `manual/new`. The worker job UI is reachable only via query-param-gated `jobs/new`.
2. **Orphaned dead code:** `VideoAnalysisHub.tsx` (contains the only "recent sessions" list — never rendered, so **users cannot return to past sessions** except by URL), `VideoLibraryClient.tsx` (the whole upload library — never rendered), `VideoOverlayClient.tsx` + friends (legacy overlay, route redirects away).
3. **The video never persists.** Manual flow uses a browser object URL; the user re-picks the file on every visit (`localVideoName` is just a text reminder). The durable `VideoAsset` store (blob/disk, has `runId`/`trackId` columns) exists but is disconnected from analysis — two parallel stores that never meet.
4. **No results layer.** The manual flow's output is the ghost overlay + a caption. Sector marks/deltas are in the data model (`ManualFrameMark`, `compareBestLaps`) but **no sector table or delta renders anywhere in the flow**. The new `LapComparePanel` (sessions) is exactly the missing results surface — it needs a manual-mode adapter (`computeLapBreakdown` already yields splits + absolute video windows).
5. **Mobile hostility everywhere:** 16ms single-frame taps at `text-[10px]`, hover-only hints, Shift-drag crop, 8px line-endpoint handles, raw-JSON textareas, run linking via raw cuid.
6. **Upload cap is 4MB on Vercel** — the current server route's body limit, not a platform ceiling (client-direct Vercel Blob multipart bypasses it). Real heat videos are 300MB–1GB+.

---

## Target IA

```
Session expanded view (Sessions / dashboard cards)
  ├─ Lap compare section (built — Phase 1 of VIDEO_TRACE)  ← results home
  └─ Video row: linked video(s) + [Analyze video] → full-screen flow

/analysis
  └─ Video door → slim tools page:
       recent analysis sessions (restored from orphaned hub)
       video library (restored from orphaned client)
       worker-JSON import lane (advanced)

Assets → Tracks → [track]
  └─ Video / camera section: camera profiles + sector-line editor (relocated)

Full-screen analyze flow (desktop-first since 2026-09-02, still works at 390; launched from
the Video page, its New analysis card, or a run)
  1 set up  → the video (file or library asset) AND the timing (run laps / one LiveRC link per
              person, "That's me" on any chip) on one screen
  2 lines   → pick or draw the line set
  3 sync    → one button: "My car is on the line here" for the chosen crossing
  4 scan    → "Find every crossing" reads everyone's quickest ten laps; the dots are a folded
              check, not a queue — hand-marking is gone from the rail
  5 compare → the sector board: rows = your laps, a reference row = one rival lap (or their
              best sectors, or your own best); tap = a real lap vs a real lap in the player
```

**Retire:** `/videos/overlay` route + `VideoOverlayClient` family (orphaned, superseded), `VideoAnalysisHub.tsx` and `VideoLibraryClient.tsx` as components (their *content* is resurrected inside the tools page), `/videos` marketing page (folds into the tools page), `jobs/new` as a user page (worker import moves into the tools page's advanced lane).

---

## Phases

| Phase | Scope | Status |
|:--:|---|---|
| **A — Reachability + results** | Session expanded view gets the Video row + Analyze entry; dashboard//analysis doors point at sessions-first; tools page v1 (recent sessions list + library resurrection); manual-mode adapter feeding `LapComparePanel` so manual marks produce sector deltas; video↔`VideoAsset` linking so re-entry stops re-picking files | 🟡 **Built 2026-07-11** (adapter `manualCompareAdapter.ts` + tests; `LapComparePanel` = run Video section with status row + Analyze CTA + both engines; `/videos` tools page `VideoToolsClient` resurrects sessions list + library upload; nav + `/analysis` card doors). Verified headless (3 panel states + tools page on real data). Video↔asset *linking in the analyze flow* deferred to Phase B (flow rework); library upload works now. |
| **B — Mobile-first analyze flow** | The 5-step full-screen flow rebuilt for touch: step rail, touch scrubber with coarse→fine gearing, big-target frame nudge, guided anchor/marking, Technical v2 skin throughout | 🟡 **Built 2026-07-11** (`AnalyzeFlowClient` replaces the legacy manual UX via `VideoAnalysisJobRouter`; same manualJson v2 schema + sync math underneath). Includes: library-asset pick with durable `videoAssetId` link (PATCH route extended, ownership-checked), run-laps timing default (`session-drivers`), fine wheel 1px=4ms + ±1-frame, guided mark queue with sibling-lap/fraction predictions, done-step compare preview, save-to-library. Verified headless end-to-end on stubbed endpoints (`/debug/analyze-flow-preview`). Not yet: crop UI in the new flow (stored crops preserved, not rendered), real-footage pass, founder feel-check on the touch transport. |
| **C — Tools + relocations + retirements** | Camera profiles move to track entity (touch-friendly line editor: bigger handles, hit-slop, zoom); worker import lane restyled; dead code deleted; `/videos/*` route consolidation | ⬜ |

Storage doctrine: **local-first, locked 2026-07-12** (see rulings table). If a big-file save path is ever needed, client-direct blob upload removes the current 4MB route cap.

---

## Prototype checklist (the artifact refinement round)

Prototype v1 (2026-07-10): https://claude.ai/code/artifact/2029c403-62a7-47af-8315-b54c8b1d9ba1 — 4 screens (Session / Analyze flow / Tools / Track), interactive sync + marking. Refine here before build.

- [ ] Session expanded view: Video row + entry states (no video / video linked / analyzed)
- [ ] Analyze flow: all 5 steps at 390px, thumb-reach layout, step rail
- [ ] Touch scrubber: coarse scrub → fine gearing → frame nudge interaction
- [ ] Marking step: per-lap per-line progress, skip-ahead affordances
- [ ] Tools page: recent sessions + library + advanced import lane
- [ ] Track entity: camera profile section placement

---

**Changelog:**
- 2026-09-03 — **The Video page stops at three rows.** Every analysis ever made was drawn at
  once, so the page ran metres long and "Start video analysis" — pinned to the foot of the
  tallest card — sat below the monitor. Both lists now show three with "View more (n)" /
  "Show fewer" under them, and Start sits directly under the track picker on every screen size.
- 2026-09-02 — **The flow goes desktop-wide and loses a step.** Founder walk-through of the whole
  path from Tools: every page "should take up the whole screen, same borders as the dashboard",
  and "video analysis in general is more of a desktop thing". `/videos` is three cards on the
  1760px measure (New analysis with the track picker, Analyses, Library); the standalone new-
  analysis page keeps working for run doors and wears the same card. In `AnalyzeFlowClient`
  Video + Timing merged into **Set up** (two cards side by side at `lg`); the "Paste LiveRC URL"
  button became a heading over an always-open lane; the lap chooser ("best 3 pre-selected") is
  gone because the scan reads the quickest ten itself; every driver chip carries **"That's me"**
  (`swapDriverRoles` in `sessionModel.ts` moves marks, anchors, pins, scan rows and the picker
  record with the person) and a later link whose name matches the LiveRC name in Settings swaps
  itself in. **Sync** is one button with one name — "My car is on the line here" — instead of a
  label that changed to "Move your anchor…" after the press. **Mark → Scan**: no Skip / Mark
  crossing, no paragraphs, no "Show me the cars" button (the picker still opens on its own when
  two cars share a rhythm); the dots table shows every scanned lap for every driver, folded under
  "Crossings · n of m"; the step ends in **View analysis**. `hasMarkedLap` now counts any whole
  lap of yours, not a ticked one. **Compare**: `DriverComparePanel` rebuilt — rows are your
  laps, a pinned reference row is one rival lap (their best by default; "Their lap" chips pick
  another, or "Best sectors"), tap a cell and that sector plays solid with the reference as the
  ghost; the top-5 average is a footer of numbers only ("impossible as a video"). Player across the whole width, sheet below (a side-by-side was tried the same day and pulled: "make the compare page video take up the whole width — put the table below").
  Rail: Set up · Lines · Sync · Scan · Compare.
- 2026-07-12 — **First real-footage findings + scrub fix.** Founder test on a real phone video: no live preview while scrubbing + page crash. Cause: a seek issued per drag event (decoder starvation on ~1GB files) + full re-render per event. Fixed in `AnalyzeFlowClient`: gated seek pump (one in-flight seek, always retargeting newest), `fastSeek` while coarse-dragging with an exact seek on release, imperative timecode/slider updates (scrub path leaves React entirely), `preload="auto"`, and anchor/pin/mark reads take the pending seek target so mid-seek taps can't record stale frames. Docs locked same day; storage = local-first; speed trace demoted (founder: sector deltas ≈ most of a speed trace's value).
- 2026-07-11 — **Phase B built**: `AnalyzeFlowClient` (5-step mobile flow: library/file pick with durable `videoAssetId` link, run-laps timing default, anchor sync, guided mark queue with sibling-lap predictions, done-step compare preview + save-to-library). `VideoAnalysisJobRouter` now routes manual jobs to it; job PATCH accepts ownership-checked `videoAssetId`. Verified headless end-to-end (`/debug/analyze-flow-preview`: pick→timing→3-frame nudge→anchor→3 marks→−0.200s preview, predictions exact). Legacy `UnifiedVideoAnalysisClient` now unreferenced — Phase C retirement candidate. Known gaps: crop UI not in the new flow; negative sibling predictions clamp to 0s; real-footage pass pending.
- 2026-07-11 — **Phase A built**: run Video section (status row + Analyze CTA + both engines via `manualCompareAdapter`), `/videos` tools page (sessions list + library resurrected), nav doors.
- 2026-07-10 — Initial: three interview rounds (surfaces, ambition, entry model A/B tradeoff, engines, storage, profiles, device contract, library home, worker investment, process, order) + full code audit (step maps, orphan inventory, storage limits).
