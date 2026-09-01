import { createHash } from "node:crypto";

/**
 * The Engineer's whole instruction set.
 *
 * Carried across from v0 (2026-08-05) into the 2026-08-13 rebuild unchanged: this is the
 * prompt that won a blind 5-0 ablation against a 67K-char rulebook. The rebuild's rule for
 * this file (docs/ENGINEER_NORTH_STAR.md): stay under ~10 behavioral rules, each one
 * checkable, and every change lands through the eval harness before it ships.
 *
 * The logged-data sentence is load-bearing, not padding. Questions arrive phrased as
 * though every number the driver ever logged were attached; without an explicit statement
 * of exactly what IS attached (the driver-data block, nothing more), the model answers
 * with setup values it invented. Since 2026-08-25 a block with their latest session, its
 * setup and the nearest earlier runs rides along whenever they have one (driverData.ts) —
 * the sentence now draws the line around that block instead of denying data exists.
 */
export const ENGINEER_CHAT_SYSTEM_PROMPT = `You are an RC touring car race engineer.

Build your physics from the knowledge base alone. Where it is silent, say so; never fill in from general racing knowledge.

Nets are outcomes, not physics: reason from the knowledge base, never from a net's wording. A net may pick the lever, never decide the problem is the chassis — track, tyres or an unverified last change can be the answer; say so beside the change, not instead of it.

What the driver states is fact; never re-suspect it. Turn their words into the problem — which end, where on the corner, how the grip behaves — and pick the lever for that, never for wording that matches theirs. One question per conversation at most (a request for information counts), only when the answer would change your change; for a two-answer knob with the corner unsaid, ask how long they are turning for and how quick. Otherwise assume the likeliest reading, say so, and answer it alone. A contested prior is the exception: both claims, plus what on track decides it.

Never invent a number: use only numbers from the driver, the knowledge base, or this request's DRIVER DATA block — the only logged data you can see. Anything beyond that, say you can't see it, then answer what the physics alone can.

Talk like a driver at the pit table, not an engineering report: plain words, each thing once, the specific thing not its category. A change is what the driver will feel and where on the corner — the nets' register — not what moves inside the car. Shape the answer to the question:
- A problem: the change and how far, one line, no preamble; then two or three other levers, a line each — move, size, what sets it apart.
- What a change does: the feel and where on the corner; other levers only if you would truly reach for them, at most two.
- Why or how: the mechanism, plainly.
A reason only when it changes what the driver does, and only a clause. They will ask if they want more.

Answer the question asked.`;

/**
 * Header on the KB system message — the three rules that were doing real work when the
 * 3,081-char original was cut down.
 */
export const ENGINEER_KB_HEADER = `VEHICLE DYNAMICS KB — FULL TEXT (canonical, hand-curated ground truth).
This is the COMPLETE knowledge base: every file, full prose, nothing filtered or retrieved. Everything the corpus knows is below.

NEVER NAME THESE FILES TO THE DRIVER. Read them, reason from them, then speak in your own voice — no filenames, no \`.md\`, no "per the KB", no "according to". The driver does not know this corpus exists, and naming it reads as machinery leaking through the answer.

THESE FILES STORE MECHANISMS, NOT OUTCOMES. They describe what a change does physically and stop short of saying what the car will then do, because the same change genuinely goes both ways on different days. Where two files push opposite ways on one knob, hold both and say what decides it — do not compose one confident verdict out of primitives that disagree.

`;

/**
 * Which Engineer build produced an answer. Stamped into every rating snapshot so a batch
 * of ratings can be pulled out per Engineer build. Bump the label when you change Engineer
 * behaviour you want to measure separately; edits to the prompt text itself move the
 * fingerprint even when the label is left alone.
 *
 * 2026-08-25-live started a new baseline (nets in the payload + driver-data blocks,
 * shipped by founder call). 2026-08-27-corner-clock starts another: nets are outcomes only,
 * in the driver's words, with two answers for roll levers (before / once settled) and one
 * for everything else; the prompt gained what a net is for, the boundary that a net may pick
 * the chassis lever but never decide the problem IS the chassis, and the one corner question
 * (how long are you turning, how quick are you going) asked only when it would change the
 * answer. 2026-08-28-driver-facts starts another, from reading the model's reasoning summaries
 * on the founder's own questions: the driver's statements are facts (it was re-suspecting
 * "tyres are fine"), one question per conversation then commit (it asked twice and changed
 * nothing), and levers are picked for the interpreted problem, never for a description that
 * repeats the driver's wording (camber, toe-out, flex and the lower arm were all word-matches).
 * 2026-08-28-one-change-then-others starts another (founder call): lead with the one change,
 * then up to three other levers that would also do it, a line each with what sets it apart,
 * so the driver can ask about any — replacing the older "wider list of factors" sentence.
 * 2026-09-01-say-the-change starts another (founder call: "too fluffy and technical — people want
 * to make their car fast; if they want more info they will ask"). Three habits were eating ~80% of
 * an answer's words: a physics justification under every change (in the KB's own register — "the
 * settled lateral load transfer"), branching instead of assuming (a kerb case AND a hopping case
 * AND a smooth-corner case), and a "tell me whether…" pair of questions at the end. It also named
 * four levers that each have a founder-dictated step and quoted none of them. So: the change and
 * its size on line one, a reason only when it changes what the driver does, alternatives as one
 * line each with the size, one version of the question only, and the question rule now says a
 * request for information at the end of an answer is still a question.
 * 2026-09-01-feel-not-mechanism starts another. Those rules only bite when there IS a change to
 * lead with; asked "what happens if I raise my inner lower arm pickups" the model wrote five
 * mechanism bullets ("more lateral load goes through the links instead of waiting for the car to
 * roll onto the springs") while the founder-reviewed net for that exact knob already carried the
 * answer in his words ("more direct and precise from the first input… tends toward understeer
 * mid-corner"). Cause: two lines — here and in ENGINEER_NETS_HEADER — said "never let a prior stand
 * in for the mechanism it points at", written to stop the model reasoning FROM net prose but read
 * as "always show the mechanism". Both re-aimed at reasoning, and the shape paragraph now says to
 * describe a change by what the driver feels and where on the corner, with the mechanism kept for
 * when they ask why or how.
 * 2026-09-01-shape-of-the-question starts another (founder call: review for precision, concision and
 * contradiction, then "be ruthless with cuts"). The prompt had grown 21% in a day and the whole last
 * paragraph assumed a "what should I do" question — so "what does this knob do" got an imperative
 * opener and an unearned alternatives list. Rebuilt at 1,955 chars (42% down): the shape paragraph
 * now branches on the question (a problem → change + size then two or three levers; what-a-change-does
 * → the feel, alternatives only if truly reached for, at most two; why/how → mechanism), "never two
 * answers" is scoped to versions of the question with the contested-prior exception named beside it,
 * the two-answer-knob rule lives only in the nets header, and every duplicate said once. Deliberate
 * cuts to watch: "if they ask for a straight answer, give one" (shape rules should force it) and the
 * numbers paragraph's examples ("lap history, older runs, another car") — if the model starts quoting
 * setup values it wasn't given, restore the examples first.
 * 2026-09-01-no-confidence-tiers starts another (founder call). The per-side confidence tag had
 * become a lever ranking: on "how can i get more initial steering" the model led with the consensus
 * knobs (oil, ARB, spring) and dropped bump steer — whose net says "more initial steering" verbatim —
 * because it is majority, as is every geometry lever. The tags measured how uniformly the published
 * guides spoke, not lever strength, so they are no longer rendered (netsSchema.ts) and the nets
 * header now says every entry carries the same weight. Tags stay in the YAML; one commit restores
 * them. CONTESTED claims still render and the prompt's contested sentence still applies.
 * 2026-09-01-rc-direction-guard starts another (founder call: "add something deterministic that
 * means the engineer can never get the direction of rc wrong"). The model inverted a roll-centre
 * move a second time ("raise the RC with upper-outer removed or upper-inner added" — both lower
 * it) and sized it as an RC distance ("by 0.25 mm" — one chassis's shim/RC coincidence, per the
 * founder). rcDirections.ts now (1) renders a goal→move table into the nets block, derived from
 * the founder-owned words lines so it cannot drift, and (2) checks every finished reply in code:
 * a shim-move/RC-direction contradiction or an RC-distance claim gets its correction appended to
 * the stream and the stored message. upper-link-geometry.md carries the sizing ruling.
 * Scores are not comparable across labels.
 */
export const ENGINEER_PROMPT_LABEL = "2026-09-01-rc-direction-guard";

export function engineerPromptFingerprint(promptText: string): string {
  return createHash("sha256").update(promptText).digest("hex").slice(0, 8);
}

export function formatEngineerPromptVersion(label: string, promptText: string): string {
  return `${label}+${engineerPromptFingerprint(promptText)}`;
}

/**
 * Hashes exactly the two constants above — when the prompt is this small, the fingerprint
 * is a complete description of what the model was told.
 */
export const ENGINEER_PROMPT_VERSION = formatEngineerPromptVersion(
  ENGINEER_PROMPT_LABEL,
  [ENGINEER_CHAT_SYSTEM_PROMPT, ENGINEER_KB_HEADER].join("\n")
);
