# Visual North Star — Technical v2

**Status:** Locked (June 2026). **Branch:** `design/visual-rework`.

This document is the **single source of truth** for UI/visual work in JRC Race Engineer. When a screen feels off-brand or inconsistent, check here before inventing new patterns.

**Hard rule for agents:** Visual changes must not alter behavior, data flow, or API contracts. Restyle only.

---

## North star sentence

> A premium racing instrument: **charcoal graphite** surfaces, **electric-but-confident yellow** for every action, **Sora** for all UI type, **JetBrains Mono** for data. Two voices — friendly prose to learn, mono instrument panel to trust — never cold, never gimmicky.

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

- **Yellow = action only** (CTAs, focus rings, active nav — including the page-title timing-line segment, which is nav-position information, not decoration). Never use yellow to mean “fast lap” or “good data.”
- **Green / red = pace/quality deltas only** (`gain` / `loss` — faster/slower, cleaner/messier). **Volume deltas are neutral:** fewer runs, laps, or wheel time is *less*, not a failure, so those changes render in muted ink with a plain ↑/↓, never green/red (2026-07-10; `DashboardSummaryCard` `DeltaChip`).
- **Dark text on yellow** — always `primary-foreground` (`#121110`), never white on yellow.

---

## Typography

**Two voices.** Every text element maps to exactly one tier below — no Heebo, HK Grotesk Wide, Montserrat, Archivo, Geist, or Plus Jakarta in production UI.

Loaded in `src/app/layout.tsx`:

| Tier | Font | Weights used | CSS hook |
|------|------|--------------|----------|
| **1 — UI sans** | **Sora** (Google Fonts via `next/font`) | 400 body · 500 inactive nav · 600 micro headings · 700 sections/nav active/buttons/**hero `PanelTitle`** · **600 semibold entity names** | `--font-ui`, `font-sans`, `PanelTitle`, `.page-title`, `.hub-row-title` / `HubRowTitle`, `.section-title`, `.session-group-title`, `.run-details-tab`, `.ui-title`, `.ui-label-*`, `.ui-control`, `.primary-action-chip`, nav labels, chat body + speaker tags |
| **2 — Data** | **JetBrains Mono** | 400–500 labels/values · 500 stat values | `font-mono`, `.type-data-label`, `.type-timestamp`, `.table-col-header`, `<Eyebrow>`, `<StatTile>` |

Sora and JetBrains Mono are SIL OFL.

### Element → tier matrix (locked)

| Element | Tier | Size | Weight | Case / tracking |
|---------|------|------|--------|-----------------|
| Page title (`.page-title`) | **Space Grotesk** (`--font-display`) | 22–30px (`clamp`) | **700 bold** | Sentence · `-0.01em` · nav-positional timing line beneath (hairline track spanning the title + yellow sector segment skewed −21°, positioned by the page's dock slot; brackets retired 2026-07-13) |
| Hub row title (`HubRowTitle`, `.hub-row-title`) | Sora | 17–18px | **600 semibold** | Sentence · `tracking-tight` |
| Hero card title (`PanelTitle`) | Sora | 20–22px | **700** | Sentence · `tracking-tight` |
| Section header (`.section-title`, `SectionTitle`, `.run-details-tab`) | Sora | 13–14px | 700 | Sentence · `tracking-tight` |
| Primary nav label (sidebar only — mobile dock is icon-only since 2026-07-03) | Sora | 10px | 500 inactive / 700 active | Sentence · `tracking-tight` |
| Section label / eyebrow (`<Eyebrow>`, `.type-data-label`, StatTile label) | JetBrains Mono | 10px | 400 | **Uppercase** · **`0.28em`** |
| Table column header (`.table-col-header`) | JetBrains Mono | 10px | 400 | **Uppercase** · **`0.28em`** · faint |
| Stat value (`StatTile` value) | JetBrains Mono | 18px | 500 | Tabular nums |
| Timestamps (`.type-timestamp`, `<RelativeTime>`) | JetBrains Mono | 10px | 400 | Sentence · tabular nums · faint |
| Lap times, deltas, run IDs, setup values | JetBrains Mono | varies | 400–500 | Tabular nums |
| Body / form copy | Sora | 13–15px | 400 | Sentence |
| Page subtitle (`.page-subtitle`, `PanelSubtitle`) | Sora | 13px | 400 | Sentence |
| Entity names in lists (`.ui-title` semibold) | Sora | 13–14px | 600 | Sentence |
| Chat speaker tags (`You` / `Engineer`) | Sora | 10px | 600 | Sentence — **not** Eyebrow |
| Chat body / prose summaries | Sora | 13–15px | 400 | Sentence — inline numbers stay Sora |
| Primary CTA label (`.primary-action-chip`) | Sora | 11–13px | 700 | Hero: optional uppercase `0.12em` |
| Caption / hint (`.ui-caption`) | Sora | 11px | 400 | Sentence |

### Rules

1. **Never mix tiers on the same semantic role** — e.g. section labels are always `<Eyebrow>` (mono), never `.ui-title`.
2. **One display face, one place** — Space Grotesk (`--font-display`) is used for `.page-title` only (uppercase, timing line). Everything else is Sora or JetBrains Mono; do not spread the display face to cards, nav, or body.
3. **Mono tracking is always `0.28em`** for uppercase micro labels (`.type-data-label`, `.table-col-header`). Do not use `0.2em` / `0.14em` one-offs.
4. **Prefer `font-mono` over `font-sans tabular-nums`** for numeric data (setup sheet values, tables, metrics).
5. **Do not set inline `fontFamily`** in components — globals + shared classes win.
6. **Chat inline numbers stay Sora** — only dedicated metric/setup/table/timestamp surfaces use mono.

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
| App shell (all screens) | **TITC sunset photo wash** — `public/brand/track-hero.jpg` on `.page-bg` children (`-img/-tint/-warm/-dark/-vig` in `layout.tsx`). Knobs live as `--tune-*` vars in `:root` (final in-app tune 2026-07-03: **blur 16px · yellow 0.15 · dark 0.76**); fixed position, same clarity everywhere. Charcoal gradients on `.page-bg` remain as the loading fallback. Dev-only `AppearanceTuner` (AppShell) overrides the vars live. |
| Cards / panels | **Liquid glass** — `SurfaceCard` uses `.glass-card`: `card/`**0.7** + `backdrop-blur(`**78px**`) saturate(1.3)`, white/0.10 border, specular top rim. Legibility over the photo is the tuning limit — do not drop card alpha below ~0.6. |
| Mobile dock | Liquid glass bar — Ideas cap + 5 destinations behind a hairline, with the yellow Log-run circle beside it at matched 56px height (`BottomNav.tsx`, 2026-07-14 one-row chrome). Same glass recipe as before (`card/0.32` + `backdrop-blur(40px) saturate(1.9)`, bright inset rim). |
| Retired (2026-07-03) | ~~Flat-charcoal-only shell; "no photography on data screens"~~ — superseded by the uniform photo wash + glass surfaces. |

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
- **Hierarchy:** page title (Sora **uppercase**, bold) → page subtitle (Sora muted) → section `<Eyebrow>` (mono, faint, uppercase) — hero `PanelTitle` (Sora 700 sentence case) stays the in-card headline voice.
- **Body:** `.page-body` with `max-w-*` as appropriate; `gap-3` between major blocks (locked in CSS).
- **Mobile dock (2026-07-14, supersedes 2026-07-06 two-row chrome):** one row — a 56px glass bar holding the **Ideas** utility cap (lightbulb, hairline divider, opens the Ideas & reminders sheet app-wide, no count badge) plus the five destinations (Dashboard · Analysis · Assets · Engineer · Teams, 26px icons), with the icon-only yellow **Log run** circle (56px, specular shine rim; draft state = flag icon + green dot) floating beside the bar's right end. Static on scroll — nothing collapses. On create/edit routes the circle is suppressed and the bar stretches (`shouldShowLogRunFab`). **Settings** lives behind the top-right account avatar (`AccountMenu`). Desktop sidebar keeps Add run + Settings and gains Teams.

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
| B6 | `/analysis` | Analysis | Debrief surface — session trend chart, recent-runs accordion, video + setup-compare doors | ✅ Rebuilt as debrief (July 2026; panel primitives throughout) |

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
| Tailwind | `tailwind.config.ts` | Semantic colors; Sora + JetBrains in `fontFamily` |
| Fonts | `src/app/layout.tsx` | `--font-ui` (Sora), `--font-mono-jb` |
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
- [ ] Page title uses `.page-title` (Sora bold, **UPPERCASE** +0.02em).
- [ ] Works at 390px width with bottom tab bar.
- [ ] No behavior, routing, or API changes.
- [ ] Yellow is not used for data meaning (only actions / focus).

---

## Known gaps (causes of current drift)

Track these when prioritizing rework:

1. **Login** — ✅ Inter + semantic tokens (June 2026 typography pass).
2. **Logo** — ✅ Resolved 2026-07-11. On-brand yellow/white JRC marks (`public/brand/jrc-mark-{yellow,white}.svg`) replace the red→blue asset; new `JrcMark` component (variant-aware) replaces the retired `JrcRaceEngineerLogo` (deleted). Yellow = brand/hero (app icon, login, launch splash); white = working chrome (desktop sidebar, mobile top-left). App icons/favicon/apple-touch generated to `public/icons/` + `app/icon.png`/`app/apple-icon.png`. See `docs/PWA_NORTH_STAR.md`.
3. **Partial primitive adoption** — `panel.tsx` only on dashboard + partial engineer; 37+ other routes use ad-hoc patterns.
4. **Numeric typography** — setup sheet values migrated to `font-mono`; Tier C routes may still have stragglers.
5. **Theme preview switcher** — alternate themes still reference old red/blue palette; section label uses `<Eyebrow>`.
6. **Legacy font cleanup** — Heebo + HK Grotesk Wide retired (June 2026); Sora + JetBrains two-voice system locked (Sora replaced Inter 2026-07-03). Tier C section labels migrated to `<Eyebrow>` (June 2026 pass); remaining `ui-title` is entity names, field labels, badges, and chat speaker tags only.
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
| 2026-07-14 | **Bottom chrome → one row ("F1 — divided cap", founder-interviewed via 3-round artifact)** — the two floating pills (Ideas bottom-left, Log run bottom-right) left their own row and the dock grew: a 56px glass bar (was 49px, icons 24→26) now holds an **Ideas cap** (lightbulb behind a hairline — utility, never an active tab, opens the sheet; now **app-wide** via `IdeasDockCap` fetching `/api/action-items` on first open) plus the five destinations, with the **icon-only yellow Log-run circle** (56px, kept specular shine rim, now a subtle top-light gradient) beside the bar. Draft state = **flag icon + green dot** (label retired; scroll-collapse retired — chrome is static). `IdeasSheetFab` deleted; sheet portals to `<body>` (the bar's `backdrop-blur` is a containing block that traps `fixed`). `--mobile-tab-bar-height` 4.75→5.25rem; NewRunForm save-bar offset +4.25→+4.75rem. Ideas count indicator: none (founder pick). |
| 2026-07-13 | **Dashboard header → left-aligned greeting, no date** (supersedes the 2026-07-11 centering) — the summary card read too far from the top. The `Dashboard` label + mono date chip are gone; the personal `Good evening, {name}` greeting is now the whole header, left-aligned in the display face (`.page-greeting` styled like `.page-title` but bracket-free) with a `sr-only` `Dashboard` h1 for a11y. Top/bottom padding tightened so the `Last 30 days` card rides up. The mobile-JRC-pill collision that forced centering no longer applies: the pill links to the page you're already on, so `MobileBrandMark` hides it on `/` (`usePathname`), letting the greeting own the top-left. Other routes' top chrome unchanged. |
| 2026-07-13 | **Page title → nav-positional timing line** — corner brackets retired (founder-interviewed via artifact, "segment = nav position" variant approved). `.page-title` now carries a 2px hairline track spanning exactly the title's width, with a 4px yellow sector segment (20% wide, `skewX(-21deg)` — the JRC glyph's cut) positioned at the page's slot in the 5-destination dock (`Dashboard · Analysis · Assets · Engineer · Teams`). `AppShell` resolves the slot via `resolveActiveNavId` + `MOBILE_NAV` and sets `data-nav-sector` + `--title-nav-sector` on `.app-shell`; off-dock routes (Add run, Settings, login) show the bare track, no segment. Yellow here is sanctioned: it encodes location (kin to active-nav), not decoration. Title element is now `width: fit-content; margin-inline: auto` (was flex + bracket gap). |
| 2026-07-11 | **Dashboard header centered** — the dashboard's left-aligned title (locked 2026-07-03) was the only page-header that collided with the fixed mobile JRC pill (top-left) and read misaligned against the account avatar. Reverted to the shared centered `.page-header` band: `Dashboard` title centered between the JRC pill and avatar, with the time-of-day greeting + mono date chip stacked centered beneath it (`.page-header-dashboard` overrides removed; greeting/chip now inherit the base centered `.page-title` column). Unifies the dashboard with every other page. |
| 2026-07-10 | **Stat-tile baseline lock + tabular-nums sweep** — `StatTile` label now reserves a fixed 2-line box (`line-clamp-2 min-h-[2.6em] leading-[1.3]`) so a wrapping label ("Time driving") no longer shoves its value off the baseline shared by its neighbours in a `grid-cols-3` strip — fixes the dashboard 30-day trio app-wide via the primitive. Audit found the app already sans-tabular-clean (no `font-sans tabular-nums`, no inline `fontFamily`); added `tabular-nums` to the remaining user-facing numeric leaks (`LapComparisonColumnGrid` value line, `RunComparePanel` current/previous cells, `SetupSheetView` value). Tier-C admin/debug/PDF-calibration mono left as-is (identifiers/code, not tabular data). |
| 2026-07-06 | **Dock → 5 destinations + floating action + account avatar** — Founder-interviewed nav restructure. **Add run** left the dock for a floating yellow `Log run` pill (bottom-right, 48px, draft-aware green dot, `LogRunFab`; suppressed on run + setup create/edit routes via `shouldShowLogRunFab`). **Settings** left the dock for a top-right account avatar menu (`AccountMenu` — Settings · Privacy · Sign out, `useSession` face). **Teams** took the freed slot. Mobile dock is now `Dashboard · Analysis · Assets · Engineer · Teams` (grid-cols-6 → 5). Desktop sidebar unchanged apart from gaining Teams. |
| 2026-07-03 | **Mobile bottom nav → floating dock** — icon-only rounded pill floating above the screen edge (blurred `bg-card/90` + top sheen + charcoal shadow), Phosphor icons regular→**fill** when active (Gauge / ChartBar / PlusCircle / Car / GearSix; `EngineerNavIcon` gained a `filled` variant), sliding yellow top-edge indicator (2px, soft glow, 200ms). Labels retired on the mobile dock (sidebar labels unchanged); `--mobile-tab-bar-height` 3.25 → 4.75rem (dock + float gap clearance). Desktop sidebar untouched (still Lucide + labels). |
| 2026-07-03 | **Photo wash + liquid glass** — TITC sunset (`track-hero.jpg`, 52KB) as the global fixed background (blur 8 · yellow .3 · dark .4, user-tuned via artifact sliders); `SurfaceCard` → `.glass-card` (0.7 alpha, 35px backdrop blur); dock pill → liquid glass (0.42, 30px). Replaces flat-charcoal shell; "calm flat / no photography" rule retired. `suppressHydrationWarning` added to SurfaceCard for the external `--focus` writes. |
| 2026-07-03 | **Page-title treatment** — Space Grotesk 700 sentence case, 22–30px (`--font-display`, next/font), framed by drafting-style corner brackets (CSS pseudo-elements, muted ink, full title height — per approved artifact). Fraunces/Instrument Serif cursive trials rejected. Eyebrows split from stat labels: `<Eyebrow>` yellow (`.eyebrow-label`), `.type-data-label` stays faint. All Eyebrow leading dots removed. Page glow un-occluded (`bg-background` dropped from `main` + route-transition wrapper). |
| 2026-07-03 | **Type system → Sora** — replaced Inter as the UI/display voice (`next/font`, `--font-ui`); JetBrains Mono unchanged. Montserrat evaluated and rejected (too ubiquitous — reads like TestLogger). Page titles now **UPPERCASE** (+0.02em; sentence-case retired for `.page-title`); `PanelTitle` unified 800 → **700** so dashboard cards stop being a weight outlier. Login "JRC" wordmark stays 800 (brand lockup, not chrome). |
| 2026-07-03 | Corrected Known Gaps #2 (logo) — off-brand colors live in the SVG asset `public/brand/jrc-race-engineer-logo.svg`, not inline in `JrcRaceEngineerLogo.tsx` |
| 2026-06-20 | Palette shift — warm espresso → charcoal graphite (`#121110` base); neutralized page wash + card glow; ink tones slightly cooler; login hex aligned |
| 2026-06-20 | Page chrome pass — `.page-title` Inter semibold sentence case; restored header padding + title/subtitle gap; `.page-subtitle` aligned to `PanelSubtitle`; `Eyebrow` uses `text-faint` |
| 2026-06-24 | Tier C typography pass — migrate setup/bulk-import/calibration/tracks/events/teams/video section labels from `.ui-title` to `<Eyebrow>`; table debug headers use `.table-col-header` |
| 2026-06-24 | Inter two-voice typography — retired Heebo + HK Grotesk Wide; Inter (`--font-ui`) for all UI; JetBrains for data; `.type-timestamp`, `.table-col-header`; page titles Inter semibold; hub rows Inter semibold; login token alignment |
| 2026-06-24 | Typography unify pass — `.type-data-label` + `.section-title`; mono tracking `0.28em` everywhere |
| 2026-06-19 | Dashboard density pass — hero CTA bottom-align (`sm:items-end`); card padding ~20% tighter (`SurfaceCard` hero `p-4 sm:p-5`, panel `p-3`; `HeroPanel` `px-3 py-2.5`) |
| 2026-06-19 | Initial doc — locked Technical v2 spec, journey map, rollout status from `design/visual-rework` branch |
