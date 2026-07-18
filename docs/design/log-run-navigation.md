# Log-run navigation — decision doc

**Status:** Decided AND built 2026-07-18 (founder-interviewed: 6 questions + 5 artifact rounds). **F2 chosen** (F + slim recap line), with two founder amendments over §4:
- **Exit asks, never auto-saves:** "← Save & exit" became "← Exit" → prompt (Save draft & exit / Discard / Keep logging); skipped when nothing is entered.
- **Progression = one persistent track, in-place sectors:** a single continuous bar split evenly per logged area; a sector fills yellow over its own step's position when logged (not a left-to-right count fill, not the per-tick underlines — those read as scattered). Step icons always stay visible.

**Polish round (2026-07-18, founder-interviewed via 3-round artifact — https://claude.ai/code/artifact/0e9461f6-1fc6-4f8b-9f0d-6f819eb00ac8):**
- **Track = P2:** still one continuous bar with in-place sector fill, but the internal seams are **−21° angled cuts** (JRC glyph angle) instead of vertical hairlines; 7px tall, square outer ends (segment row bleeds past the clipped edges). P1 (free-standing angled segments — the old summary-card look), P3 (angled + shine) and flat rejected.
- **Expand cue = E1 grabber:** an iOS-sheet grabber handle on the bar's top edge (a real button opening the summary sheet) — "map ▴" text was undiscoverable and is gone; subtitle is now just "n of 6". Chip/chevron-cap variants rejected.
- **Primary CTA = C3/B1 pill:** −21° dark notch leading the label + top-light yellow gradient (`#FFDF3D→#FFD60A→#F1C700`) + real Phosphor icons (ArrowRight mid-flow, Flag-fill on Complete) replacing the "→" text glyph and 🏁 emoji. Shape experiments (right shear, left shear ×3, parallelogram, chamfer, squared) all rejected across rounds 2–3 — founder committed to the pill. `PILL_PRIMARY` (sheet + exit pills) shares the gradient finish.
- CDP-verified at 390px 2026-07-18: grabber opens sheet, in-place angled fill, CTA renders in both lives.

**Artifact (original F2 rounds, all variants + progression toggle):** https://claude.ai/code/artifact/3b9312c3-6d97-4780-b9d7-a9e789aa3859
**Implementation:** uncommitted 2026-07-18 — `LogRunWizardBottomBar.tsx` (rewritten), `NewRunForm.tsx`, `wizardWalk.ts` (gained `WizardStepStatus`), `LogRunWizardRail.tsx` deleted. Build green; CDP-verified at 390px + desktop (steps-as-history back, exit prompt on back-from-Session, map sheet, in-place sector fill). Not yet verified: real saves, iOS PWA edge-swipe history (§6 falsifier #4).

---

## 1. What's actually there

- **6 steps, not 7** — `WIZARD_STEPS` (`src/lib/runs/wizardWalk.ts:24-35`): Session · Tires · Prep · Setup · Laps · Feedback. The "7" comes from elsewhere (next point).
- **Three state vocabularies rendered at once** in `NewRunForm.tsx`:
  - Tab ✓/amber: `wizardStepStatus` (6 steps; Feedback ✓ = rating only) — `:3425-3441`.
  - Meter: `wizardSummaryParts` (**7 sectors** — Feedback split into rating-or-notes + handling) — `:3615-3623`.
  - Summary rows: `wizardSummaryRows` (**a different 7** — Car gets a row, handling doesn't, Setup has a third `chg` state) — `:3661-3758`.
  - The observed "2 of 7 vs checkmarks" mismatch is structural, not a bug: notes tick a sector but no tab; a car without a track reads ok as a row but unfilled as a sector/tab.
- **The summary card is NOT sticky** — it renders first in the form (`:4038-4158`) and scrolls away. Its rows already tap-jump (`goToWizardStep`, `:4126-4131`), so the "make the card the nav" hypothesis was half-built.
- **The tab bar genuinely replaces the global dock** — `LogRunWizardBottomBar` portals to body, stamps `data-logrun-wizard-chrome` (`:103-106`), `globals.css:382-385` hides `.bottom-nav` + `.mobile-brand-mark`. It also copies the dock's exact visual costume.
- **The Next button doesn't overlap the bar — it wraps.** On Setup/Feedback the action row is two pills with `flex-wrap`; at 390px they wrap to two lines and outgrow the form's fixed `pb-40` clearance (`:4033`). That's the content collision.
- **No back, no step history.** `wizardStep` is component state (`:723-726`). Browser back / iOS edge-swipe / Android back exit the whole flow silently.

## 2. The core problem, in one sentence

> The flow renders three disagreeing copies of its own state across three simultaneous surfaces, and dresses its flow-local nav as the app's global dock — so no single surface is authoritative for "where am I, what's missing, what's next."

## 3. Options considered

All built as working 390px simulations in the artifact and driven by the founder.

| | Model | Step jump | Costs | Worse for |
|---|---|---|---|---|
| **A** | Summary card owns nav (original hypothesis): tab bar deleted, card condenses to a sticky strip, bottom keeps Back + Next | 1–2 taps, **top of screen** | Sticky strip eats ~46px forever; every jump leaves the thumb zone | One-handed trackside hoppers |
| **B** | One bottom surface: card + bar merged; collapsed bar (meter + Next) expands to a jump sheet | **2 taps**, thumb zone | Jumps double in cost; map is undiscoverable until learned | Frequent hoppers |
| **B2→F** | B with the meter row as **six one-tap step ticks**; sheet remains for labeled map + saves | **1 tap**, thumb zone | ~52px unlabeled targets; busier bar | Gloved/fat-finger taps (watch in the field) |
| **C** | Demoted stepper: flat flow-scoped strip + ‹ › chevrons, summary stays as state-only | 1 tap | Keeps two state surfaces — the duplication we set out to kill; forward path loses its name | — |
| **D** | Today, bugs fixed | 1 tap | Keeps dock impersonation + three vocabularies | — |

Founder verdicts: A's top-reach rejected implicitly (chose B direction), B's two-tap jump rejected explicitly (chose B2), C/D not chosen. Precedent note: hiding global nav during a creation flow is standard world-class practice (Instagram, Airbnb, checkouts); the collapsed-bar-to-sheet mechanic is Apple/Google Maps DNA. The unprecedented part — one-tap random access — is exactly what the ticks preserve.

## 4. Decision — model F

**One bottom surface, one vocabulary, exit that asks.** Mobile wizard chrome becomes a single card-edged bar (visibly *not* the dock):

- **Row 1:** `‹` (previous step) · step name + "n of 6 · map ▴" (opens the sheet) · primary action — "Next: X →" through Prep, "Laps →" on Setup, "Complete 🏁" on Feedback ("Save edits" when editing a completed run).
- **Row 2:** six **one-tap step ticks** — icon + skewed logged-underline (the meter and the tabs, merged). Amber ring/dot for required-missing.
- **Map sheet** (tap step name): six labeled rows with live values (this is where "Volante Set 3 / 97 values / 7 ⁄ 10" and the *prefilled* chips move), plus **Save draft 💾** and **Mark run complete 🏁** (same gate + jump-to-fix as today).
- **"← Exit"** top-left (replaces "Save & exit"): nothing entered → just leaves; otherwise a prompt — **Save draft & exit** / **Discard — exit without saving** / **Keep logging**. Edit mode words it as Save changes / Discard changes.
- **System back = previous step** (each step change becomes a history entry); back on Session = the same exit prompt. The `‹` chevron behaves identically.
- **Deleted:** top summary card, dock-costume tab bar, floating action-pill row (and its wrap collision), the desktop side rail, "Save & exit". Desktop gets the same bar, centered. Keyboard-hide behavior carries over. Classic `?wizard=0` untouched.
- Setup's "Not run yet — save draft" pill is subsumed: Save draft lives in the sheet and the Exit prompt covers walking away. (Watch this — §6.)

**Why F:** it's the only option that fixes both halves of the core problem at once — one surface means one vocabulary *by construction*, and a card-shaped bar can't impersonate the dock — while keeping jumps at one tap in the thumb zone, which A and B each gave up in different ways.

## 5. The state model that follows

One type, computed once, rendered twice:

```
StepStatus = { done: boolean, attention: boolean }   // per step, 6 entries
```

- Predicates (today's `wizardStepStatus`, kept): session = car && track (attention when track missing at save) · tires = set picked/intent · prep = any prep/additive · setup = attached or values (attention from complete-validation) · laps = imported · feel = **rating** (attention from complete-validation). Notes + handling become in-step enrichment — counted nowhere.
- Rendered in exactly two places: tick underlines/badges on the bar, and the sheet rows (value + same status). "n of 6" is derived from the same array.
- Delete `wizardSummaryParts`, `wizardSummaryRows`, and the 7-sector meter. Completion stays v7: explicit **Mark run complete**, gate = rating + track (+ setup validation).

## 6. What would tell us we got it wrong

- **Tick mis-taps trackside** (gloves, sunlight): if the founder or testers repeatedly land on the wrong step, ticks need labels — and a labeled tick row is a tab bar again; fall back to C's flat labeled strip *inside the same surface*.
- **"Where's my run state?"** — if mid-step he reaches for state that used to be ambient (the old expanded rows), F2's recap line (or a promoted map affordance) goes in.
- **Draft bail-outs drop** after removing Setup's explicit "Not run yet — save draft" pill: resurface a contextual save on Setup.
- **Accidental exits persist** despite history wiring — PWA/webview history is this app's known fragile spot (router-wedge class); if edge-swipes still eat work, the exit prompt must intercept more aggressively.

## 7. Open questions

1. **F vs F2** — slim one-line recap at the top of content (state only, never nav). Both are in the artifact; founder decides by driving. Everything else in §4 is identical between them.
2. **Sheet completion failure UX** — when Mark complete fails its gate from inside the sheet, does the jump-to-fix close the sheet and land on Feedback/Session with the highlight (assumed yes)?
3. **Session step's prefill/manifest card** — untouched by this decision (it's content, not chrome); confirming no interaction with the sheet's prefilled chips.
4. **History wiring on iOS PWA** — needs on-device verification before this ships (see nav-router-wedge history).
