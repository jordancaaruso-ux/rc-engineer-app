# Visual North Star — Technical v2

**Status:** Live. Typography and surfaces reconciled against `globals.css` on **2026-08-14**.

This document holds the **intent** — why a surface looks the way it does, and what was tried and
rejected. **`src/app/globals.css` holds the truth.** Where a number here disagrees with the CSS, the
CSS wins and this line is a bug; fix it rather than "fixing" the code to match. **Ten rows have
drifted that way so far** (the eyebrow recipe, the data-label voice, the glass values, a photo wash
that no longer ships, and — found in the 2026-08-14 font audit — the page-title face named wrong in
two places, the numeric rule stated backwards in the checklist, the display face's scope, a stale
mono row in the element matrix, and Space Grotesk missing from the loaded-fonts table entirely).
Check before you trust a figure. **The checklist near the bottom drifts hardest**, because nobody
re-reads it when they change a rule — line for line it is the least reliable part of this file.

**Light mode shipped 2026-08-12** — opt-in per device, dark unchanged. Every colour is a token, and
the split that matters is `primary` (the yellow itself) vs `primary-ink` (the ink you can actually
read on the page's background). Never reach for a raw hex; a hardcoded `#FFD60A` is invisible on
warm ash paper. `e2e/light-mode-audit.spec.ts` is the colour regression net; `e2e/typography-audit.spec.ts` is the type one (one face · every figure tabular · ramp closed · `tnum` really present in the served subset). Both walk the shared page list in `e2e/surfaces.ts`.

**Hard rule for agents:** Visual changes must not alter behavior, data flow, or API contracts. Restyle only.

---

## North star sentence

> A premium racing instrument: **charcoal graphite** surfaces, **electric-but-confident yellow** for every action, **Sora** for everything the driver reads, **Space Grotesk** for page titles alone. **One voice** — the instrument register comes from tabular figures on a six-step ramp, not from a second typeface. Friendly prose to learn, an instrument panel to trust — never cold, never gimmicky.

### Personality (locked)

| Dimension | Direction |
|-----------|-----------|
| Tone | Friendly expert + premium. A hint of competition energy — **not** dated motorsport (no checkered flags, racing stripes, faux-carbon). |
| Color | Yellow hero on charcoal graphite base. Inspired by electric sport on dark (DCL) — **not** flat #000 or club-race nostalgia. A trace of warmth remains in ink tones so the shell never reads cold. |
| Density | Balanced — scannable tables/lists without timing-software cramming. |
| References | [Drone Champions League](https://www.awwwards.com/sites/drone-champions-league) (yellow signal on dark), FIFA World Cup 2026 dark palette (warm browns), Charles Leclerc site (technical type pairing — note the pairing itself was retired 2026-08-14; the reference is for tone, not for a second face). |

### Design principles (from project brief)

1. **Zero behavior change** — visual rework only; same flows, same data.
2. **Trust first** — especially login and dashboard; drivers must feel this is a serious tool.
3. **Intuition** — one obvious next action; labels and hierarchy do the work.
4. **Polish** — consistent tokens, primitives, and spacing; no one-off hex unless migrating.
5. **Mobile-first, desktop second — and 390px is the FIXED one.** Every Tier A screen works at
   **390px** with the bottom tab bar visible. Since 2026-08-07 desktop is a first-class target too
   (usage was ~99% mobile and the desktop workflow had never been designed), but the relationship
   is not symmetric: **mobile is the reference, and desktop work must not move it.** In practice
   that means desktop layout lives behind `md:` / `lg:` / `xl:` and never edits a base class.
   Prove it, don't assert it — `npm run layout:probe --width=390` before and after, and compare.
   Do NOT try to prove it with screenshots: captured twice from identical code these pages differ
   by up to 98%, so a pixel diff both screams about nothing and would bury a real one-pixel shift.
   `npm run shots:desktop` is for LOOKING at desktop, not for regression-testing mobile.

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
| **`page`** | **`#1B1A17`** | `--page-bg-base` (`.page-bg`) | **The app background** — ash warm, flat. One look for everyone; there is no picker (founder 2026-08-05) |
| `bg` | `#121110` | `background`, `--color-background` | Deepest surface — input fills, code blocks, inset chips (`bg-background`). Sits *below* the page tone |
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

- The background picker (Settings → Background; graphite wash, track photo, flat-colour modes, `data-bg-preview`). Deleted 2026-08-05 — the app has one background, ash warm, and it is not a preference.
- Red primary `#c92a2a` and blue accent `#2563eb` as brand colors.
- Red/blue body mesh (`--body-glow-*`, `--body-stripe-*`) — set to `0` on default theme.
- Dusty rose `#D9A299` accent.
- Cool grey “runna” surfaces on user-facing screens (tokens neutralized to charcoal in `:root`).
- Italic uppercase Montserrat page chrome.

### Color semantics

- **Yellow = action, plus one measured axis** (CTAs, focus rings, active nav — including the page-title timing-line segment, which is nav-position information, not decoration). Never use yellow to mean “fast lap” or “good data.”
  - **The one exception (founder 2026-08-03): corner balance.** The balance instrument in `HandlingAssessmentFields.tsx` fills its severity tiles in accent. Balance is captured on *every* run, so most answers describe what the car did rather than report a fault, and the previous destructive-coral treatment read as “something is wrong” on ordinary data. The exception is narrow and stays narrow: it is a **magnitude on a measured axis**, not a verdict, and read-back drops to a monochrome ink ramp so a stored record is never mistaken for a live control. Anything else wanting yellow for data still needs a founder call.
- **Green / red = pace/quality deltas only** (`gain` / `loss` — faster/slower, cleaner/messier). **Volume deltas are neutral:** fewer runs, laps, or wheel time is *less*, not a failure, so those changes render in muted ink with a plain ↑/↓, never green/red (2026-07-10; `DashboardSummaryCard` `DeltaChip`).
- **Dark text on yellow** — always `primary-foreground` (`#121110`), never white on yellow.

---

## Typography

**Three faces load.** Every text element maps to exactly one tier below — no Heebo, HK Grotesk Wide, Montserrat, Archivo, Geist, or Plus Jakarta in production UI.

Loaded in `src/app/layout.tsx` (lines 47–80):

| Tier | Font | Weights used | CSS hook |
|------|------|--------------|----------|
| **1 — UI sans** | **Sora** (Google Fonts via `next/font`) | 400 body · 500 inactive nav · 600 micro headings · 700 sections/nav active/buttons/**hero `PanelTitle`** · **600 semibold entity names** | `--font-ui`, `font-sans`, `PanelTitle`, `.hub-row-title` / `HubRowTitle`, `.section-title`, `.session-group-title`, `.run-details-tab`, `.ui-title`, `.ui-label-*`, `.ui-control`, `.primary-action-chip`, nav labels, chat body + speaker tags |
| **2 — Display** | **Space Grotesk** | **700 only** | `--font-display` — **exactly three selectors**: `.page-title`, `.page-title-condensed`, `.demo-door-title`. No Tailwind utility maps to it; a `className="font-display"` is a silent no-op. |
| **3 — Data** | **JetBrains Mono** | 500 stat values · 400–500 lap figures | `font-mono`, `.lap-figure`, `<StatTile>` value |

**The one-voice pass (2026-07-16) intended to shrink tier 3 to almost nothing, and only half
landed.** `.type-data-label`, `.type-timestamp`, `.table-col-header` and `<Eyebrow>` were all mono
and are now **Sora** — mono labels blended into their own (also-mono) values and stopped reading as
labels. `globals.css` still carries that pass's comment claiming mono survives *only* in
`.lap-figure` and the `StatTile` value.

**That claim is false, and has been since the day it was written.** The 2026-08-14 audit counted
**~460 `font-mono` call sites across 126 files** — the pass reached the stylesheet and two
components, and the component layer never followed. Mono is currently doing three unrelated jobs:
aligning figures, marking machine strings (field keys, run IDs, URLs, PDF widget names, JSON dumps),
and supplying an uppercase tracked *label* voice on ~60 desktop cards — the last of which rule 3
below explicitly retired. **Do not read the `.lap-figure` comment as a description of the app.**

Sora, Space Grotesk and JetBrains Mono are SIL OFL.

### Element → tier matrix (locked)

| Element | Tier | Size | Weight | Case / tracking |
|---------|------|------|--------|-----------------|
| Page title (`.page-title`) | **Space Grotesk** (`--font-display`) | 22–30px (`clamp`) | **700 bold** | Sentence · `-0.01em` · nav-positional timing line beneath (hairline track spanning the title + yellow sector segment skewed −21°, positioned by the page's dock slot; brackets retired 2026-07-13) |
| Hub row title (`HubRowTitle`, `.hub-row-title`) | Sora | 17–18px | **600 semibold** | Sentence · `tracking-tight` |
| Hero card title (`PanelTitle`) | Sora | 20–22px | **700** | Sentence · `tracking-tight` |
| Section header (`.section-title`, `SectionTitle`, `.run-details-tab`) | Sora | 13–14px | 700 | Sentence · `tracking-tight` |
| Primary nav label (sidebar only — mobile dock is icon-only since 2026-07-03) | Sora | 10px | 500 inactive / 700 active | Sentence · `tracking-tight` |
| Section signpost (`<Eyebrow>`, `.eyebrow-label`) | **Sora** | **17px** | **700 bold** | Uppercase · `tracking-normal` · **3px `bg-primary-ink` tick** before it, hairline rule under (`.eyebrow-root`). Redesigned 2026-07-16 from 10px mono `0.28em` yellow, because sections were being glanced over. Leading dots removed — `Eyebrow`'s `dot` prop is a no-op kept for call sites |
| Stat / field micro-label (`.type-data-label`, StatTile label) | **Sora** | **12px** | **600** | Sentence · `tracking-normal` · muted grey. Grey so the label recedes under its value; was mono, then white, and both blended |
| Table column header (`.table-col-header`) | **Sora** | **12px** | **600** | Sentence · `tracking-normal` · muted grey |
| Stat value (`StatTile` value) | JetBrains Mono | 18px | 500 | Tabular nums — one of the last two mono survivors |
| Timestamps (`.type-timestamp`, `<RelativeTime>`) | **Sora** | **11px** | 400 | Sentence · tabular nums · muted grey |
| Lap times (`.lap-figure`, `RUN_HISTORY_DATA_CLASS`) | JetBrains Mono | 11–13px | 400–500 | Tabular nums |
| Machine strings (run IDs, field keys, URLs, PDF widget names, JSON/debug) | JetBrains Mono | 9–12px | 400 | — |
| Deltas, setup values, counts, temps, dates | Sora `.fig-*` | per ramp | 400–600 | Tabular nums, baked into the class. Until 2026-08-14 these rendered *both* ways depending on the surface — a camber value was Sora in the run diff and mono in the setup sheet, a date mono when a row was collapsed and Sora when expanded. One face now. |
| Machine identifiers (field keys, run IDs, URLs, PDF widget names) | Sora `.type-ident` | 11px | 400 | Hairline chip, `break-all`, `user-select: all` |
| Machine text (JSON, debug, Engineer code chips) | platform mono `.type-machine` | caller's | 400 | The only monospace left, and it loads nothing |
| Machine-chrome micro-label | Sora `.micro-caps` | 10px | 600 | Uppercase · `0.14em`. Replaced the 8/8.5/9/10px × 0.12–0.22em mono sprawl |
| Body / form copy | Sora | 13–15px | 400 | Sentence |
| Page subtitle (`.page-subtitle`, `PanelSubtitle`) | Sora | 13px | 400 | Sentence |
| Entity names in lists (`.ui-title` semibold) | Sora | 13–14px | 600 | Sentence |
| Chat speaker tags (`You` / `Engineer`) | Sora | 10px | 600 | Sentence — **not** Eyebrow |
| Chat body / prose summaries | Sora | 13–15px | 400 | Sentence — inline numbers stay Sora |
| Primary CTA label (`.primary-action-chip`) | Sora | 11–13px | 700 | Hero: optional uppercase `0.12em` |
| Caption / hint (`.ui-caption`) | Sora | 11px | 400 | Sentence |

### Rules

1. **Never mix tiers on the same semantic role** — e.g. section signposts are always `<Eyebrow>`, never `.ui-title`.
2. **One display face, three places** — Space Grotesk (`--font-display`) is used at `.page-title`, `.page-title-condensed` and `.demo-door-title`, in **sentence case** (not uppercase). Nowhere else; do not spread the display face to cards, nav, or body.
3. **Micro labels are Sora, sentence case, `tracking-normal`, muted grey** (`.type-data-label`, `.table-col-header`). The old `0.28em` mono uppercase recipe is retired. Where a label genuinely needs the tracked machine-chrome voice, use `.micro-caps` — one step, not a per-site `0.2em` / `0.14em` one-off.
4. **Never write a bare numeric font-size — pick a `.fig-*` step.** Size and `tabular-nums` are one decision, and separating them is exactly how three Sora numbers ended up sitting among six mono ones in a single nine-cell grid (`RunDetailPanel`, fixed 2026-08-14). `font-mono` no longer resolves to a webfont; if you type it you get Consolas, which is the point.
5. **Do not set inline `fontFamily`** in components — globals + shared classes win.
6. **Chat inline numbers stay Sora** — only dedicated metric/setup/table/timestamp surfaces use mono.
7. **Any number set in Sora needs `tabular-nums`, always.** Measured 2026-08-14 from the font binary: Sora's digits are **proportional** by default (advances 743, 420, 618, 614, 642, 623, 659, 574, 637, 659 per 1000em — a `1` is 420, a `0` is 743). Its `tnum` feature is present and correct in all four weights, snapping every digit to a uniform 676. Without the feature a column of Sora figures visibly shifts row to row. Sora's `.` and `:` are **not** covered (262 units), so decimals only line up in right-aligned columns of equal precision.

### Retired (removed June 2026)

`Heebo`, `HK Grotesk Wide`, `Montserrat`, `Geist Sans`, and **Archivo Expanded** are **no longer loaded**. Do not reintroduce a second UI sans or display-only page-title font.

---

### ✅ SHIPPED 2026-08-14 — the one-voice pass

Built and verified the same day. `e2e/typography-audit.spec.ts` passes across 27 pages × 2 viewports
(4,239 text elements, 54 tnum probes): one face, every figure tabular, ramp closed. `layout:probe`
reports the 390px geometry unchanged across all 8 routes. Full audit: the *Two faces, one grid*
artifact (2026-08-14).

**What shipped.** JetBrains Mono is deleted from the app entirely. **One UI face — Sora — plus Space
Grotesk for page titles.** Every number becomes Sora with `tabular-nums`; there is no lap-time
exception, because "lap times are a different voice from other numbers" is the premise that produced
the split grid. Numeric sizes collapse from 23 to six. Scope is app UI only — the landing page, the
satori share-card renderer, email templates and PDF field stacks are untouched.

**The numeric ramp — six steps, each welding size to `tabular-nums`** so that omitting the feature
(rule 7) becomes structurally impossible rather than a thing to remember:

| Class | Size | Role |
|---|---|---|
| `.fig-tick` | 10px | SVG axis tick, sub-figure. **The floor** — a label that doesn't fit is dropped or shortened, never shrunk. |
| `.fig-cell` | 11px | Dense table cell — replaces `RUN_HISTORY_DATA_CLASS`, absorbs `.type-timestamp` |
| `.fig-stat` | 13px | Stat value in a strip cell (`StatWellCell`) |
| `.fig-tile` | 18px | `StatTile` value |
| `.fig-hero` | 26px | Card hero figure |
| `.fig-display` | `clamp(3.5rem, 4.6vw, 5.5rem)` | Page hero figure, desktop dashboard |

Absorbed: 9.5→10 · 10.5→10 · 11.5→11 · 12.5→13 · 14→13 · 17→18 · 19→18. **No seventh step and no SVG
sub-ramp** — the 8px/9px chart ticks exist because 9px overflowed, which was the wrong fix; drop
labels via `labelStep` instead. **SVG type sits on the ramp in *rendered* pixels**: for a scaled
`viewBox`, `fontSize = rampStep × (viewBox.width / renderedWidth)`.

`.lap-figure` is **deleted, not renamed**. `StatWellCell`'s `mono` prop is **deleted** — that removes
the switch that was set wrong on three of nine cells, which is the actual bug fix.

**Where mono's other two jobs go.** Mono is currently carrying three unrelated signals; only one is
about figures:
- *Machine identifiers* (field keys, run IDs, URLs, PDF widget names) → a hairline chip with
  `user-select: all`. Sora cannot disambiguate `0`/`O`, so replace the **affordance** (one tap selects
  the whole ident to copy), not the glyph.
- *Uppercase tracked chrome labels* (~60 sites) → one 10px Sora step. The **tracking** is what made
  these read as chrome; mono was texture. Expect them to get 35–45% wider — shorten the copy rather
  than adding a smaller step.
- *Genuine code* (JSON dumps, debug output, Engineer inline code) → the **platform** mono stack, no
  webfont, deliberately not a brand voice. This is the one deliberate exception to "one UI face": a
  JSON blob on `/admin/perf` is not a product surface. A lap time is `.fig-*`, never this.

**Two traps, both verified, both easy to walk into:**
1. **Deleting the `mono` key from `tailwind.config.ts` does not remove `font-mono`.** Tailwind 4.3.2
   defines `--font-mono` in its own `@theme default`, so removing the override reverts every missed
   site to `ui-monospace … Consolas` — and silently retypes bare `<pre>/<code>/<kbd>/<samp>` via
   preflight. The migration **repoints** the key at Sora plus an unlayered `.font-mono` shim first,
   and deletes both only at the very end, where a survivor turning Consolas is how you find it.
2. **Width changes are not where you'd guess.** Sora's tabular advance is 676 vs JetBrains Mono's
   600 (+12.7%), but Sora's narrow `.`/`:` (262 vs 600) claw it back on time-shaped strings:
   `1:23.456` is **−5%**, `23.456` is +1%, but `1247` and `100%` are **+13%**. The overflow risk is in
   counts, temperatures and percentages — re-measure the fixed-width session columns (`w-12`,
   `w-[3.25rem]`), not the lap-time ones.

**Blocked on one measurement.** All the Sora figures above were parsed from the TTFs vendored in
`src/lib/share/fonts/` for the share card. The app serves **Google's subsetted woff2** via
`next/font`, and `pyftsubset`'s default `--layout-features` set does **not** include `tnum`. If the
subset dropped it, the whole ramp is decorative. Probe it in the browser before phase 1; the fallback
is `next/font/local` with self-hosted OFL statics, which touches only `layout.tsx`.

**When this lands**, `e2e/typography-audit.spec.ts` becomes the regression net alongside
`e2e/light-mode-audit.spec.ts` — asserting one face, every number tabular, the ramp closed, and the
font feature genuinely applied. Encoding the ramp as a test rather than a doc line is the point:
every drifted row listed at the top of this file drifted because nothing failed when it did.

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
| App shell (all screens) | **One flat fill. No photo.** `.page-bg` is a single fixed layer painted `--page-bg-base` (`#1B1A17` dark · `#EAE7E0` warm ash paper in light) so every `.glass-card` composites over a uniform backdrop. Full viewport height on iOS (`lvh` + `-webkit-fill-available`) so it reaches under the Dynamic Island and home indicator. The photo survives on **`/welcome` only** (`track-hero-baked.jpg`). |
| Cards / panels | **Liquid glass** — `SurfaceCard` uses `.glass-card`: `card/`**`--tune-glass-alpha`** + `backdrop-blur(`**`--tune-glass-blur`**`) saturate(1.3)`, specular top rim. Current values: **alpha 0.6 · blur 30px** in dark, **alpha 0.78** in light. Read the vars, never hardcode — and never hand-write `-webkit-backdrop-filter`. |
| Mobile dock | Liquid glass bar — Ideas cap + 5 destinations behind a hairline, with the yellow Log-run circle beside it at matched 56px height (`BottomNav.tsx`, 2026-07-14 one-row chrome). Same glass recipe as before (`card/0.32` + `backdrop-blur(40px) saturate(1.9)`, bright inset rim). |
| Retired (2026-07-03, then reinstated) | The flat shell came back. The photo wash that replaced it was itself removed — glass reads cleanly over one flat fill and not over a photograph. "No photography on data screens" is the rule again. |

---

## Component vocabulary

Use these shared primitives so every screen reads as one system. **Do not invent parallel card/stat/label patterns.**

| Primitive | File | When to use |
|-----------|------|-------------|
| `SurfaceCard` | `src/components/ui/SurfaceCard.tsx` | Base charcoal surface; `hero` or `panel` variant |
| `CardPanel` | `src/components/ui/CardPanel.tsx` | Standard content card (wraps `SurfaceCard`) |
| `HeroPanel` | `src/components/ui/HeroPanel.tsx` | Legacy hero wrapper — prefer `SurfaceCard variant="hero"` on new work |
| `PanelTitle`, `PanelSubtitle`, `HubRowTitle` | `src/components/ui/panel.tsx` | Card headlines + supporting line; hub row labels |
| `Eyebrow` | `src/components/ui/panel.tsx` | Sora 17px bold uppercase section label, ink, with a 3px yellow tick and a hairline rule under (the `dot` prop is a retained no-op) |
| `StatStrip`, `StatTile` | `src/components/ui/panel.tsx` | Hairline-separated metric strip (instrument panel) |
| `Button` / `ButtonLink` | `src/components/ui/Button.tsx`, `ButtonLink.tsx` | Primary (yellow) and outline actions |
| `SectionTitle` | `src/components/ui/SectionTitle.tsx` | Section headers in lists (audit when touching) |

### Page chrome

- **Header:** `.page-header` + `h1.page-title` + `p.page-subtitle` — title block uses `gap-1` via `:has(.page-title)`; subtitle matches `PanelSubtitle` (`13px`, `leading-relaxed`, `text-muted-foreground`).
- **Hierarchy:** page title (**Space Grotesk 700, sentence case**, timing line beneath) → page subtitle (Sora muted) → section `<Eyebrow>` (**Sora 17px bold uppercase ink, 3px yellow tick**) — hero `PanelTitle` (Sora 700 sentence case) stays the in-card headline voice.
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
| Instruments | `src/components/ui/RatingDial.tsx` | Bounded magnitude as an arc (2026-08-08). Verdict mode reads `CAR_RATING_BANDS`; axis mode is the accent-yellow exception below. Replaces the "Rating 7/10" tile app-wide |
| Desktop nav | `src/components/layout/sidebar.tsx`, `.sidebar` | 76px icon rail since 2026-08-08 (was a 256px sidebar). Icon 20px over a 9px label; yellow mark, because white illegibly small at 18px |
| Surfaces | `src/components/ui/SurfaceCard.tsx` | Prefer tokens over hardcoded `#1b1712` when refactoring |
| Theme preview | `html[data-theme-preview=...]` in `globals.css` | Dev-only; still has legacy red/blue — update or remove when touching |

---

## Checklist for any UI change

Before opening a PR or marking a screen “done”:

- [ ] Uses semantic Tailwind tokens — no new raw `#c92a2a`, `#2563eb`, or cool greys.
- [ ] Every number carries `tabular-nums` — **always**, whichever face it is in. Sora's digits are proportional without it (rule 7).
- [ ] Micro-labels are Sora 12px 600 sentence case, muted grey — **not** mono, and not uppercase-tracked.
- [ ] Primary actions use `Button` / `ButtonLink` primary (yellow + dark text).
- [ ] Cards use `CardPanel` or `SurfaceCard`, not one-off `bg-card` wrappers with different radii.
- [ ] Section labels use `<Eyebrow>` where the dashboard does.
- [ ] Page title uses `.page-title` (**Space Grotesk 700, sentence case, `-0.01em`**).
- [ ] Works at 390px width with bottom tab bar — and `layout:probe` at 390px is UNCHANGED if the
      change was for desktop.
- [ ] Works at 1440px: content centred on the same axis as the page title, no dead right margin,
      no phone-width component stretched across the pane.
- [ ] No behavior, routing, or API changes.
- [ ] Yellow is not used for data meaning (only actions / focus — the corner-balance instrument is the single signed-off exception).

---

## Known gaps (causes of current drift)

Track these when prioritizing rework:

1. **Login** — ✅ Inter + semantic tokens (June 2026 typography pass).
2. **Logo** — ✅ Resolved 2026-07-11. On-brand yellow/white JRC marks (`public/brand/jrc-mark-{yellow,white}.svg`) replace the red→blue asset; new `JrcMark` component (variant-aware) replaces the retired `JrcRaceEngineerLogo` (deleted). Yellow = brand/hero (app icon, login, launch splash); white = working chrome (desktop sidebar, mobile top-left). App icons/favicon/apple-touch generated to `public/icons/` + `app/icon.png`/`app/apple-icon.png`. See `docs/PWA_NORTH_STAR.md`.
3. **Partial primitive adoption** — `panel.tsx` only on dashboard + partial engineer; 37+ other routes use ad-hoc patterns.
4. **Numeric typography** — ✅ **Resolved 2026-08-14.** Was the largest open gap: two contradictory rules at once, ~460 `font-mono` sites across 126 files, 23 distinct numeric font sizes, ~20 figures with `tabular-nums` and no font class, ~20 with `font-mono` and no `tabular-nums`. Now a six-step `.fig-*` ramp with `tabular-nums` welded to each step, enforced by `e2e/typography-audit.spec.ts`.
5. **Theme preview switcher** — alternate themes still reference old red/blue palette; section label uses `<Eyebrow>`.
6. **Legacy font cleanup** — Heebo + HK Grotesk Wide retired (June 2026); Sora replaced Inter 2026-07-03 (the `"Inter"` fallback still sitting in `tailwind.config.ts`'s `sans` stack is dead — Inter has not been loaded since). Tier C section labels migrated to `<Eyebrow>` (June 2026 pass); remaining `ui-title` is entity names, field labels, badges, and chat speaker tags only. **JetBrains Mono deleted 2026-08-14** — two faces load now (Sora + Space Grotesk), and the font payload dropped from 11 woff2 files to 5.
7. **Figma** — screen templates for Tier A were planned but blocked by MCP rate limits; code-first rollout proceeded without full Figma component library.

---

## Out of scope (separate tracks)

- **Engineer KB content** — `content/vehicle-dynamics/*.md` and `parameterEffects/catalog.ts` (see `AGENTS.md`).
- **Logo/wordmark redesign** — planned Phase 2; yellow + warm-dark, replacing red/blue SVG.
- **New features** — this doc governs visual consistency only.

---

