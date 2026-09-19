# Engineer review ledger

What Jordan said about real Engineer answers, in his words, and the fix each note became. Moved here
2026-09-19 from `scripts/engineer-eval/answers/launch-2026-09-09/founder-notes.md` — that folder is
git-ignored, so the record of every ruling lived on one disk. Whether a ruling is actually in the
code is not recorded here: run `npm run engineer:rulings` (add `-- --ref origin/main` for what
production builds from). The answers themselves stay in `scripts/engineer-eval/answers/` (ignored).


Jordan reviews by talking in the chat, not by ship/not clicks (his call, 2026-09-09). One entry per
case he speaks to, in his words, with the fix it turned into. "fine" entries count toward the
nine-in-ten. Cases he never mentions stay ungraded.

Format: `case · context — what he said → what it is (rule / net / KB scope / prompt) → status`

## Notes

- **1/112 · d-01 · none** — "quite good" → fine.
- **2/112 · d-01 · run-with-setup** — Engineer read "turn my car the right way" as turning RIGHT; the novice meant "turn properly". "The answer is still fine though." → fine; misread noted, no change asked.
- **3/112 · d-02 · none** — ride height both ends: "grip arrives a little later and more progressively entering the corner" is weird — "arrives later" sounds like later in the DAY; wants it specific to the corner ("it can give more grip later in the corner"). "more hold once you're in the middle" → just "more grip once you're in the middle". Stiffer FRONT ARB answer "quite good". Stiffer REAR ARB: wants "it can give less rear grip and more oversteer, but sometimes it can feel like more rear grip and less rotation, even in the middle of the corner" / "often can feel like more rear grip through the whole corner". "that end grips sooner" is weird → "that end responds to your input faster, or something like that". → net wording (rear contested claim_b; 'bites sooner' lines) + KB register leak ('arrives', 'hold') for a whole-car move no net covers.
- **4/112 · d-02 · run-with-setup** — same: "grip arrives a little later" is not how any driver talks; wants "it can give more grip later in the corner" or similar. → same as 3.

### Round 01 (batch round-01, run-with-setup, 2026-09-09)

- **d-07 turn 3 — "Give me 5 levers for more hairpin steering"** — "pretty big failures": stiffer
  front bar and higher front RC both carry "can add understeer in the middle", and a hairpin is
  MORE middle than any other corner. The Engineer opened "assuming it is missing as you turn in".
  Trace: no net names a hairpin; the ackermann less-side says "more initial steering… does more the
  tighter the corner is" (the magnet); nets promise steering ENTERING 35× vs IN THE MIDDLE 12×;
  the hairpin = longest-middle fact lives only in corner-regime physics prose, and the complaint
  method's fact 2 maps driver words to phases but not corner NAMES. Prompt's "assume the likeliest
  reading" made the wrong assumption cheap. → discussed, then BUILT on his "build it" (2026-09-09):
  one passage in bite-hold.md fact 2 — "A corner named is a phase given": its time (length ÷ speed
  vs settle time, corner-regime) decides before any assumption; a hairpin is mostly the middle; a
  chicane / flick / direction change is entering; never assume turn-in for a corner whose name says
  otherwise. No net touched, no prompt line, Ackermann's "tighter the corner" clause left as is.
  RE-ASKED (batches round-01b, round-01b-corners, with setup): "5 levers for more hairpin steering"
  → opens "in the middle": softer front bar, more negative front camber, more front droop, more
  caster, front upper-inner shim — all middle levers, entry costs stated as costs. "Understeers
  through the middle of the fast sweeper" → body 1 mm forward first (fast-corner lever), then
  middle levers. "Loose through the chicane" → asks whether the rear steps out or the front turns
  so sharply the rear cannot match it (fact 1's ratio reading, now surfacing as the question).
  d-03's truncated "hairpin steering - it's really only" → asks off power / in the middle vs on
  throttle.

- **d-07 turns 1–2 — "Softer rear spring made the car much worse… Everywhere"** — the Engineer put
  it back to 119.6 and then offered rear toe / thicker rear oil. His rule: "if softer rear spring was
  clearly worse, it should suggest going the OTHER direction before anything else". Trace: nothing
  on the wire reads a failed change as evidence — fact 6 only says verify the last change; the north
  star's "a change that doesn't work still tells us something" lives in the doc, not on the wire.
  → discussed, then BUILT on his "Yep, implement that": fact 6 of the complaint method gained "A
  change the driver says made the car worse everywhere is the strongest evidence on the sheet" —
  the same lever the other way, one step past where it started; if that is worse too the old
  setting was right; back-to-baseline is for wanting the old car; worse in one phase and better in
  another is a two-answer knob, read as fact 2. RE-ASKED (round-01c): "Fit the rear spring one step
  stiffer than the spring you had before — not just back to the old spring. Run that change alone;
  the softer-spring test says this car wants the rear stiffer today" + the long-vs-quick discriminator.
- **Paired changes (his idea, round 01)** — "it's not always this change is better / worse… it could
  be this change has the potential to be better, but it requires other changes to show its true
  advantage" (e.g. more mid-corner steering, then a second change to get the initial precision
  back). Trace: the wire has NO pairing principle — the prompt shape is one change + up to three
  alternatives "set apart"; the KB carries the physics for the canonical pair (damping leaves the
  final roll angle alone, so it can restore entry timing without touching the middle) but never
  says so as a composition rule. → he chose OPTION 1 (physics sentence): BUILT in corner-regime.md
  ("Two changes can share one test" — gain/cost pairing, damping as the usual second half, one test
  vs two runs in order, first change first). RE-ASKED (round-01d, round-01d-corners, 6
  conversations): the pair did NOT surface in any of them — costs are named ("with less initial
  steering") but no second change is offered to get the phase back. Same pattern as the fact-1
  edit on loose-entry: a premise on the wire does not move the answer when the answer SHAPE has no
  slot for it. His call: OPTION B ("B makes by far the most sense") — the prompt's "A problem" line
  now reads "…where that change costs a part of the corner, the change that gets it back without
  touching the gain, one clause; then two or three other levers…". Label `2026-09-09-paired-changes`;
  north star §2 + changelog updated; tsc, engineer-chat 7/7, rc-guard 8/8. RE-ASKED (round-01e,
  round-01e-corners): the pair SURFACES where the shape applies — "How can I get more hairpin
  steering" → upper-inner shims for the middle, "it will cost some steering on the first input. If
  that first input becomes too calm, go 50 cSt thinner in the front oil to bring it back without
  changing the middle"; the sweeper → body 1 mm forward "…may cost a touch of rear security there,
  so raise the body rear 1 mm if needed". The "give me 5 levers" list form has no lead change, so no
  pair — as designed. Artifact republished ("Round 01, prompt B").

### Round 02 (batch round-02, run-with-setup, 2026-09-09) — "quite a lot of issues"

- **d-04 t1 + d-08 — review questions ("what could I test", "what should I have tried")** — the
  Engineer asked "where was the car worst: entering the corner, in the middle, or exiting?" and
  "front or rear, and worst entering / middle / exiting on/off power?". His: "just a weird thing to
  say. The question should be: did you have any problems? what problems did you try to fix? Not
  specifically where was the car the worst." Trace: fact 2 scripted the phase question for any open
  fact, and on a review question every fact is open — nobody has named a problem. FIX: fact 2 — the
  phase question is for a named problem's open phase; a driver who has named no problem is asked
  whether the car gave them problems and what they tried (founder, 2026-09-09).
- **d-04 t2 — "how can I fix exit oversteer" → "on power as you exit, or off power before you pick
  the throttle up?"** — His: "exit is always on throttle. There's not really a situation where exit
  doesn't mean on throttle." Trace: fact 3 said establish on/off "for anything at the rear or on
  exit". FIX: fact 3 + the Throttle vocabulary line — exiting is on power; where the throttle comes
  on is where the middle ends; entering and the middle can be either.
- **d-06 t1, d-14 (and d-06 t3's alternative) — mid-corner oversteer / more rear grip mid corner →
  0.5° more negative rear camber first, every time** — His: "generally you really wanna stick to
  that, like two degrees camber on a touring car at least. It can reach for camber, but it just
  reaches for it too often." Trace: the camber net is the only middle-grip lever with no entry cost;
  camber.md was four lines and said nothing about where the number sits or what says it is off.
  FIX: camber.md "Where the number sits" — the tyre sets it and reads it out across the tread; near
  2° on a touring car and the car stays there; past it grip goes everywhere, not a trade; balance
  complaints go to balance levers, camber last. Net lines untouched. The tread-reading sentences are
  mine (unmarked) — his check owed.
- **d-06 t2 — "smoothen out initial steering" → thicker front oil first; d-15 — "more initial
  steering" → front upper-inner shim first** — His: "it should definitely be looking for a steering
  response answer here. More front toe out, less bump steer, something like that." / "it needs to
  reach for bump steer, toe here for sure." Trace: steering-response.md says the angle and the grip
  are both felt as steering but never which an "initial steering" request points to; fact 4 leads
  with the grip curve, and "initial" pulled the model to bite (the 09-01 no-confidence-tiers finding
  again). FIX: steering-response.md — the first input is the geometry's before it is the grip's:
  the angle is there the instant the wheel turns, before load has moved; toe, bump steer, Ackermann,
  caster first, grip levers after. Fact 4 gained the pointer. The toe-front net already carries his
  direction (more toe-out = smoother, less immediate on turn-in).
- **d-12 t1 — traction rolling → "if it only happens in fast corners, lower the body rear height
  1 mm: less rear aero load"** — His: "that is a terrible suggestion." Trace: load-transfer.md's
  traction-roll paragraph says it comes sooner "the more grip there is" without saying which grip;
  the body-rear-height net says lower = less rear grip at speed; the model chained the two. FIX:
  load-transfer.md — the grip that tips it is the tyre's own; aero holds the car down in the same
  measure as it adds grip, so it does not move where the car tips (marked unverified — the
  cancelling is my physics, his check owed; the outcome is his); lowering the CoG is both ride
  heights together, one end alone is a balance change.
- **d-13 — "super low grip track, like driving on ice… more overall grip and a little more rear" →
  "does it gain grip once you're in the middle, or is it never there at all?"** — His: "so hard for
  a driver to answer. We are asking for a specific symptom of not enough initial grip by asking a
  question that's very confusing." Trace: bite-hold.md carried that exact question as its worked
  example ("'Like ice' on a low-grip day… one question decides it"). FIX: the example now says ice
  has answered facts 1, 2 and 5, fact 4 is read from fact 5 (late grip), the car is moved toward
  grip that comes sooner at both ends with the tyre-and-track check beside the change, and that
  question asks the driver to separate two things that feel the same from the seat.
- Not mentioned by him: d-10 (less front droop), d-16 (no traction on exit — keep softening the
  spring?), f-21 (just slow → tyres and prep against a comparable car?).

### Round 02 re-asked (batch round-02b), his pass 2026-09-14

- d-04 "good"; d-08 "a good question"; d-12 "pretty good"; d-13 "good". d-06 "pretty good" except
  turn 2 — **"smoothen out initial steering" led with front caster**: "would not be my first choice
  because it has a big effect on other parts of the corner as well… I would prioritize front toe or
  bump steer, which mainly have an effect at the start of the corner." And the alternative's rider
  "if the first input gets worse as the front compresses" is "too difficult to interpret for most
  people." Trace: the 09-09 steering-response paragraph listed the four geometry levers as equals, so
  the tidiest trade line (caster) led. FIX (his "Yes. Do that."): steering-response.md "The four are
  not equals" — toe and bump steer are small fixed angles that count most when the input is small
  (the first input) and are swamped under lock; caster and Ackermann grow with how far the wheel is
  turned, so they reach the middle and exit. First-input complaints → toe or bump steer first. The
  compression rider was the model's own discriminator for bump steer; expected to go on its own — if
  it survives, the bump-steer page names what the driver notices (braking in vs rolling in). Re-asked
  d-06 and d-15 (batch round-02c).

### Round 03 (batch round-03, run-with-setup, 2026-09-15)

- **f-20 "the front feels lazy going into the fast stuff"** → less toe-out, thinner oil, front upper-inner
  shim. His: "would be good in a situation where you'd say more front roll stiffness would generally
  help… rather than a specific parameter… a different spring or a different front bar could also help
  the same problem." On my offer of a KB sentence sending lazy-in-fast-corners to grip timing: "I don't
  think it's as simple as… both still affect it… I don't want to introduce a static rule." → NO family
  rule. FIX (his "quite good"): nets header — where nothing the driver said separates a group's knobs,
  give the group move with a step on each knob and say which to try first for the least cost. Label
  2026-09-15-group-move. Re-asked f-20, f-17, f-22.

### 2026-09-19 — a lost round, found

- Another session found that the founder's **2026-09-04 round** (questions in the driver's words, "at
  most three" other levers, no banned-word list, the "would a driver say it" test) had been built in
  the `engineer-ship` side worktree, never committed, and never reached main — spotted when a
  production answer said "more rolled-in front" and "the front grip can arrive too late". Re-applied
  as commit d4a9d7d, label `2026-09-19-driver-words-restored`. Two of his round-02 complaints (the
  ice question, "where was the car worst") were that ruling a second time, and the 09-08 edit that
  widened the "closed list" tightened a list he had already ruled should not exist.
- Same day: every side worktree swept for stranded work (only the off-road tyres feature was
  unique; it was landed), the roll-call (`npm run engineer:rulings`), `/api/health/version`, and
  the main-folder rule in CLAUDE.md. Also found: the roll-centre direction check appended a false
  "states the direction backwards" to a correct reply (round 03, f-36 turn 2) — it read "for more
  initial steering" as "add more shims". One in 314 saved replies. NOT fixed yet.
- Round 03 cards still unjudged by him: f-17, f-19, f-22, f-25, f-28, f-32, f-36, f-37, f-49.

## Fixes landed from this batch

- **2026-09-09, from cards 3–4 (30 edits, 21 files; nets:check 37/37, tsc, 4 suites green):**
  - Rear contested claim B on 6 keys (arb-rear, spring-rear, under-hub-rear, under-lower-arm-rear,
    upper-inner-rear, upper-outer-rear): "…gives more rear grip and less rotation — on track, often
    the way it goes" → "…often feels like more rear grip and less rotation, even in the middle of the
    corner" (his sentence).
  - "bites sooner / later" → "grips up sooner / later as you turn in" on 16 lines across 10 keys. My
    call over his "responds to your input faster": keeps his 08-29 split (bite = grip, response =
    the angle the car gives the tyre) and locates the phrase in the corner, which was the real
    complaint about "arrives".
  - "rear hold" → "rear grip in the middle / through the middle" on 4 lines (camber-rear ×2,
    upper-inner-rear, upper-outer-rear). `hold` stays the physics word.
  - Render label "CONTESTED — claim A / claim B" → "IT GOES EITHER WAY — one way / the other way"
    (netsSchema.ts) — the word "contested" was reaching drivers.
  - Vocabulary list: "Grip arriving" group → "Grip, and when in the corner it comes": to a driver grip
    is sooner or later IN THE CORNER, more grip in the middle, more grip through the whole corner;
    "arrives" and `hold` are the page's physics words, never the driver's (bite-hold.md).
  - NOT changed: the ~30 "arrives" in physics prose — correct where they are, the list now fences them.
  - Root cause on cards 3/4: a whole-car move (both ride heights) had NO net, so the Engineer
    composed from physics register. → founder interview 2026-09-09, all four answers the recommended
    option: whole-car moves live as BOTH ENDS TOGETHER lines on the family's GROUP heading; first
    ride height, bars + springs, roll centre (matched shims), damper oil; both directions name their
    too-far edge; NO day words. BUILT: `content/nets/touring/_whole-car.yaml` (5 pairs, ALL AI-DRAFTED
    from the KB, `reviewed: false` — his pass owed), loader + render in nets.ts / netFamilies.ts,
    validator checks (edges named, no day words, knobs resolve), test. Re-run of d-02 (batch
    launch-fix1): "a little more grip through the whole corner, with grip coming a little later as
    you turn in" replaces "grip arrives later… more hold"; the rear-bar answer now says "can go the
    other way and give more rear grip instead" with no "contested"; "stiffen both by the same amount"
    is offered as its own line. f-59 in his numbering is f-53 ("more overall bite") after curation —
    not re-run yet.
- **Whole-car lines — FOUNDER-PASSED 2026-09-09** ("All good"), one correction in his words: thinner
  oil both ends read as always better ("the same grip sooner and held longer") → now "the same grip
  sooner; because it reacts so quickly it can feel like less overall grip, not more". All five
  `reviewed: true`; nets:check 5/5 ok, test green. Note: the per-axle damper-oil-front thinner line
  still says "the same amount, there for longer" from his 09-02 ruling — not touched; flag if the
  same "always better" reading bothers him there.
