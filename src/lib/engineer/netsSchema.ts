/**
 * Nets schema v5 — pure (no fs / no server-only) so the runtime loader and the validator script
 * share one definition. Authoring rules: content/nets/README.md.
 *
 * WHAT A NET IS. One knob, and what it most likely does in EACH direction, in the driver's words —
 * balance, understeer, oversteer, steering, rotation. Those words appear NOWHERE in the physics KB,
 * on purpose (its header: "mechanisms, not outcomes"). Outcomes are the one thing a net carries
 * that nothing else does, and they are the ONLY thing it carries. Everything else — why, what
 * makes it bigger or smaller, when the opposite move is right — already lives in
 * content/vehicle-dynamics/, and a net that restates it is a shorter, more scannable copy the
 * model reaches for instead of the physics. Three earlier formats died of exactly that (founder
 * interview 2026-08-26/27; do not rebuild the phase grid, the tags, the slider index, or per-knob
 * flip conditions).
 *
 * ONE ENTRY PER KNOB, BOTH DIRECTIONS INSIDE (v5, founder call 2026-08-27). v4 wrote each knob in
 * one direction and left the model to invert the sentence. Driven on his own account, the
 * Engineer never once reached for "softer front bar" for more mid-corner steering: the roll-centre
 * net literally said "more front grip through the middle" and the bar net said the opposite words
 * in the opposite direction. At decision time a literal line beats a derived one every time, and
 * the unwritten direction — softening, the everyday move — was never in the running. So both
 * directions are written, side by side, with their own confidence, and each knob names its own
 * pair of direction words (stiffer/softer, thicker/thinner, more negative/less negative) instead
 * of a generic gloss.
 *
 * TWO ANSWERS OR ONE, DECIDED BY BEHAVIOUR. A knob that does one thing before the car has settled
 * into the corner and another once it has carries `before_settled` + `once_settled` on each side
 * (concepts/corner-regime.md). The test is the two answers, not the mechanism — the roll levers
 * are the obvious members, but front toe, caster, camber and bump steer split the same way. A
 * knob that does the same thing throughout the corner carries one `effect` line per side. The
 * unevenness is the physics talking, which is the only kind allowed.
 *
 * The driver's own words. `bite-hold.md` carries a closed feel vocabulary and names the coinages
 * that are not on it; the founder extended it with the balance words (steering, rotation,
 * forward traction, push, snap). The validator enforces the ban list, not an allow list — an
 * allow list is unenforceable on free text.
 */

export const NET_CONFIDENCES = ["consensus", "majority", "contested"] as const;
export const NET_SIDES = ["more", "less"] as const;

/**
 * Words that are not feel words, however natural they sound.
 *
 * `concepts/bite-hold.md` names the first group itself: *"`punchy`, `crisper`, `takes a set`,
 * `lined up`, `skatey`, `on top of it`, `nervous-feeling`, `too immediate` are examples, not the
 * boundary."* The second group are coinages earlier drafts introduced and shipped. The founder's
 * rule for what to do when a coinage is the only word that fits is the important half: *"it is a
 * sign the change has not been understood well enough to predict its feel — in which case say
 * what the change does mechanically, or name where in the corner and what the car does there,
 * and stop."*
 */
export const BANNED_FEEL_COINAGES: readonly string[] = [
  "punchy",
  "crisper",
  "takes a set",
  "lined up",
  "skatey",
  "on top of it",
  "nervous-feeling",
  "too immediate",
  // "push" is NOT here: founder 2026-08-27 — push is a real balance word (understeer caused by
  // a lack of rotation from the rear), and it joins the closed list with the other balance words.
  "wandering",
  "wanders",
  "steadier",
  "lazier",
  "lazy",
  "twitchy",
  "darty",
  "snappy",
  "sharper",
  "sharpens",
  "washes",
  "planted-feeling",
];

export const NET_LINE_MAX = 170;
export const NET_STEP_MAX = 140;
export const NET_LABEL_MAX = 40;
export const NET_WORD_MAX = 40;
export const NET_CONTESTED_FIELD_MAX = 200;

/**
 * Hard ceiling on the RENDERED entry. Line caps bound each line; only a whole-entry ceiling stops
 * an entry growing back into the one the model favours by bulk. Two sides now, so roughly double
 * the v4 ceiling: a full two-sided, two-line knob with a long step lands near 900.
 */
export const NET_RENDER_MAX = 1100;

/** Fields from earlier formats that must not come back, each with a pointer to its replacement. */
const RETIRED_FIELDS: Readonly<Record<string, string>> = {
  effects: "the phase grid is gone — a two-answer knob carries `before_settled` + `once_settled` on each side, anything else carries `effect`",
  secondary_effects: "mechanism belongs in the physics KB, not restated here",
  power: "not stored — a throttle split, where a knob has one, goes in the line itself",
  overall: "there is no car-level line — put it in the side's line",
  modifiers: "conditions live in the KB concept files, written once instead of per knob",
  flips: "a flip is a threshold, and conditions are continuous — the good spot slides, it does not switch",
  tag: "no machine vocabulary — the driver's words ARE the index",
  moves: "the slider index restated the physics KB; the KB already says which lever a knob moves",
  feel: "split into `before_settled` + `once_settled` for two-answer knobs, `effect` for the rest",
  typical_step: "renamed to `step`, founder-dictated or null",
  varies_by_car: "dropped — nothing in the app reads a step off a driver's sheet",
  dose_response: "the KB's window says where the good spot is; a per-knob dose curve says it twice",
  physics_link: "renamed to `physics`",
  // v4 → v5
  change: "v5 is one entry per knob: `parameter`, `step` at top level, and the lines under `more:` / `less:`",
  roll_lever: "renamed to `two_answers` — the test was never the mechanism, it is whether the knob answers differently before and once settled",
  direction: "v5 carries both directions in one file, under `more:` and `less:`",
  before_settled: "lines live under `more:` / `less:`, not at the top level",
  once_settled: "lines live under `more:` / `less:`, not at the top level",
  effect: "lines live under `more:` / `less:`, not at the top level",
  confidence: "confidence is per side — put it under `more:` / `less:`",
  contested: "contested is per side — put it under `more:` / `less:`",
};

export type NetSide = {
  /** Founder has passed this side. `false` = AI-drafted; nets:check lists these. */
  reviewed: boolean;
  confidence: (typeof NET_CONFIDENCES)[number];
  before_settled?: string;
  once_settled?: string;
  effect?: string;
  contested?: {
    claim_a: string;
    claim_b: string;
    discriminator: string;
  };
};

export type NetEntry = {
  /** Stable key — the parameter itself. */
  id: string;
  discipline: string;
  /** Canonical setup key — matches the KB **Keys:** vocabulary. */
  parameter: string;
  /** What a driver calls the knob: "Front anti-roll bar". */
  label: string;
  /**
   * What `more` and `less` mean on this knob, in a driver's word — "stiffer"/"softer",
   * "thicker"/"thinner", "more negative"/"less negative", "lower"/"higher". Also where the sheet
   * sign convention gets said once ("more toe-out"). Rendered as the side heading.
   */
  words: { more: string; less: string };
  /** A normal-sized move, in the founder's words, shared by both directions. `null` until dictated. */
  step: string | null;
  /**
   * True when the knob does one thing before the car settles and another once it has: each side
   * carries `before_settled` + `once_settled`. False: each side carries one `effect` line.
   */
  two_answers: boolean;
  /** A missing side renders nothing; the block header says the opposite most likely does the opposite. */
  more?: NetSide | null;
  less?: NetSide | null;
  /** Files in content/vehicle-dynamics/ — the anti-substitution hook. */
  physics: string[];
  sources?: string[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function oneOf<T extends readonly string[]>(v: unknown, allowed: T): v is T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

function capped(v: unknown, max: number): boolean {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}

/** Coinages found in a line. Word-boundary matched so "lazy" does not fire on "lazily". */
export function findBannedCoinages(text: string): string[] {
  const hay = text.toLowerCase();
  return BANNED_FEEL_COINAGES.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(hay);
  });
}

function checkLine(errs: string[], field: string, v: unknown, required: boolean): void {
  if (v == null) {
    if (required) errs.push(`${field}: required — one line, in the driver's words`);
    return;
  }
  if (!capped(v, NET_LINE_MAX)) {
    errs.push(`${field}: must be a non-empty string of at most ${NET_LINE_MAX} chars`);
    return;
  }
  const banned = findBannedCoinages(v as string);
  if (banned.length > 0) {
    errs.push(
      `${field}: "${banned.join('", "')}" ${banned.length === 1 ? "is a coinage" : "are coinages"} — per bite-hold.md, that means the change is not understood well enough to predict its feel. Say what it does mechanically, or name where in the corner and what the car does there, and stop`
    );
  }
}

function validateSide(errs: string[], name: string, raw: unknown, twoAnswers: boolean): void {
  if (!raw || typeof raw !== "object") {
    errs.push(`${name}: must be an object (or null / absent for a side not yet written)`);
    return;
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.reviewed !== "boolean") {
    errs.push(`${name}.reviewed: required boolean — true once the founder has passed this side, false while it is AI-drafted`);
  }
  if (twoAnswers) {
    checkLine(errs, `${name}.before_settled`, s.before_settled, true);
    checkLine(errs, `${name}.once_settled`, s.once_settled, true);
    if (s.effect != null) errs.push(`${name}.effect: a two-answer knob carries before_settled + once_settled, not effect`);
  } else {
    checkLine(errs, `${name}.effect`, s.effect, true);
    if (s.before_settled != null || s.once_settled != null)
      errs.push(`${name}.before_settled/once_settled: only a two-answer knob splits by settle — this knob carries one effect line per side`);
  }
  if (!oneOf(s.confidence, NET_CONFIDENCES))
    errs.push(`${name}.confidence: must be one of ${NET_CONFIDENCES.join("|")}`);
  const contested = s.contested as Record<string, unknown> | undefined;
  if (s.confidence === "contested") {
    if (!contested || typeof contested !== "object") {
      errs.push(`${name}.contested: required when confidence is contested`);
    } else {
      for (const k of ["claim_a", "claim_b", "discriminator"] as const) {
        if (!capped(contested[k], NET_CONTESTED_FIELD_MAX))
          errs.push(`${name}.contested.${k}: required, max ${NET_CONTESTED_FIELD_MAX} chars`);
      }
    }
  } else if (contested != null) {
    errs.push(`${name}.contested: present but confidence is not contested — mark it or drop the block`);
  }
}

/** Validate one parsed YAML document. Returns error strings; empty = valid. */
export function validateNetEntry(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") return ["entry is not an object"];
  const e = raw as Record<string, unknown>;

  for (const [field, hint] of Object.entries(RETIRED_FIELDS)) {
    if (e[field] != null) errs.push(`${field}: retired — ${hint}`);
  }

  if (!isNonEmptyString(e.id)) errs.push("id: required non-empty string");
  if (!isNonEmptyString(e.discipline)) errs.push("discipline: required non-empty string");
  if (!isNonEmptyString(e.parameter)) errs.push("parameter: required non-empty string — the canonical setup key");
  if (e.id !== e.parameter) errs.push("id: must equal parameter — one entry per knob");
  if (!capped(e.label, NET_LABEL_MAX)) errs.push(`label: required, what a driver calls the knob, max ${NET_LABEL_MAX} chars`);

  const words = e.words as Record<string, unknown> | undefined;
  if (!words || typeof words !== "object") {
    errs.push("words: required — { more: <what an increase means>, less: <what a decrease means> } in a driver's word");
  } else {
    for (const side of NET_SIDES) {
      if (!capped(words[side], NET_WORD_MAX)) errs.push(`words.${side}: required, max ${NET_WORD_MAX} chars`);
    }
  }

  if (!("step" in e)) {
    errs.push("step: required — a normal-sized move in the founder's words, or null until he has said it");
  } else if (e.step !== null && !capped(e.step, NET_STEP_MAX)) {
    errs.push(`step: must be null or a string of at most ${NET_STEP_MAX} chars`);
  }

  if (typeof e.two_answers !== "boolean") {
    errs.push("two_answers: required boolean — true if the knob does one thing before the car settles and another once it has");
  }
  const twoAnswers = e.two_answers === true;

  let sides = 0;
  for (const side of NET_SIDES) {
    if (e[side] == null) continue;
    sides++;
    validateSide(errs, side, e[side], twoAnswers);
  }
  if (sides === 0) errs.push("more/less: at least one side must be written");

  if (!Array.isArray(e.physics) || e.physics.length === 0 || e.physics.some((p) => !isNonEmptyString(p))) {
    errs.push("physics: required non-empty array of files in content/vehicle-dynamics/");
  }

  if (e.sources != null) {
    if (!Array.isArray(e.sources) || e.sources.some((s) => !isNonEmptyString(s)))
      errs.push("sources: must be an array of non-empty strings when present");
  }

  if (errs.length === 0) {
    const rendered = renderNetEntry(raw as NetEntry).length;
    if (rendered > NET_RENDER_MAX) {
      errs.push(`entry renders to ${rendered} chars, over the ${NET_RENDER_MAX} ceiling — length is attention the knob has not earned`);
    }
  }

  return errs;
}

/** Sides of an entry that are written but not yet founder-reviewed. */
export function unreviewedSides(entry: NetEntry): string[] {
  return NET_SIDES.filter((s) => entry[s] && entry[s]!.reviewed === false).map((s) => `${entry.parameter}.${s}`);
}

/**
 * Render one net for the model. Byte-stable field order. Sources and the reviewed flag are never
 * rendered — the north star forbids naming sources to drivers, and a draft marker would make the
 * local test read differently from what ships once the founder has passed it.
 */
export function renderNetEntry(entry: NetEntry): string {
  const lines: string[] = [];
  lines.push(
    `${entry.label.toUpperCase()} (${entry.parameter})` + (entry.step ? ` | a normal move: ${entry.step}` : "")
  );
  for (const side of NET_SIDES) {
    const s = entry[side];
    if (!s) continue;
    lines.push(`  ${entry.words[side].toUpperCase()} [${s.confidence}]`);
    if (entry.two_answers) {
      lines.push(`    BEFORE THE CAR SETTLES: ${s.before_settled}`);
      lines.push(`    ONCE SETTLED: ${s.once_settled}`);
    } else {
      lines.push(`    EFFECT: ${s.effect}`);
    }
    if (s.contested) {
      lines.push(`    CONTESTED — claim A: ${s.contested.claim_a}`);
      lines.push(`              claim B: ${s.contested.claim_b}`);
      lines.push(`              what decides it on track: ${s.contested.discriminator}`);
    }
  }
  lines.push(`  WHY: ${entry.physics.join(", ")}`);
  return lines.join("\n");
}
