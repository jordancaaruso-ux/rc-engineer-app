# Setup-suggestion directions — founder review

**Purpose.** Every row below is a **directional claim the Engineer currently states to drivers
as ground truth** — sourced from the locked direction-rules in
`src/lib/engineerPhase5/openaiEngineer.ts` (CHAT_SYSTEM) and the KB files they cite. This is the
review the plan calls for (ENGINEER_SUGGESTION_QUALITY_PLAN.md, "setup-suggestion → KB-change
review", 2026-07-23): go down it and decide, per row, whether the **KB** needs to change, whether
it's a **prompt/wording** issue, or whether it's **correct as-is**.

**How to use.** Fill the **Verdict** column: `ok` · `kb-change` · `prompt-change` · `discuss`.
Add a note. Only `kb-change` rows go to the `AGENTS.md` propose-diff-and-approve gate — nothing
here edits the KB. Generated 2026-07-23 by agent from the shipped prompt; not auto-updated.

---

## A. Directional locks — physics directions stated firmly

These are the moves the Engineer is instructed **never to reverse**. If any direction is wrong,
it is wrong in every answer that touches that knob.

| # | Parameter / move | Direction & effect as stated to drivers | Source (rule · KB) | Verdict | Note |
|---|---|---|---|---|---|
| 1 | **Damper oil** | Thicker (higher cSt) = less reactive, more compliant, better over bumps, calms initial steering, removes mid-corner rotation. Lighter = more bite, edgier. | rule 5 · `damper-oil.md` | | |
| 2 | **Rear toe-gain shims** (`toe_gain_shims_rear`) | **Fewer** shims = more toe gain on compression = more rear grip mid–exit. More shims = less. | rule 7 · `bump-steer-toe-gain.md` | | |
| 3 | **Front bump-steer shims** (`bump_steer_shims_front`) | **More** shims = more bump-in, adds initial bite, edgier. Fewer = less bite, straighter on throttle. | rule 7 · `bump-steer-toe-gain.md` | | |
| 4 | **Softer front ARB** | Adds mid-corner **front** steering (balance shifts forward at that phase, not rearward). | rule 6 · `droop-downstop-arb.md` | | |
| 5 | **More front toe-out** | Calmer entry (the KB-supported way to reduce front bite). | rule 6 · `camber-caster-toe.md` | | |
| 6 | **Raise upper-inner shims** (`upper_inner_shims_*`) | **Lowers** roll centre at that corner → toward "in the track": smoother, more mid-corner grip. | RC section · `roll-centre.md` | | |
| 7 | **Raise under-lower-arm shims** (`under_lower_arm_shims_*`) | **Raises** roll centre / adds geometric support at that corner. | rule 8, INNER LOWER ARM · `support-lower-inner.md` | | |
| 8 | **Upper-outer shims** | Lowering = flatter link → tends **lower** RC. Raising = more angled → tends **higher** RC. | UPPER OUTER rule · `roll-centre.md` | | |
| 9 | **Under-hub shims** (`under_hub_shims_*`) | Higher stack = more **sustained** grip; lower stack = more **response**. | rule 8, RESPONSE-VS-SUSTAINED · `response-vs-sustained-grip.md` | | |
| 10 | **More rear toe (static)** | Usually increases rear grip; safer/easier mid-corner to exit; costs rotation. | rule 8 · `camber-caster-toe.md` | | |
| 11 | **More negative camber** | More peak lateral grip mid-corner; past the tyre window costs braking/drive. | (used in inbox answers) · `camber-caster-toe.md` | | |
| 12 | **RC / link ↔ feel mapping** | Higher RC + more angled upper link = "on the track" (responsive, initial bite). Lower RC + flatter = "in the track" (smoother, mid-corner). "Responsive" reserved for higher RC only. | UPPER INNER / VOCABULARY rules · `roll-centre.md` | | |

**Hedged knobs (stated as two-directional — must never be presented one-sided):** rear ARB
(`arb_rear`), rear spring / rear spring rate (`spring_rear`), rear droop/downstop
(`droop_rear` / `downstop_rear`), front inner-lower-arm tendencies. Rule 3 + rule 8. Review
whether the hedge is right, or whether any of these should actually be a firm direction.

---

## B. Founder-flagged calibration concerns (from the rating inbox)

Specific things you flagged in real answers — the sharpest KB-vs-wording adjudications.

| # | Flagged in answer | The claim / behaviour | Likely nature | Verdict | Note |
|---|---|---|---|---|---|
| B1 | 2026-07-09, 6/10 (hairpin) | Engineer tied **inner steering angle (steering lock) directly to ackermann** — "28 → 25 = less ackermann = more steering". Your note: "relating steering lock directly to ackermann" is weird. | Steering lock (`inner_steering_angle`) and ackermann (link-on-rack position) are **different axes**. Candidate **KB / claim error** — `steering-geometry-ackermann.md`. | | |
| B2 | 2026-06-20, 4/10 (stiffer rear spring) | "A stiffer rear spring **can** lead to more geometric support." Your note: don't use "can" when it's a physical certainty. | Certainty vs hedge on a settled mechanism — `spring-rate.md` phrasing + rule 3 (preserve-hedges) may be over-hedging settled physics. | | |
| B3 | 2026-07-08, 9/10 (what other changes) | Suggested **less camber right after camber had just improved the car**. Your note: weird. | Behavioural/context (don't undo a just-won gain), not a KB direction. Likely **prompt-change** (recency of known-good). | | |
| B4 | 2026-07-08, 9/10 (what other changes) | Suggested a **0.2 ARB split** when **0.1 is the standard increment**. Your note: weird. | Magnitude/convention, not direction. Likely **prompt-change** (step-size realism) or a catalog note. | | |
| B5 | 2026-06-20, 6/10 (comparison) | Comparison used **"index" labels with no definition** (upper/lower link index, stagger). | Partly resolved (index proxies retired → `derived_*_angle`), but confirm no live surface still shows undefined "index"/"stagger" labels. | | |

---

## Notes for the discussion after review
- Rows marked `kb-change` → propose exact KB diff in chat, await typed approval (`AGENTS.md`).
- Rows marked `prompt-change` → edit CHAT_SYSTEM / catalog wiring; re-run `engineer:eval` before shipping.
- Anything touching **derived geometry** (rows 6–9, 12) is **A800-only today** — a KB direction that
  leans on computed RC must still read sensibly for cars with no pack (raw shims + general KB).
