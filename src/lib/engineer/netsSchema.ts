/**
 * Nets schema v4 — pure (no fs / no server-only) so the runtime loader and the validator script
 * share one definition. Authoring rules: content/nets/README.md.
 *
 * WHAT A NET IS. One knob, and what it most likely does, in the driver's words — balance,
 * understeer, oversteer, steering. Those words appear NOWHERE in the physics KB, on purpose (its
 * header: "mechanisms, not outcomes"). Outcomes are the one thing a net carries that nothing
 * else does, and they are the ONLY thing it carries. Everything else — why, what makes it bigger
 * or smaller, when the opposite move is right — already lives in content/vehicle-dynamics/, and
 * a net that restates it is a shorter, more scannable copy the model reaches for instead of the
 * physics. Three earlier formats died of exactly that (founder interview 2026-08-26/27; do not
 * rebuild the phase grid, the tags, the slider index, or per-knob flip conditions).
 *
 * TWO SHAPES, DECIDED BY PHYSICS. A knob that changes how much or how fast the car rolls and
 * transfers load — bars, springs, damper oil, ride height, droop — genuinely has two answers:
 * one before the car has settled into the corner, one once it has (concepts/corner-regime.md,
 * concepts/bite-hold.md). Which answer matters today depends on how long the corner lasts against
 * how long this car takes to settle, and the model works that out from the KB's rule plus the
 * facts the request carries. Those knobs carry BOTH lines. A knob that acts through another
 * mechanism — camber, toe, diff, caster — does one thing whatever the corner's clock says, and
 * carries ONE line. The unevenness is the physics talking, which is the only kind allowed.
 *
 * The driver's own words. `bite-hold.md` carries a closed feel vocabulary and names the coinages
 * that are not on it; the founder is extending it with the balance words (steering, rotation,
 * forward traction). The validator enforces the ban list, not an allow list — an allow list is
 * unenforceable on free text.
 */

export const NET_CONFIDENCES = ["consensus", "majority", "contested"] as const;
export const NET_DIRECTIONS = ["increase", "decrease"] as const;

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
  "pushes",
  "pushing",
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
export const NET_CONTESTED_FIELD_MAX = 200;

/**
 * Hard ceiling on the RENDERED entry. Line caps bound each line; only a whole-entry ceiling stops
 * an entry growing back into the one the model favours by bulk.
 */
export const NET_RENDER_MAX = 600;

/** Fields from earlier formats that must not come back, each with a pointer to its replacement. */
const RETIRED_FIELDS: Readonly<Record<string, string>> = {
  effects: "the phase grid is gone — a roll lever carries `before_settled` + `once_settled`, anything else carries `effect`",
  secondary_effects: "mechanism belongs in the physics KB, not restated here",
  power: "not stored — a throttle split, where a knob has one, goes in the line itself",
  overall: "there is no car-level line — put it in the entry's line",
  modifiers: "conditions live in the KB concept files, written once instead of per knob",
  flips: "a flip is a threshold, and conditions are continuous — the good spot slides, it does not switch",
  tag: "no machine vocabulary — the driver's words ARE the index",
  moves: "the slider index restated the physics KB; the KB already says which lever a knob moves",
  feel: "split into `before_settled` + `once_settled` for roll levers, `effect` for the rest",
  typical_step: "renamed to `step`, founder-dictated or null",
  varies_by_car: "dropped — nothing in the app reads a step off a driver's sheet",
  dose_response: "the KB's window says where the good spot is; a per-knob dose curve says it twice",
  physics_link: "renamed to `physics`",
};

export type NetEntry = {
  id: string;
  discipline: string;
  change: {
    parameter: string;
    direction: (typeof NET_DIRECTIONS)[number];
    /** A normal-sized move, in the founder's words. `null` until he has dictated it. */
    step: string | null;
  };
  /**
   * True when the knob changes how much or how fast the car rolls / transfers load. Decides the
   * shape: roll levers carry `before_settled` + `once_settled`; others carry `effect`.
   */
  roll_lever: boolean;
  before_settled?: string;
  once_settled?: string;
  effect?: string;
  confidence: (typeof NET_CONFIDENCES)[number];
  contested?: {
    claim_a: string;
    claim_b: string;
    discriminator: string;
  };
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

  const change = e.change as Record<string, unknown> | undefined;
  if (!change || typeof change !== "object") {
    errs.push("change: required object");
  } else {
    if (!isNonEmptyString(change.parameter)) errs.push("change.parameter: required non-empty string");
    if (!oneOf(change.direction, NET_DIRECTIONS))
      errs.push(`change.direction: must be one of ${NET_DIRECTIONS.join("|")}`);
    if (!("step" in change)) {
      errs.push("change.step: required — a normal-sized move in the founder's words, or null until he has said it");
    } else if (change.step !== null && !capped(change.step, NET_STEP_MAX)) {
      errs.push(`change.step: must be null or a string of at most ${NET_STEP_MAX} chars`);
    }
  }

  if (typeof e.roll_lever !== "boolean") {
    errs.push("roll_lever: required boolean — true if the knob changes how much or how fast the car rolls / transfers load");
  } else if (e.roll_lever) {
    checkLine(errs, "before_settled", e.before_settled, true);
    checkLine(errs, "once_settled", e.once_settled, true);
    if (e.effect != null) errs.push("effect: a roll lever carries before_settled + once_settled, not effect");
  } else {
    checkLine(errs, "effect", e.effect, true);
    if (e.before_settled != null || e.once_settled != null)
      errs.push("before_settled/once_settled: only a roll lever splits by settle — this knob carries one `effect` line");
  }

  if (!oneOf(e.confidence, NET_CONFIDENCES))
    errs.push(`confidence: must be one of ${NET_CONFIDENCES.join("|")}`);

  const contested = e.contested as Record<string, unknown> | undefined;
  if (e.confidence === "contested") {
    if (!contested || typeof contested !== "object") {
      errs.push("contested: required when confidence is contested");
    } else {
      for (const k of ["claim_a", "claim_b", "discriminator"] as const) {
        if (!capped(contested[k], NET_CONTESTED_FIELD_MAX))
          errs.push(`contested.${k}: required, max ${NET_CONTESTED_FIELD_MAX} chars`);
      }
    }
  } else if (contested != null) {
    errs.push("contested: present but confidence is not contested — mark it or drop the block");
  }

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

/**
 * Render one net for the model. Byte-stable field order. Sources are never rendered — the north
 * star forbids naming sources to drivers; they stay in the file as an authoring record.
 */
export function renderNetEntry(entry: NetEntry): string {
  const lines: string[] = [];
  const dirWord = entry.change.direction === "increase" ? "more/stiffer" : "less/softer";
  lines.push(
    `CHANGE: ${entry.change.parameter} ${entry.change.direction} (${dirWord}) [${entry.confidence}]` +
      (entry.change.step ? ` | a normal move: ${entry.change.step}` : "")
  );
  if (entry.roll_lever) {
    lines.push(`  BEFORE THE CAR SETTLES: ${entry.before_settled}`);
    lines.push(`  ONCE SETTLED: ${entry.once_settled}`);
  } else {
    lines.push(`  EFFECT: ${entry.effect}`);
  }
  if (entry.contested) {
    lines.push(`  CONTESTED — claim A: ${entry.contested.claim_a}`);
    lines.push(`            claim B: ${entry.contested.claim_b}`);
    lines.push(`            what decides it on track: ${entry.contested.discriminator}`);
  }
  lines.push(`  WHY: ${entry.physics.join(", ")}`);
  return lines.join("\n");
}
