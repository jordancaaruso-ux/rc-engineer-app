/**
 * Nets schema v3 — pure (no fs / no server-only) so the runtime loader and the validator script
 * share one definition. Authoring rules: content/nets/README.md.
 *
 * THE IDEA. Every knob on the car is a slider. Too far one way is bad, too far the other way is
 * bad, and the good spot moves with the day — grip, corner speed, how rough the surface is. v1 and
 * v2 both wrote that out separately for all sixteen knobs, and both broke the same way: entries
 * grew to fit their conditions, the model leaned on whichever was longest, and half the "feel"
 * lines were the physics KB restated somewhere shorter and more scannable — so a net could stand
 * in for the physics instead of pointing at it.
 *
 * v3 writes each slider down ONCE, in the concept files, and every knob just says which slider it
 * moves and which way. The "it depends" lives in one place instead of sixteen.
 *
 * NO SWITCHES. An earlier draft had per-knob flip conditions ("when grip is high, this reverses").
 * Grip does not flip anything — the good spot slid, so the car is now further along the slider than
 * it wants to be. A threshold in a knob is a bucket wearing a disguise, and it is why `flips`,
 * `modifiers` and the six-box grid are all rejected below.
 *
 * WHAT LIVES WHERE:
 *   content/vehicle-dynamics/*.md            why a change does what it does        (locked)
 *   content/vehicle-dynamics/concepts/*.md   the sliders: each end's feel, and     (locked)
 *                                            what moves the good spot
 *   content/nets/                            which slider, which way, one line     (drafts)
 *
 * Phase, grip level and corner speed are never stored per knob — they fall out of the sliders.
 * `bite-hold.md` already states that phase is which part of the grip build the driver samples.
 */

export const NET_ENDS = ["front", "rear", "car"] as const;
export const NET_CONFIDENCES = ["consensus", "majority", "contested"] as const;
export const NET_DIRECTIONS = ["increase", "decrease"] as const;

/**
 * Which way a knob can push each slider.
 *
 * This table lives in CODE, not in the concept files, on purpose: the concept files are plain
 * prose with no header block and they are locked by kb-guard, so declaring a vocabulary inside
 * each would be twenty founder-gated diffs for what is plumbing. The key is the concept's
 * filename without `.md` — `bite-hold` resolves to `concepts/bite-hold.md`, and the validator
 * checks that it does.
 */
export const SLIDER_VOCAB: Readonly<Record<string, readonly [string, string]>> = {
  "bite-hold": ["bite", "hold"],
  damping: ["slower", "faster"],
  "bump-compliance": ["better", "worse"],
  "camber-grip": ["leaned", "upright"],
  "toe-and-scrub": ["toed", "straight"],
  "differential-coupling": ["coupled", "free"],
  "roll-stiffness": ["stiffer", "softer"],
  "load-transfer": ["more", "less"],
  "roll-center": ["higher", "lower"],
};

/**
 * Words that are not feel words, however natural they sound.
 *
 * `concepts/bite-hold.md` carries the closed list of words that ARE allowed and names some of
 * these itself: *"`punchy`, `crisper`, `takes a set`, `lined up`, `skatey`, `on top of it`,
 * `nervous-feeling`, `too immediate` are examples, not the boundary."* The rest are coinages v1
 * and v2 introduced and shipped.
 *
 * This is a BANNED list rather than an allowed list because an allowed list cannot be enforced on
 * free text — a legitimate sentence contains "the", "on", "track". The founder's rule for what to
 * do when a coinage is the only word that fits is the important half, and it is not a style note:
 * *"it is a sign the change has not been understood well enough to predict its feel — in which
 * case say what the change does mechanically, or name where in the corner and what the car does
 * there, and stop."*
 */
export const BANNED_FEEL_COINAGES: readonly string[] = [
  // named in bite-hold.md
  "punchy",
  "crisper",
  "takes a set",
  "lined up",
  "skatey",
  "on top of it",
  "nervous-feeling",
  "too immediate",
  // introduced by the v1 / v2 drafts and shipped
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
  "loose",
  "planted-feeling",
];

export const NET_FEEL_MAX = 130;
export const NET_STEP_MAX = 140;
export const NET_CONTESTED_FIELD_MAX = 200;
export const NET_MAX_MOVES = 4;

/**
 * Hard ceiling on the RENDERED entry. The field caps bound each line; only a whole-entry ceiling
 * stops an entry growing back into the one the model favours by bulk. v1 rendered up to ~3.5K
 * characters of source per entry and v2 up to 1,374; v3 entries are four or five lines.
 */
export const NET_RENDER_MAX = 700;

/** Fields from v1/v2 that must not come back, each with a pointer to its replacement. */
const RETIRED_FIELDS: Readonly<Record<string, string>> = {
  effects: "the six-box grid is gone — say which slider you move in `moves`, and the phases fall out of the slider",
  secondary_effects: "removed in v2 — mechanism belongs in the physics KB, not restated here",
  power: "the on/off-power axis is not stored — it falls out of the slider",
  overall: "use a `moves` entry with `end: car`, or the single `feel` line",
  modifiers: "conditions live in the slider's concept file now, written once instead of per knob",
  flips: "a flip is a threshold, and conditions are continuous — the good spot slides, it does not switch",
  tag: "replaced by `moves[].slider` + `toward`, which resolve to real files",
  typical_step: "renamed to `step`, and it is founder-dictated or null",
  varies_by_car: "dropped — nothing in the app reads a step off a driver's sheet",
  dose_response: "the slider says where the good spot is; a per-knob dose curve says it twice",
  physics_link: "renamed to `physics`, to keep it distinct from the sliders in `moves`",
};

export type NetMove = {
  /** Concept filename without `.md`; must be a key of SLIDER_VOCAB and resolve on disk. */
  slider: string;
  end: (typeof NET_ENDS)[number];
  /** One of the two words SLIDER_VOCAB declares for this slider. */
  toward: string;
  confidence: (typeof NET_CONFIDENCES)[number];
  /** True when this is a knock-on from moving the other end, not a direct action. */
  relative?: boolean;
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
  moves: NetMove[];
  /** One line, closed vocabulary. What the driver notices. */
  feel: string;
  contested?: {
    claim_a: string;
    claim_b: string;
    discriminator: string;
  };
  /** Parameter-level physics files (not sliders) — the anti-substitution hook. */
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

/** Coinages found in a feel line. Word-boundary matched so "loose" does not fire on "loosely". */
export function findBannedCoinages(text: string): string[] {
  const hay = text.toLowerCase();
  return BANNED_FEEL_COINAGES.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(hay);
  });
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

  let hasContestedMove = false;
  if (!Array.isArray(e.moves) || e.moves.length === 0) {
    errs.push("moves: required non-empty array — which slider this knob moves, and which way");
  } else {
    if (e.moves.length > NET_MAX_MOVES)
      errs.push(`moves: at most ${NET_MAX_MOVES} — a knob that moves more sliders than that is really several knobs`);
    const seen = new Set<string>();
    e.moves.forEach((m, i) => {
      if (!m || typeof m !== "object") {
        errs.push(`moves[${i}]: not an object`);
        return;
      }
      const mm = m as Record<string, unknown>;
      const slider = mm.slider;
      const vocab = typeof slider === "string" ? SLIDER_VOCAB[slider] : undefined;
      if (!isNonEmptyString(slider)) {
        errs.push(`moves[${i}].slider: required — a concept filename without .md`);
      } else if (!vocab) {
        errs.push(
          `moves[${i}].slider: "${slider}" has no direction vocabulary — add it to SLIDER_VOCAB, or the slider does not exist yet`
        );
      }
      if (!oneOf(mm.end, NET_ENDS)) errs.push(`moves[${i}].end: must be one of ${NET_ENDS.join("|")}`);
      if (vocab && !vocab.includes(mm.toward as string))
        errs.push(`moves[${i}].toward: must be one of ${vocab.join("|")} for slider "${String(slider)}"`);
      if (!oneOf(mm.confidence, NET_CONFIDENCES))
        errs.push(`moves[${i}].confidence: must be one of ${NET_CONFIDENCES.join("|")}`);
      if (mm.relative != null && typeof mm.relative !== "boolean")
        errs.push(`moves[${i}].relative: must be a boolean when present`);
      if (mm.confidence === "contested") hasContestedMove = true;
      if (isNonEmptyString(slider) && oneOf(mm.end, NET_ENDS)) {
        const key = `${slider}/${mm.end}`;
        if (seen.has(key)) errs.push(`moves: two entries for ${key} — one knob moves one slider one way at one end`);
        seen.add(key);
      }
    });
  }

  if (!capped(e.feel, NET_FEEL_MAX)) {
    errs.push(`feel: required, max ${NET_FEEL_MAX} chars — one line of what the driver notices`);
  } else {
    const banned = findBannedCoinages(e.feel as string);
    if (banned.length > 0) {
      errs.push(
        `feel: "${banned.join('", "')}" ${banned.length === 1 ? "is a coinage" : "are coinages"} — per bite-hold.md, that means the change is not understood well enough to predict its feel. Say what it does mechanically, or name where in the corner and what the car does there, and stop`
      );
    }
  }

  const contested = e.contested as Record<string, unknown> | undefined;
  if (hasContestedMove) {
    if (!contested || typeof contested !== "object") {
      errs.push("contested: required when any move has confidence: contested");
    } else {
      for (const k of ["claim_a", "claim_b", "discriminator"] as const) {
        if (!capped(contested[k], NET_CONTESTED_FIELD_MAX))
          errs.push(`contested.${k}: required, max ${NET_CONTESTED_FIELD_MAX} chars`);
      }
    }
  } else if (contested != null) {
    errs.push("contested: present but no move has confidence: contested — mark the move or drop the block");
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
      errs.push(
        `entry renders to ${rendered} chars, over the ${NET_RENDER_MAX} ceiling — length is attention the knob has not earned`
      );
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
    `CHANGE: ${entry.change.parameter} ${entry.change.direction} (${dirWord})` +
      (entry.change.step ? ` | a normal move: ${entry.change.step}` : "")
  );
  for (const m of entry.moves) {
    lines.push(
      `  SLIDES: ${m.end} toward ${m.toward} on the ${m.slider} slider (${m.confidence}${m.relative ? ", knock-on" : ""})`
    );
  }
  lines.push(`  FEEL: ${entry.feel}`);
  if (entry.contested) {
    lines.push(`  CONTESTED — claim A: ${entry.contested.claim_a}`);
    lines.push(`            claim B: ${entry.contested.claim_b}`);
    lines.push(`            what decides it on track: ${entry.contested.discriminator}`);
  }
  lines.push(`  MECHANISM: ${entry.physics.join(", ")}`);
  return lines.join("\n");
}
