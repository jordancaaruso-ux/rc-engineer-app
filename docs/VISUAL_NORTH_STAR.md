# Visual North Star — Technical v2

**Status:** Locked (June 2026). **Branch:** `design/visual-rework`.

This document is the **single source of truth** for UI/visual work in JRC Race Engineer. When a screen feels off-brand or inconsistent, check here before inventing new patterns.

**Hard rule for agents:** Visual changes must not alter behavior, data flow, or API contracts. Restyle only.

---

## North star sentence

> A premium racing instrument: **warm-dark graphite** surfaces, **electric-but-confident yellow** for every action, **Plus Jakarta Sans** for reading and **JetBrains Mono** for data. Friendly to learn, technical to trust — never cold, never gimmicky.

### Personality (locked)

| Dimension | Direction |
|-----------|-----------|
| Tone | Friendly expert + premium. A hint of competition energy — **not** dated motorsport (no checkered flags, racing stripes, faux-carbon). |
| Color | Yellow hero on warm espresso base. Inspired by electric sport on dark (DCL), warm editorial browns (FIFA World Cup dark mode) — **not** cold charcoal or club-race nostalgia. |
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
| `bg` | `#17130F` | `background`, `--color-background` | App background (flat) |
| `surface` | `#1E1A15` | `card`, `--color-card` | Cards, panels |
| `surface-inset` | `#1B1712` | `secondary`, `input`, `--color-secondary` | Inputs, inset areas |
| `elevated` | `#241F18` | `muted`, `--color-muted` | Hover, menus, raised |
| `line` | `#2C2823` | `border`, `--color-border` | Hairline borders, dividers |
| `ink` | `#ECE7DF` | `foreground` | Primary text |
| `ink-2` | `#A89C8B` | `muted-foreground` | Secondary text |
| `ink-3` | `#6A645B` | `faint` | Labels, captions |
| **`accent`** | **`#FFD60A`** | `primary`, `accent`, `ring` | **Brand + all primary actions** |
| `accent-hover` | `#E6BE00` | `hover:bg-[#E6BE00]` on yellow CTAs | Pressed/hover yellow |
| `accent-fg` | `#17130F` | `primary-foreground` | Text **on** yellow buttons |
| `gain` | `#4FD089` | ad hoc / `panel.tsx` dot `gain` | Positive data (faster, improved) |
| `loss` | `#E5644E` | `destructive` | Negative data, errors |

### Retired (do not reintroduce)

- Red primary `#c92a2a` and blue accent `#2563eb` as brand colors.
- Red/blue body mesh (`--body-glow-*`, `--body-stripe-*`) — set to `0` on default theme.
- Dusty rose `#D9A299` accent.
- Cool grey “runna” surfaces on user-facing screens (tokens warmed to espresso in `:root`).
- Italic uppercase Montserrat page chrome.

### Color semantics

- **Yellow = action only** (CTAs, focus rings, active nav). Never use yellow to mean “fast lap” or “good data.”
- **Green / red = data deltas** (`gain` / `loss`).
- **Dark text on yellow** — always `primary-foreground` (`#17130F`), never white on yellow.

---

## Typography

Loaded in `src/app/layout.tsx` via `next/font/google`:

| Role | Font | Weights | Applied via |
|------|------|---------|-------------|
| UI — headings, body, buttons | **Plus Jakarta Sans** | 400–800 | `font-sans`, `font-display`, `.page-title`, `.ui-title`, `body` |
| Data — lap times, deltas, IDs, micro-labels | **JetBrains Mono** | 400, 500, 700 | `font-mono`, `Eyebrow`, `StatTile` |

Both are **free** (Google Fonts / OFL).

### Type rules

| Content | Treatment |
|---------|-----------|
| Page titles | Plus Jakarta 700, **sentence case** in JSX (CSS no longer uppercases). Class: `.page-title`. |
| Section labels / eyebrows | JetBrains Mono, **uppercase**, ~`tracking-[0.28em]`, `text-faint`. Use `<Eyebrow>`. |
| Lap times, deltas, run IDs | JetBrains Mono, `tabular-nums`. Prefer `font-mono` over `font-sans tabular-nums`. |
| Body / form copy | Plus Jakarta, 13–15px, `text-muted-foreground` for supporting lines |
| Primary CTA label | Plus Jakarta 700; optional `uppercase tracking-[0.14em]` on hero actions only |

### Legacy fonts (phasing out)

`Inter` and `Montserrat` remain loaded as `--font-sans` / `--font-display` fallbacks but must **not** be used for new UI. Remove stray `font-display` / italic-uppercase patterns when touching a file.

---

## Geometry & spacing

| Element | Radius | Tailwind |
|---------|--------|----------|
| Hero panel | 16px | `rounded-2xl` (`SurfaceCard` variant `hero`) |
| Card / panel | 12px | `rounded-xl` |
| Button / input | 8px | `rounded-lg` |
| Badge / chip | 6px | `rounded-md` |

- **Borders:** 1px hairline `border-border` (`#2C2823`).
- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 (Tailwind default).
- **Shadows:** subtle espresso depth on cards; yellow glow on hover via `SurfaceCard` (dashboard pattern).

---

## Background treatment

| Context | Treatment |
|---------|-----------|
| Default app shell | **Flat espresso** (`#17130F`) — no red/blue mesh |
| Login | Faded hero wash (yellow top glow + ember bottom + fine grain) on flat base |
| Dashboard hero | `SurfaceCard variant="hero"` — warm glow on hover; static hero acceptable |
| Data-heavy screens (sessions, setup, tables) | **Calm flat** — no photography, no strong gradients |

---

## Component vocabulary

Use these shared primitives so every screen reads as one system. **Do not invent parallel card/stat/label patterns.**

| Primitive | File | When to use |
|-----------|------|-------------|
| `SurfaceCard` | `src/components/ui/SurfaceCard.tsx` | Base espresso surface; `hero` or `panel` variant |
| `CardPanel` | `src/components/ui/CardPanel.tsx` | Standard content card (wraps `SurfaceCard`) |
| `HeroPanel` | `src/components/ui/HeroPanel.tsx` | Legacy hero wrapper — prefer `SurfaceCard variant="hero"` on new work |
| `PanelTitle`, `PanelSubtitle` | `src/components/ui/panel.tsx` | Card headlines + supporting line |
| `Eyebrow` | `src/components/ui/panel.tsx` | Mono uppercase section label with optional dot |
| `StatStrip`, `StatTile` | `src/components/ui/panel.tsx` | Hairline-separated metric strip (instrument panel) |
| `Button` / `ButtonLink` | `src/components/ui/Button.tsx`, `ButtonLink.tsx` | Primary (yellow) and outline actions |
| `SectionTitle` | `src/components/ui/SectionTitle.tsx` | Section headers in lists (audit when touching) |

### Page chrome

- **Header:** `.page-header` + `h1.page-title` (see any Tier A page).
- **Body:** `.page-body` with `max-w-*` as appropriate; `gap-4` between major blocks.
- **Mobile nav order (unchanged):** Dashboard · Analysis · **Add run (center)** · Garage · Engineer · Settings.

---

## Journey map & rollout status

Ranked by daily use and trust impact. **Finish each tier before inventing screen-specific styles.**

### Tier A — Core (~80% of daily value)

| ID | Route | Nav | User question | Rework focus | Status |
|:--:|-------|-----|---------------|--------------|--------|
| A1 | `/login` | — | “Is this legit?” | Trust, minimal chrome, clear Google CTA | ✅ Technical v2 (migrate hardcoded hex → tokens) |
| A2 | `/` | Dashboard | “What should I do next?” | One clear next action; calm hero | ✅ Panel primitives + hero; tightened vertical density (June 2026) |
| A3 | `/runs/new` | Add run | “How do I log today?” | Single obvious path; mobile form clarity | ⬜ Tokens only — needs panel pass |
| A4 | `/runs/history` | Analysis → Sessions | “What happened?” | Scannable rows; dense data without chaos | ⬜ Tokens only — table mono pass needed |
| A5 | `/engineer` | Engineer | “What should I change?” | Readable chat; clear context | 🟡 Partial (`EngineerPageClient` uses `Eyebrow`) |

### Tier B — Support (setup context)

| ID | Route | Hub | Rework focus | Status |
|:--:|-------|-----|--------------|--------|
| B1 | `/garage` | Garage | Hub grid — clear labels | ⬜ |
| B2 | `/cars`, `/cars/[id]` | Garage | Entity list + detail pattern | ⬜ |
| B3 | `/tracks`, `/tracks/[id]` | Garage | List + detail | ⬜ |
| B4 | `/events`, `/events/[id]` | Garage | Dates, track, tires hierarchy | ⬜ |
| B5 | `/tires` | Garage | Catalog without visual noise | ⬜ |
| B6 | `/analysis` | Analysis | Hub — same pattern as Garage | ⬜ |

### Tier C — Power user (inherit A/B language)

| Area | Routes | Notes | Status |
|------|--------|-------|--------|
| Setup pipeline | `/setup`, `/setup-documents/*`, `/setup-calibrations/*`, `/setup-sheet-models/*`, bulk import | Complex; inherit cards, tables, headers | ⬜ |
| Analysis tools | `/setup/comparison`, `/videos/*`, lap import | Data-heavy; flat surfaces, strong table hierarchy | ⬜ |
| Run edit | `/runs/[id]/edit` | Same form patterns as Log run | ⬜ |
| Settings / admin | `/settings`, `/teams` | Simple list/settings pattern | ⬜ |
| Utility | `/privacy`, `/login/verify-request`, debug pages | Match shell only | 🟡 verify-request partial |

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
| Tailwind | `tailwind.config.ts` | Semantic colors; Jakarta + JetBrains in `fontFamily` |
| Fonts | `src/app/layout.tsx` | `--font-jakarta`, `--font-mono-jb` |
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
- [ ] Page title uses `.page-title` (sentence case in JSX).
- [ ] Works at 390px width with bottom tab bar.
- [ ] No behavior, routing, or API changes.
- [ ] Yellow is not used for data meaning (only actions / focus).

---

## Known gaps (causes of current drift)

Track these when prioritizing rework:

1. **Login** — correct look but **hardcoded hex**; should use token utilities like the rest of the app.
2. **Logo** — `JrcRaceEngineerLogo.tsx` still red/blue gradient; type-based lockup on login is placeholder until yellow/brown asset ships.
3. **Partial primitive adoption** — `panel.tsx` only on dashboard + partial engineer; 37+ other routes use ad-hoc patterns.
4. **Numeric typography** — many files (e.g. `SetupSheetStructured.tsx`) still use `font-sans tabular-nums`.
5. **Theme preview switcher** — alternate themes still reference old red/blue palette.
6. **Inter / Montserrat** — still loaded; `.ui-control` comments reference Inter at 14px.
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
| 2026-06-19 | Dashboard density pass — hero CTA bottom-align (`sm:items-end`); card padding ~20% tighter (`SurfaceCard` hero `p-4 sm:p-5`, panel `p-3`; `HeroPanel` `px-3 py-2.5`) |
| 2026-06-19 | Initial doc — locked Technical v2 spec, journey map, rollout status from `design/visual-rework` branch |
