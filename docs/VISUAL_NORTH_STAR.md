# Visual North Star — Technical v2

**Status:** Locked (June 2026). **Branch:** `design/visual-rework`.

This document is the **single source of truth** for UI/visual work in JRC Race Engineer. When a screen feels off-brand or inconsistent, check here before inventing new patterns.

**Hard rule for agents:** Visual changes must not alter behavior, data flow, or API contracts. Restyle only.

---

## North star sentence

> A premium racing instrument: **charcoal graphite** surfaces, **electric-but-confident yellow** for every action, **Inter** for all UI type, **JetBrains Mono** for data. Two voices — friendly prose to learn, mono instrument panel to trust — never cold, never gimmicky.

### Personality (locked)

| Dimension | Direction |
|-----------|-----------|
| Tone | Friendly expert + premium. A hint of competition energy — **not** dated motorsport (no checkered flags, racing stripes, faux-carbon). |
| Color | Yellow hero on charcoal graphite base. Inspired by electric sport on dark (DCL) — **not** flat #000 or club-race nostalgia. A trace of warmth remains in ink tones so the shell never reads cold. |
| Density | Balanced — scannable tables/lists without timing-software cramming. |
| References | [Drone Champions League](https://www.awwwards.com/sites/drone-champions-league) (yellow signal on dark), FIFA World Cup 2026 dark palette (warm browns), Charles Leclerc site (technical type pairing). |

### Design principles (from project brief)

1. **Zero behavior change** — visual rework only; same flows, same data.
2. **Trust first** — especially login and dashboard; drivers must feel this is a serious tool.
3. **Intuition** — one obvious next action; labels and hierarchy do the work.
4. **Polish** — consistent tokens, primitives, and spacing; no one-off hex unless migrating.
5. **Mobile-first** — every Tier A screen works at **390px** with the bottom tab bar visible.

---

## External references

| Asset | Location |
|-------|----------|
| Figma file | [JRC Race Engineer — Visual Rework v1](https://www.figma.com/design/AL36e2hCGuBHfbVzuheJYW) — pages `00 — Brief`, `01 — North Star` |
| Local screenshot | `.design-assets/north-star-v1.png` (Warm v1 board; Technical v2 is the locked direction) |
| Original planning chat | Visual north star lock + journey map (June 2026) |

---

## Palette

Use **Tailwind semantic tokens** (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.). They resolve to RGB triplets in `src/app/globals.css` `:root`.

| Token | Hex | Tailwind / CSS | Use |
|-------|-----|----------------|-----|
| `bg` | `#121110` | `background`, `--color-background` | App background (flat) |
| `surface` | `#181716` | `card`, `--color-card` | Cards, panels |
| `surface-inset` | `#151413` | `secondary`, `input`, `--color-secondary` | Inputs, inset areas |
| `elevated` | `#1E1D1C` | `muted`, `--color-muted` | Hover, menus, raised |
| `line` | `#282726` | `border`, `--color-border` | Hairline borders, dividers |
| `ink` | `#ECE9E4` | `foreground` | Primary text |
| `ink-2` | `#A09D96` | `muted-foreground` | Secondary text |
| `ink-3` | `#64625E` | `faint` | Labels, captions |
| **`accent`** | **`#FFD60A`** | `primary`, `accent`, `ring` | **Brand + all primary actions** |
| `accent-hover` | `#E6BE00` | `hover:bg-[#E6BE00]` on yellow CTAs | Pressed/hover yellow |
| `accent-fg` | `#121110` | `primary-foreground` | Text **on** yellow buttons |
| `gain` | `#4FD089` | ad hoc / `panel.tsx` dot `gain` | Positive data (faster, improved) |
| `loss` | `#E5644E` | `destructive` | Negative data, errors |

### Retired (do not reintroduce)

- Red primary `#c92a2a` and blue accent `#2563eb` as brand colors.
- Red/blue body mesh (`--body-glow-*`, `--body-stripe-*`) — set to `0` on default theme.
- Dusty rose `#D9A299` accent.
- Cool grey “runna” surfaces on user-facing screens (tokens neutralized to charcoal in `:root`).
- Italic uppercase Montserrat page chrome.

### Color semantics

- **Yellow = action only** (CTAs, focus rings, active nav). Never use yellow to mean “fast lap” or “good data.”
- **Green / red = data deltas** (`gain` / `loss`).
- **Dark text on yellow** — always `primary-foreground` (`#121110`), never white on yellow.

---

## Typography

**Two voices.** Every text element maps to exactly one tier below — no Heebo, HK Grotesk Wide, Montserrat, Archivo, Geist, or Plus Jakarta in production UI.

Loaded in `src/app/layout.tsx`:

| Tier | Font | Weights used | CSS hook |
|------|------|--------------|----------|
| **1 — UI sans** | **Inter** (Google Fonts via `next/font`) | 400 body · 500 inactive nav · 600 micro headings · 700 sections/nav active/buttons · **800 hero `PanelTitle`** · **600 semibold entity names** | `--font-ui`, `font-sans`, `PanelTitle`, `.page-title`, `.hub-row-title` / `HubRowTitle`, `.section-title`, `.session-group-title`, `.run-details-tab`, `.ui-title`, `.ui-label-*`, `.ui-control`, `.primary-action-chip`, nav labels, chat body + speaker tags |
| **2 — Data** | **JetBrains Mono** | 400–500 labels/values · 500 stat values | `font-mono`, `.type-data-label`, `.type-timestamp`, `.table-col-header`, `<Eyebrow>`, `<StatTile>` |

Inter and JetBrains Mono are SIL OFL.

### Element → tier matrix (locked)

| Element | Tier | Size | Weight | Case / tracking |
|---------|------|------|--------|-----------------|
| Page title (`.page-title`) | Inter | 20–22px | **600 semibold** | Sentence · `tracking-tight` |
| Hub row title (`HubRowTitle`, `.hub-row-title`) | Inter | 17–18px | **600 semibold** | Sentence · `tracking-tight` |
| Hero card title (`PanelTitle`) | Inter | 20–22px | **800** | Sentence · `tracking-tight` |
| Section header (`.section-title`, `SectionTitle`, `.run-details-tab`) | Inter | 13–14px | 700 | Sentence · `tracking-tight` |
| Primary nav label (bottom + sidebar) | Inter | 10px | 500 inactive / 700 active | Sentence · `tracking-tight` |
| Section label / eyebrow (`<Eyebrow>`, `.type-data-label`, StatTile label) | JetBrains Mono | 10px | 400 | **Uppercase** · **`0.28em`** |
| Table column header (`.table-col-header`) | JetBrains Mono | 10px | 400 | **Uppercase** · **`0.28em`** · faint |
| Stat value (`StatTile` value) | JetBrains Mono | 18px | 500 | Tabular nums |
| Timestamps (`.type-timestamp`, `<RelativeTime>`) | JetBrains Mono | 10px | 400 | Sentence · tabular nums · faint |
| Lap times, deltas, run IDs, setup values | JetBrains Mono | varies | 400–500 | Tabular nums |
| Body / form copy | Inter | 13–15px | 400 | Sentence |
| Page subtitle (`.page-subtitle`, `PanelSubtitle`) | Inter | 13px | 400 | Sentence |
| Entity names in lists (`.ui-title` semibold) | Inter | 13–14px | 600 | Sentence |
| Chat speaker tags (`You` / `Engineer`) | Inter | 10px | 600 | Sentence — **not** Eyebrow |
| Chat body / prose summaries | Inter | 13–15px | 400 | Sentence — inline numbers stay Inter |
| Primary CTA label (`.primary-action-chip`) | Inter | 11–13px | 700 | Hero: optional uppercase `0.12em` |
| Caption / hint (`.ui-caption`) | Inter | 11px | 400 | Sentence |

### Rules

1. **Never mix tiers on the same semantic role** — e.g. section labels are always `<Eyebrow>` (mono), never `.ui-title`.
2. **No separate display font** — page titles use Inter weight/size hierarchy only (semibold), not a third typeface.
3. **Mono tracking is always `0.28em`** for uppercase micro labels (`.type-data-label`, `.table-col-header`). Do not use `0.2em` / `0.14em` one-offs.
4. **Prefer `font-mono` over `font-sans tabular-nums`** for numeric data (setup sheet values, tables, metrics).
5. **Do not set inline `fontFamily`** in components — globals + shared classes win.
6. **Chat inline numbers stay Inter** — only dedicated metric/setup/table/timestamp surfaces use mono.

### Retired (removed June 2026)

`Heebo`, `HK Grotesk Wide`, `Montserrat`, `Geist Sans`, and **Archivo Expanded** are **no longer loaded**. Do not reintroduce a second UI sans or display-only page-title font.

---

## Geometry & spacing

| Element | Radius | Tailwind |
|---------|--------|----------|
| Hero panel | 16px | `rounded-2xl` (`SurfaceCard` variant `hero`) |
| Card / panel | 12px | `rounded-xl` |
| Button / input | 8px | `rounded-lg` |
| Badge / chip | 6px | `rounded-md` |

- **Borders:** 1px hairline `border-border` (`#282726`).
- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 (Tailwind default).
- **Shadows:** subtle charcoal depth on cards; yellow glow on hover via `SurfaceCard` (dashboard pattern).

---

## Background treatment

| Context | Treatment |
|---------|-----------|
| Default app shell | **Flat charcoal** (`#121110`) — no red/blue mesh |
| Login | Faded hero wash (yellow top glow + ember bottom + fine grain) on flat base |
| Dashboard hero | `SurfaceCard variant="hero"` — warm glow on hover; static hero acceptable |
| Data-heavy screens (sessions, setup, tables) | **Calm flat** — no photography, no strong gradients |

---

## Component vocabulary

Use these shared primitives so every screen reads as one system. **Do not invent parallel card/stat/label patterns.**

| Primitive | File | When to use |
|-----------|------|-------------|
| `SurfaceCard` | `src/components/ui/SurfaceCard.tsx` | Base charcoal surface; `hero` or `panel` variant |
| `CardPanel` | `src/components/ui/CardPanel.tsx` | Standard content card (wraps `SurfaceCard`) |
| `HeroPanel` | `src/components/ui/HeroPanel.tsx` | Legacy hero wrapper — prefer `SurfaceCard variant="hero"` on new work |
| `PanelTitle`, `PanelSubtitle`, `HubRowTitle` | `src/components/ui/panel.tsx` | Card headlines + supporting line; hub row labels |
| `Eyebrow` | `src/components/ui/panel.tsx` | Mono uppercase section label with optional dot |
| `StatStrip`, `StatTile` | `src/components/ui/panel.tsx` | Hairline-separated metric strip (instrument panel) |
| `Button` / `ButtonLink` | `src/components/ui/Button.tsx`, `ButtonLink.tsx` | Primary (yellow) and outline actions |
| `SectionTitle` | `src/components/ui/SectionTitle.tsx` | Section headers in lists (audit when touching) |

### Page chrome

- **Header:** `.page-header` + `h1.page-title` + `p.page-subtitle` — title block uses `gap-1` via `:has(.page-title)`; subtitle matches `PanelSubtitle` (`13px`, `leading-relaxed`, `text-muted-foreground`).
- **Hierarchy:** page title (Inter semibold) → page subtitle (Inter muted) → section `<Eyebrow>` (mono, faint, uppercase) — hero `PanelTitle` (Inter 800 sentence case) stays the in-card headline voice.
- **Body:** `.page-body` with `max-w-*` as appropriate; `gap-3` between major blocks (locked in CSS).
- **Mobile nav order (unchanged):** Dashboard · Analysis · **Add run (center)** · Garage · Engineer · Settings.

---

## Journey map & rollout status

Ranked by daily use and trust impact. **Finish each tier before inventing screen-specific styles.**

### Tier A — Core (~80% of daily value)

| ID | Route | Nav | User question | Rework focus | Status |
|:--:|-------|-----|---------------|--------------|--------|
| A1 | `/login` | — | “Is this legit?” | Trust, minimal chrome, clear Google CTA | ✅ Technical v2 (Inter + token alignment) |
| A2 | `/` | Dashboard | “What should I do next?” | One clear next action; calm hero | ✅ Panel primitives + hero; tightened vertical density (June 2026) |
| A3 | `/runs/new` | Add run | “How do I log today?” | Single obvious path; mobile form clarity | ⬜ Tokens only — needs panel pass |
| A4 | `/runs/history` | Analysis → Sessions | “What happened?” | Scannable rows; dense data without chaos | 🟡 Table mono headers + Eyebrow sections |
| A5 | `/engineer` | Engineer | “What should I change?” | Readable chat; clear context | 🟡 Partial (`EngineerPageClient` uses `Eyebrow`; speaker tags Inter) |

### Tier B — Support (setup context)

| ID | Route | Hub | Rework focus | Status |
|:--:|-------|-----|--------------|--------|
| B1 | `/assets` | Assets | Hub — Eyebrow sections (My / Global assets) | 🟡 Partial |
| B2 | `/cars`, `/cars/[id]` | Assets | Entity list + detail pattern | ⬜ |
| B3 | `/tracks`, `/tracks/[id]` | Assets | List + detail | ⬜ |
| B4 | `/events`, `/events/[id]` | Assets | Dates, track, tires hierarchy | ⬜ |
| B5 | `/tires` | Assets | Catalog without visual noise | ⬜ |
| B5b | `/additives` | Assets | Additive catalog — mirrors `/tires` | ⬜ |
| B6 | `/analysis` | Analysis | Hub — same pattern as Assets | ⬜ |

### Tier C — Power user (inherit A/B language)

| Area | Routes | Notes | Status |
|------|--------|-------|--------|
| Setup pipeline | `/setup`, `/setup-documents/*`, `/setup-calibrations/*`, `/setup-sheet-models/*`, bulk import | Complex; inherit cards, tables, headers | 🟡 Eyebrow section labels (June 2026 typography pass) |
| Analysis tools | `/setup/comparison`, `/videos/*`, lap import | Data-heavy; flat surfaces, strong table hierarchy | 🟡 Eyebrow section labels on overlay + lap ingest |
| Run edit | `/runs/[id]/edit` | Same form patterns as Log run | ⬜ |
| Settings / admin | `/settings`, `/teams` | Simple list/settings pattern | 🟡 Eyebrow section labels on teams |
| Utility | `/privacy`, `/login/verify-request`, debug pages | Match shell only | 🟡 verify-request partial; theme preview Eyebrow |

**Legend:** ✅ done · 🟡 partial · ⬜ not started

### Recommended sequence

```
Foundations (globals.css tokens + fonts)
  → Shell (nav, page chrome)
  → Tier A screens (login → dashboard → log run → sessions → engineer)
  → Tier B hubs + one detail template
  → Tier C (inherit components only)
```

---

## Implementation map (code)

| Layer | File(s) | Notes |
|-------|---------|-------|
| CSS tokens | `src/app/globals.css` `:root` | Technical v2 palette; flat mesh |
| Tailwind | `tailwind.config.ts` | Semantic colors; Inter + JetBrains in `fontFamily` |
| Fonts | `src/app/layout.tsx` | `--font-ui` (Inter), `--font-mono-jb` |
| Panel DNA | `src/components/ui/panel.tsx` | Eyebrow, StatStrip, StatTile |
| Surfaces | `src/components/ui/SurfaceCard.tsx` | Prefer tokens over hardcoded `#1b1712` when refactoring |
| Theme preview | `html[data-theme-preview=...]` in `globals.css` | Dev-only; still has legacy red/blue — update or remove when touching |

---

## Checklist for any UI change

Before opening a PR or marking a screen “done”:

- [ ] Uses semantic Tailwind tokens — no new raw `#c92a2a`, `#2563eb`, or cool greys.
- [ ] Numbers and micro-labels use `font-mono` (JetBrains), not `font-sans tabular-nums`.
- [ ] Primary actions use `Button` / `ButtonLink` primary (yellow + dark text).
- [ ] Cards use `CardPanel` or `SurfaceCard`, not one-off `bg-card` wrappers with different radii.
- [ ] Section labels use `<Eyebrow>` where the dashboard does.
- [ ] Page title uses `.page-title` (Inter semibold sentence case).
- [ ] Works at 390px width with bottom tab bar.
- [ ] No behavior, routing, or API changes.
- [ ] Yellow is not used for data meaning (only actions / focus).

---

## Known gaps (causes of current drift)

Track these when prioritizing rework:

1. **Login** — ✅ Inter + semantic tokens (June 2026 typography pass).
2. **Logo** — `JrcRaceEngineerLogo.tsx` still red/blue gradient; type-based lockup on login is placeholder until yellow/brown asset ships.
3. **Partial primitive adoption** — `panel.tsx` only on dashboard + partial engineer; 37+ other routes use ad-hoc patterns.
4. **Numeric typography** — setup sheet values migrated to `font-mono`; Tier C routes may still have stragglers.
5. **Theme preview switcher** — alternate themes still reference old red/blue palette; section label uses `<Eyebrow>`.
6. **Legacy font cleanup** — Heebo + HK Grotesk Wide retired (June 2026); Inter two-voice system locked. Tier C section labels migrated to `<Eyebrow>` (June 2026 pass); remaining `ui-title` is entity names, field labels, badges, and chat speaker tags only.
7. **Figma** — screen templates for Tier A were planned but blocked by MCP rate limits; code-first rollout proceeded without full Figma component library.

---

## Out of scope (separate tracks)

- **Engineer KB content** — `content/vehicle-dynamics/*.md` and `parameterEffects/catalog.ts` (see `AGENTS.md`).
- **Logo/wordmark redesign** — planned Phase 2; yellow + warm-dark, replacing red/blue SVG.
- **New features** — this doc governs visual consistency only.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-20 | Palette shift — warm espresso → charcoal graphite (`#121110` base); neutralized page wash + card glow; ink tones slightly cooler; login hex aligned |
| 2026-06-20 | Page chrome pass — `.page-title` Inter semibold sentence case; restored header padding + title/subtitle gap; `.page-subtitle` aligned to `PanelSubtitle`; `Eyebrow` uses `text-faint` |
| 2026-06-24 | Tier C typography pass — migrate setup/bulk-import/calibration/tracks/events/teams/video section labels from `.ui-title` to `<Eyebrow>`; table debug headers use `.table-col-header` |
| 2026-06-24 | Inter two-voice typography — retired Heebo + HK Grotesk Wide; Inter (`--font-ui`) for all UI; JetBrains for data; `.type-timestamp`, `.table-col-header`; page titles Inter semibold; hub rows Inter semibold; login token alignment |
| 2026-06-24 | Typography unify pass — `.type-data-label` + `.section-title`; mono tracking `0.28em` everywhere |
| 2026-06-19 | Dashboard density pass — hero CTA bottom-align (`sm:items-end`); card padding ~20% tighter (`SurfaceCard` hero `p-4 sm:p-5`, panel `p-3`; `HeroPanel` `px-3 py-2.5`) |
| 2026-06-19 | Initial doc — locked Technical v2 spec, journey map, rollout status from `design/visual-rework` branch |
