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

### 2026-09-21 — a week of real testers, and the blind car

- He asked who had used the app that week; the production log had 12 Engineer questions from three
  testers (on the OLD production Engineer, ec6b134). He asked for a review of those and of round 04's
  fifteen. The review was Claude's, not his — round 04's cards are still unjudged by him. What it
  found, each checked against production data: rear toe-in led 7 of ~10 rear-grip answers on cars
  already at 3° to 4° (one tester on 4° was told to add more); a tester with spur 66 / pinion 39 /
  21.5T on his sheet asked "What fdr for 21.5T" and was told "there's no current ratio… What FDR are
  you running now?" — the Engineer is not shown gearing; a tester with an EMPTY sheet was told his
  sheet "was copied forward and is not yet verified"; "front shocks one hole more laid down" offered
  on an A800RR; two of three active testers hit a parked KB page (gearing, tyre temperature).
- Offered five next steps — (1) let it see spur, pinion, motor; (2) normal values per knob; (3) only
  levers on the driver's sheet; (4) a plain "can't see your setup" line; (5) get beta's Engineer live.
  His: **"one sure, two yes, three yes. I think we need to have a strong distinction between when the
  engineer can read a car and when it can't. In terms of being able to read a car, we need to do the
  setup sheet stuff. But I would say for now, focus on the things that would still require improving
  even if it can't read the car."** Then: "Continue using best judgement, then do another review of 15
  questions." → BUILT same day, label `2026-09-21-blind-car` (north star changelog has the five
  parts). Measured while building: 140 of 230 production chassis have sheets whose boxes the app
  cannot name — his "setup sheet stuff" is the larger half, and none of it is in this change.
- **Claude's calls, not his — each needs his read:** the one prompt sentence (say once that the setup
  is not visible and what would change that); the rear-toe `usual` line ("about 3° per side; most
  cars sit between 2.5° and 3.5°, and 4° is the far end of what is run" — drafted from 628 logged
  runs, most of them his own car; in round 04 f-32 he himself called a 3° car "super high rear toe",
  so his number may be lower); `drafts/gearing.md` (mechanism and what the driver can see, no ratio
  for any motor — the page he had parked until after launch); the non-touring fact line.
- Two questions put to him, unanswered: blind, should it commit to a change with a step (as now) or
  lean toward asking what the driver runs; one usual range per knob for touring, or split by surface
  or class.
- Round 05 (15 conversations, 12 blind, real testers' questions) published to the round artifact.
  Unjudged.

### 2026-09-22 — lap times: "you have to be too specific"

His morning read, after a night's sleep on round 05: "you have to be too specific to get the lap time
analysis or comparison that I want. Like I often get the answer, I can't see that." And on the setup
side: "when you said if it's already reaching four that's too high — we've given it a static rule,
which is one of the things we want to avoid." Then: "Let's focus on getting lap times perfect for now."

- **What "I can't see that" was, measured.** 114 production answers in 60 days, 2 said it, both old.
  His own of 14–17 September were the real ones, and they split two ways: (a) the subject bar sets the
  scope, never the question — the SA tyre-delta question asked on a single run got "I can only see this
  session's 15 laps", the same question three days later with the range picked got a good answer; (b)
  lap-by-lap was never on the wire at all — "first 5 laps vs last 5", "least fade" could not be answered
  however worded.
- **His rulings.** Everyone in the class's laps, or results and every lap of every driver, "so that it
  can interpret it with all the information that a person would have". Practice from LiveRC: "fine for
  the engineer to call it upon request … you could be asking midday, and then it's going to have to get
  it anyway" — and a "fetching LiveRC results" line in the thinking indicator. Built the same day
  (north star changelog 2026-09-22): the LAPS block and the first tool.
- **On the static rule he named:** he is right; the `usual` header sentence ("a car at the far end has
  little left in that lever") is a rule with a number in it and mine to pull. The mechanism that would
  let the Engineer reason it out — a tyre's grip rises with slip angle to a peak and not beyond, so
  each degree of toe-in buys less and costs the same drag — is on no KB page (checked: `toe-and-scrub.md`
  has the slip angle and the scrub, not the peak). Proposed as one physics sentence for his ruling;
  not written. Parked behind lap times at his word.
- **Readable sheets vs blind answers:** my view given — every hour on blind answers polishes the
  fallback, every hour on readable sheets moves a driver out of it; 140 of 230 chassis are unreadable
  and the first strangers at launch will mostly be blind cars. He chose lap times first.
- **Round 06** (ten lap-time questions in his words over his SA Saturday, the day's laps on the wire,
  LiveRC's practice page recorded) published as version 13 of the round artifact. My read: the
  numbers I checked are all right; it fetched on exactly the three practice questions; l-08 correctly
  flagged a tyre-run label that did not fit the question. His read owed. **That read was wrong — see
  2026-09-23: I had checked only the easy numbers.**

### 2026-09-23 — rounds 05 and 06 reviewed "as him", then "continue using your best judgement"

His ask: "Act as me to review the engineer answers. Make subtle changes, review them and discuss what
needs to be improved… it also needs to have info on all disciplines of cars — discuss the best way to
do this regarding nets and the prompt… discuss for now, no changes." The review is CLAUDE'S, written
in his voice, at https://claude.ai/artifact/33YxSPCjcZmAFGNuLhKysb — every card marked up strike /
insert with a one-line why. None of it is his ruling until he says so.

- **Round 06 as reviewed: 1 good, 4 close, 7 wrong** (of 12 answers). Two of the wrong were my clock
  bugs (practice 9½ h late → "quickest in the afternoon practice" for a practice at 8:58 am; stamp-less
  heats at the time logging started). The rest: a sum the model did itself (0.91 for 0.68), a tyre
  drop-off compared across two sets, "where am I losing time to Tim" missing a 1.3 s first lap and a
  heat he won by 4 s, Rhys's 16.17 short lap as his best, and "was that faster" crediting the car
  with a crash lap and new tyres.
- **Round 05 as reviewed: 2 good, 10 close, 4 wrong, 1 needs an off-road racer.** Wrong: the
  rear-toe "far end" rule twice (the static rule he named), more toe on a car visibly at 3.2° (r-02),
  and b-01 talking a buggy driver out of his own "too soft" read. Close: car-specific parts named on
  cars it can't read (under-hub shims to a Yokomo), loose-entry answers that never consider the front,
  stray sentences, machinery words ("gearing guidance here is unverified").
- **Discipline plan, proposed (not ruled):** one prompt with "touring" out; one physics KB plus the
  off-road and pan-car physics it lacks; nets per FAMILY (on-road independent / pan & F1 / 1/10
  off-road / 1/8 off-road), written by what a change does, not by the A800's shims; each readable
  sheet box to carry what it adjusts, which end, which way is "more" — the contract with the sheet
  work; an off-road round read by an off-road racer before deciding what a buggy gets meanwhile.

**Then his "continue using your best judgement — keep in mind the goal of the engineer". Built, label
`2026-09-23-results-and-classes` (north star changelog has the parts):** both clocks fixed; results,
average without slow laps, first/last five with slow laps counted, the track's movement per race and
a lap-by-lap section for a named driver (unique first names count) in LAPS; tyre sets lettered with
their measured drop in the day block; the rear-toe `usual` and its header rule off the wire; the toe
mechanism as `drafts/toe-on-the-grip-curve.md`; one fact that the knobs are named the way a
shim-adjusted chassis's sheet names them; "RC race engineer".

- **Round 06 re-run (batch round-06d, two samples of the Tim questions): 9 read as he would want, 3
  close, 0 wrong.** l-09 names lap 1 (1.33 s) and lap 13 (1.23 s) and the 4.08 s win; l-03 gives 0.17 /
  0.50 with "the last-five gap includes his late slow laps"; least fade +0.36 v +0.69 and +0.39 v
  +0.41 without his crash heat; "this arvo" → "there wasn't any afternoon practice"; l-08 finds the
  one set with a second run (+0.34 raw, +0.25 with the track out). Close: l-01 and l-04 still call the
  run faster (they now quantify the fresh set but don't net it out, nor see the 1.7 s is one smaller
  mistake); l-07 slips a sign on the post-lunch track. Round artifact v14.
- **Found on the way:** leaving slow laps OUT of first/last five fixed "fade" but broke "where am I
  losing time" (l-09 lost lap 1 and the win); counting them IN with "(3 slow)" beside the five fixed
  both. One sample is not a result — the l-03/l-09 re-runs were done twice.
- **Round 05 re-run (round-05c):** "I'm already on 4° of rear toe" now reasons ("4° is not, by itself,
  proof… the useful limit depends on the tyre, grip and toe gain") — no rule. But r-02 went back to
  "add 0.5° rear toe-in" on the A800 at 3.2°: with the drafted numbers gone the model has no reference
  for "a lot". The fix is a reference he gives (his normal rear toe for touring, as information), not a
  rule. k-03 still suggested under-hub shims on the Yokomo ("e.g."), so the parts fact alone didn't fix
  it; b-01 still argued with the driver (not touched — his call).

### 2026-09-23 later — his three calls

Asked for his normal touring rear toe (as a reference for r-02), the toe draft, the buggy answer and the
lap-time fix, he said:

- **Rear toe number — no.** "If we're gonna do normal rear toe for touring car, that would then lead
  into doing the average rear toe or average setting for everything on every car. Like, where does
  that end?" Ruling logged: no normal-setting numbers are written for the Engineer; a car's reference
  points come from its own data. r-02 (more toe at 3.2°) stays open until that data is on the wire —
  the published setups for the car (2 of 230 chassis have any in production) or the driver's own runs.
- **The toe draft — "I'm not sure what that is."** Owed: four plain sentences in
  `drafts/toe-on-the-grip-curve.md`, already read by the Engineer as unverified; it did not stop r-02.
  Explained to him the same evening; his ruling: **"delete"** — deleted. On "these come first, always"
  (bite-hold.md fact 6): **"not sure"** — left as it is; round 07 shows how often it steers answers.

- **b-01 — "it should help the driver test his idea… it should reason like a competent engineer
  human."** Built: one prompt sentence (label `2026-09-23-test-their-lead`). Three samples per wording:
  "help them test it" → the spring test 3/3, but "don't change the chassis yet" 2/3 and the tyre idea
  refused 3/3; "start with the test for it" → opens with the test 3/3, tests both ideas 2/3. d-16
  ("keep softening the rear spring?") now reads the driver's own last test; f-26 unchanged. Still
  pulling against it, both his to rule: bite-hold.md fact 6 ("These come first, always") and no KB page
  on tyre compound.
- **"Three. Yes, do that"** (the tyre effect worked out in code). Built: "against the run before" on
  every run of the day — top five, then the track in words ("the track 0.08 slower than then"), then
  the tyres' age from the day's own sets. l-01 and l-04: 4 of 4 samples say the new set hid a ~0.16
  loss. **Found on the way and fixed:** "P1/5" (best-lap rank) beside LAPS's finishing "P1 TIMOTHY
  HILYEAR" — one of two l-05 answers gave Tim two heats' quicker pace; the rank now reads "quickest lap
  of 5, 0.01 clear" and both re-run l-05 answers match the sheet on every margin (checked by script).

### 2026-09-23 evening — round 07, setup (the first small round)

His call on the loop: small rounds, "start first round now". Twelve real setup questions from
production (`questions/round-07.json`), each asked twice (batches round-07a, round-07b), Claude's grade
written before he read them (`answers/round-07a/claude-grades.json`) and folded under each card on the
page: https://claude.ai/artifact/FdPPP7qHWDRe9X1YU7q6C5. Testers' questions run on their own runs —
Jayden cmuaeokh600eekw043x5kk9uh (Sparko F8SE), Glenn cmu9eyp5u005ijz04rtild67s (A800R), Robbie
cmu8764t4000zl0049adehaee (AMX3 on the A800RR sheet), Ant cmu86f1bg00c2l504pd4xt5it (Yokomo MS2.1);
their captures are `fixtures/private-*.txt`, git-excluded, never committed.

**Claude's grades: 3 good, 8 close, 1 wrong** (first written 3/7/2 — see the HRB correction below).
- Wrong: j-01 (the buggy — opposite rear-diff advice on the two tries, never says which of three diffs).
- Close: o-01 (both tries crown 18:03 on a 16.87 first practice lap 0.55 s clear of any other lap Robbie
  did — his call whether that lap is real), j-02 (touring spring logic on a buggy), g-01 (more rear toe
  on Glenn's car at 4°), s-01 (only toe for "make the tyre work harder" — his July note wanted bar and
  roll centre), s-02 (one try adds rear toe gain after "rear toe hasn't helped"; neither takes front
  grip away), s-03 and s-04 (the word "contested"), s-05 (no roll-centre move for "hard to drive when
  grip comes up").
- Good: a-01, s-06, s-07 ("outliers": honest that it has nothing to compare against, reads his own day).

**Fixed without a ruling** (label `2026-09-23-round-07`): "contested" out of the prompt and the nets
header — re-asked, 0 of 4 (s-03, s-04 twice each; "genuinely goes either way" instead); "against the
run before" in on-track order (it had printed "against 14:53" under a 14:46 run filed later from the
timing sheet).

**The HRB mistake — Claude's, not the Engineer's.** Claude graded o-01 wrong for reading "rear hrb
setting" as the rear body height, took "Hydraulic Roll Bar" from a code comment
(`trendMinimumDeltas.ts`) without asking, and put "hydraulic roll bar (HRB)" on the wire. Founder:
**"hrb is rear body height."** The Engineer had it right in both answers. Undone before anything was
pushed: the sheet now says "rear body height (HRB) setting", the comment is corrected, o-01 is regraded.
The lesson: what a part IS comes from him or the manufacturer's sheet, never from a guess — the
agreement check caught Claude, not the Engineer.

### 2026-09-23 night — his targets, and the first loop against them

His call on the method: **"get me to say what i think a good answer would be, so you can continue
iterating with a goal. cant let it be too rigid because to an extent we want the engineer to reason
unbiased, not necessarily exactly as i would."** Agreed shape: per question a MUST, a NEVER and HIS
PICK; a try fails only on a must missed or a never done; a different pick with a sound reason goes on
his "it disagreed with you" list. His words for 8 of the 12 round-07 questions, verbatim, are in
`questions/round-07.targets.json` (never shown to the Engineer). Hold-outs a-01, s-06, j-02.

**What his targets said about Claude's grades:** three were off. g-01 — Claude called the thicker diff
"the right lead"; he: "lack of on power grip is normally oversteer, so thicken diff would make it
worse". s-01 — Claude marked down more rear toe; he'd use toe. s-05 — Claude missed that thinner oil
makes a hard-to-drive car more reactive.

**Method learned:** two tries a question is noise — the same unchanged Engineer gave 0 of 2 and 3 of 6
on one never. Every comparison below is 6 tries against 6 of today's Engineer (batches round-07-t0a…f),
all edits applied by the harness (`arms.ts` v1-nets-trial + `trials/*.json`), no shipped file moved.

| Question (his line) | Today (6 tries) | Final trial (6 tries) |
|---|---|---|
| g-01 never: thicker diff for "on power grip" | offered 5 | 0 — thinner diff led 2, "assuming the rear steps out" 2 |
| s-01 "stiffer everything… more toe" | only a question 5; stiffer 0 | always answers; stiffer bar/spring/rc 6 |
| s-02 never: rear toe gain after "rear toe hasn't helped" | 3 | 3 (8 of 28 across every run with E1) |
| s-05 never: thinner oil on a hard-to-drive car | 1 (+2 only a question) | 3 (never only a question) |
| j-01 must: thicker rear diff (buggy) | 5 | 5 — never (freer diff) 0 both |
| j-02 (hold-out) his corner-regime link | 0 of 4 | 0 of 2; 3 of 6 with K4 |
| a-01 / s-06 (hold-outs) | 2/2, 2/2 | 1/2 (+1 close), 1/2 (+1 argued from his own day) |

**The final trial** (`trials/final-2026-09-23.json`, + K4 in `final-plus-k4.json`):
- E1 (prompt — Claude's call): "a change they say didn't help counts against the thing it works
  through, not just that one setting". Needed WITH K2: with K2 and without E1, toe gain came back 11
  of 12 (t5, t6).
- K2 (bite-hold.md fact 1 — HIS CALL): "'Grip' on power with no end named is the rear holding on as the
  throttle comes in: lacking it is oversteer on power, not wheelspin." Carries g-01.
- E3 (prompt, his question rulings — HIS CALL): answer the likeliest reading first; a question only
  after, only if it would change the advice, never about what they already said. Question-only replies
  4 of 30 → 0; answers ending on a question 5 → 12 of 30 (the first wording made it 22).
- K1 (tyre-load-sensitivity.md — HIS CALL): where tyre heat comes from — stiffer in roll loads the tyres
  sooner, one end only also harder; toe scrubs. With E3, s-01 gives his answer 6 of 6.
- N2 (damper-oil-front THINNER, AI-drafted side — HIS CALL): "reacts quicker to every input… too far and
  it is edgy and hard to drive" — his a-01/s-05 words; no measurable effect alone.
- K4 (corner-regime.md — HIS CALL): low grip also slows the car, so every corner has more middle.

**Dropped after measuring:** N1, the diff prior with its balance effect first ("the rear gives up side
grip to put the power down") — best on g-01 (6 of 6) but j-01 lost its thicker diff (3 of 6, one freer
diff). E2/K3, "the change that gets it back" only for a cost the driver will miss (prompt and KB, with
and without the hard-to-drive example) — s-05 thinner oil stayed 2–4 of 6.

**Open, his call:** the 09-09 pair ("soften a bar for the middle, and thinner oil brings the first input
back", corner-regime.md) is where s-05's thinner oil comes from; nothing in wording stopped it. Also:
"more rear gain" in his g-01 line read as rear toe gain — unconfirmed.

**Found on the way (a code bug, not a ruling):** the roll-centre guard (`rcGuardCorrections`,
rcDirections.ts) appends "Correction — … a move above states the direction backwards" to CORRECT
sentences when a second move word sits nearer the lever ("0.5 mm more upper-inner shim or 0.5 mm less
upper-outer shim"; "remove … under-lower-arm shims — more front grip"). Seen in round-03, 05c, 07d,
t7b, hfa — live in production.

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
