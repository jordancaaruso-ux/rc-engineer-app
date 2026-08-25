/**
 * Nets schema v2 — pure (no fs / no server-only) so both the runtime loader and the
 * validator script share one definition. Authoring rules: content/nets/README.md.
 *
 * v2 (founder interview 2026-08-25) replaces v1's free-shape entry with a FIXED GRID.
 * The problem it solves: v1 entries ranged 1,382 → 3,551 bytes, and the model favours the
 * fattest entry in the block regardless of whether that lever is the right one. Length was
 * carrying weight it had not earned. v2 makes every entry the same size by construction:
 *
 *  - Exactly SIX effect cells: phase (entry|mid|exit) × end (front|rear). All six present,
 *    always. A cell with no reliable effect says `tag: none` — "a stiffer front bar does
 *    nothing reliable on exit" is a real claim, and stating it stops the model inventing one.
 *  - The on-power / off-power axis is FOLDED INTO THE PHASE. In touring, entry is off-power
 *    or braking and exit is on-power; carrying both axes tripled the rows for no extra
 *    information and was a main source of the length spread.
 *  - `secondary_effects` is GONE. It was where entries got fat, and most of what it held was
 *    the physics KB restated — the same claim in two places reads to the model as two
 *    independent sources agreeing, which manufactures confidence. A net links to physics
 *    (`physics_link`); it never repeats it.
 *  - At most ONE car-level `overall` line, at most TWO modifiers, and every free-text field
 *    is length-capped and enforced by `npm run nets:check`. A fat entry cannot be committed.
 *
 * Why the grid keeps its phase rows separate, and must keep them: `concepts/corner-regime.md`
 * states once that how much of a corner is entry-vs-settled moves with speed, grip and corner
 * shape. Because every net answers entry and mid separately, that one law composes across all
 * of them — a faster car means more of the corner is entry, so the ENTRY row is the one that
 * dominates. Collapsing a lever to a single direction would break that, and restating the law
 * in each entry is exactly the duplication v2 exists to remove.
 *
 * `tag` is machine-readable and deliberately NOT rendered to the model: it is the hook for
 * code to later compute "which levers touch mid-corner front grip" deterministically, instead
 * of the model choosing by vibes. Rendering it would only invite the model to parrot the
 * vocabulary and would cost tokens for nothing.
 */

export const NET_PHASES = ["entry", "mid", "exit"] as const;
export const NET_ENDS = ["front", "rear"] as const;
export const NET_CONFIDENCES = ["consensus", "majority", "contested"] as const;
export const NET_DOSE_RESPONSES = ["monotonic", "to_a_point", "threshold"] as const;
export const NET_MODIFIER_ACTIONS = ["amplifies", "attenuates", "reverses"] as const;
export const NET_DIRECTIONS = ["increase", "decrease"] as const;

/**
 * Effect direction, coded. Scoped to the `end` named on the cell: `grip_more` at the front
 * reads as steering, at the rear as security. `grip_earlier`/`grip_later` are timing rather
 * than amount — the corner-regime hook, and the reason a stiffness lever can honestly say
 * "more grip" on entry and "less grip" mid-corner in the same entry.
 */
export const NET_TAGS = [
  "grip_more",
  "grip_less",
  "grip_earlier",
  "grip_later",
  "response_more",
  "response_less",
  "stability_more",
  "stability_less",
  "none",
] as const;

/** Caps. Enforced, not advisory — they are the whole point of v2. */
export const NET_FEEL_MAX = 150;
export const NET_OVERALL_MAX = 170;
export const NET_STEP_MAX = 150;
export const NET_MODIFIER_CONTEXT_MAX = 80;
export const NET_MODIFIER_NOTE_MAX = 200;
export const NET_MAX_MODIFIERS = 2;
export const NET_CONTESTED_FIELD_MAX = 200;

/**
 * Hard ceiling on the RENDERED entry. The per-field caps above bound each line; this bounds the
 * whole thing, so no entry can quietly grow back into the one the model favours by sheer bulk.
 * The v1 spread was 1,382–3,551 bytes of source; v2 renders 563–1,374 chars. 1,500 leaves a
 * little headroom above today's fattest entry and no room for another paragraph.
 */
export const NET_RENDER_MAX = 1500;

/** The six cells, in render order. Author order in the file is irrelevant. */
export const NET_GRID: ReadonlyArray<{
  phase: (typeof NET_PHASES)[number];
  end: (typeof NET_ENDS)[number];
}> = [
  { phase: "entry", end: "front" },
  { phase: "entry", end: "rear" },
  { phase: "mid", end: "front" },
  { phase: "mid", end: "rear" },
  { phase: "exit", end: "front" },
  { phase: "exit", end: "rear" },
];

export type NetEffect = {
  phase: (typeof NET_PHASES)[number];
  end: (typeof NET_ENDS)[number];
  tag: (typeof NET_TAGS)[number];
  /** Required unless `tag: none`. */
  feel?: string;
  /** Required unless `tag: none`. */
  confidence?: (typeof NET_CONFIDENCES)[number];
};

export type NetModifier = {
  context: string;
  action: (typeof NET_MODIFIER_ACTIONS)[number];
  note?: string;
};

export type NetEntry = {
  id: string;
  discipline: string;
  change: {
    parameter: string;
    direction: (typeof NET_DIRECTIONS)[number];
    /**
     * Scale sense, not a prescription: what size of move actually registers, and what size
     * the driver's peers typically make. Measured from real consecutive-run setup deltas
     * where the data supports it (see README) — never paraphrased from a guide.
     */
    typical_step: string;
  };
  /** Exactly the six NET_GRID cells. */
  effects: NetEffect[];
  /** At most one car-level line, for effects that genuinely belong to no single end. */
  overall?: string;
  dose_response: (typeof NET_DOSE_RESPONSES)[number];
  modifiers?: NetModifier[];
  contested?: {
    claim_a: string;
    claim_b: string;
    discriminator: string;
  };
  physics_link: string[];
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

/** Validate one parsed YAML document. Returns error strings; empty = valid. */
export function validateNetEntry(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") return ["entry is not an object"];
  const e = raw as Record<string, unknown>;

  if (!isNonEmptyString(e.id)) errs.push("id: required non-empty string");
  if (!isNonEmptyString(e.discipline)) errs.push("discipline: required non-empty string");

  if (e.secondary_effects != null) {
    errs.push(
      "secondary_effects: removed in nets v2 — put an end-scoped claim in its grid cell, a " +
        "car-level one in `overall`, a context flip in `modifiers`, and mechanism in the physics KB"
    );
  }
  if ((e as Record<string, unknown>).power != null) {
    errs.push("power: removed in nets v2 — the on/off-power axis is folded into `phase`");
  }

  const change = e.change as Record<string, unknown> | undefined;
  if (!change || typeof change !== "object") {
    errs.push("change: required object");
  } else {
    if (!isNonEmptyString(change.parameter)) errs.push("change.parameter: required non-empty string");
    if (!oneOf(change.direction, NET_DIRECTIONS))
      errs.push(`change.direction: must be one of ${NET_DIRECTIONS.join("|")}`);
    if (!capped(change.typical_step, NET_STEP_MAX))
      errs.push(`change.typical_step: required, max ${NET_STEP_MAX} chars`);
  }

  const effects = e.effects;
  let hasContestedEffect = false;
  if (!Array.isArray(effects)) {
    errs.push("effects: required array of exactly the six grid cells");
  } else {
    const seen = new Set<string>();
    effects.forEach((ef, i) => {
      if (!ef || typeof ef !== "object") {
        errs.push(`effects[${i}]: not an object`);
        return;
      }
      const f = ef as Record<string, unknown>;
      const okPhase = oneOf(f.phase, NET_PHASES);
      const okEnd = oneOf(f.end, NET_ENDS);
      if (!okPhase) errs.push(`effects[${i}].phase: must be one of ${NET_PHASES.join("|")}`);
      if (!okEnd) errs.push(`effects[${i}].end: must be one of ${NET_ENDS.join("|")}`);
      if (okPhase && okEnd) {
        const key = `${f.phase}/${f.end}`;
        if (seen.has(key)) errs.push(`effects: duplicate cell ${key}`);
        seen.add(key);
      }
      if (!oneOf(f.tag, NET_TAGS)) {
        errs.push(`effects[${i}].tag: must be one of ${NET_TAGS.join("|")}`);
        return;
      }
      if (f.tag === "none") {
        if (f.feel != null) errs.push(`effects[${i}]: tag none must not carry a feel line`);
        if (f.confidence != null) errs.push(`effects[${i}]: tag none must not carry a confidence`);
        return;
      }
      if (!capped(f.feel, NET_FEEL_MAX))
        errs.push(`effects[${i}].feel: required, max ${NET_FEEL_MAX} chars`);
      if (!oneOf(f.confidence, NET_CONFIDENCES))
        errs.push(`effects[${i}].confidence: must be one of ${NET_CONFIDENCES.join("|")}`);
      if (f.confidence === "contested") hasContestedEffect = true;
    });
    for (const cell of NET_GRID) {
      if (!seen.has(`${cell.phase}/${cell.end}`)) {
        errs.push(
          `effects: missing cell ${cell.phase}/${cell.end} — all six are required; use tag: none when nothing reliable happens there`
        );
      }
    }
  }

  if (e.overall != null && !capped(e.overall, NET_OVERALL_MAX))
    errs.push(`overall: max ${NET_OVERALL_MAX} chars when present`);

  if (!oneOf(e.dose_response, NET_DOSE_RESPONSES))
    errs.push(`dose_response: must be one of ${NET_DOSE_RESPONSES.join("|")}`);

  if (e.modifiers != null) {
    if (!Array.isArray(e.modifiers)) {
      errs.push("modifiers: must be an array when present");
    } else {
      if (e.modifiers.length > NET_MAX_MODIFIERS)
        errs.push(`modifiers: at most ${NET_MAX_MODIFIERS} — keep the two that change the answer`);
      e.modifiers.forEach((m, i) => {
        if (!m || typeof m !== "object") {
          errs.push(`modifiers[${i}]: not an object`);
          return;
        }
        const mm = m as Record<string, unknown>;
        if (!capped(mm.context, NET_MODIFIER_CONTEXT_MAX))
          errs.push(`modifiers[${i}].context: required, max ${NET_MODIFIER_CONTEXT_MAX} chars`);
        if (!oneOf(mm.action, NET_MODIFIER_ACTIONS))
          errs.push(`modifiers[${i}].action: must be one of ${NET_MODIFIER_ACTIONS.join("|")}`);
        if (mm.note != null && !capped(mm.note, NET_MODIFIER_NOTE_MAX))
          errs.push(`modifiers[${i}].note: max ${NET_MODIFIER_NOTE_MAX} chars when present`);
      });
    }
  }

  const contested = e.contested as Record<string, unknown> | undefined;
  if (hasContestedEffect) {
    if (!contested || typeof contested !== "object") {
      errs.push("contested: required when any effect has confidence: contested");
    } else {
      for (const k of ["claim_a", "claim_b", "discriminator"] as const) {
        if (!capped(contested[k], NET_CONTESTED_FIELD_MAX))
          errs.push(`contested.${k}: required, max ${NET_CONTESTED_FIELD_MAX} chars`);
      }
    }
  } else if (contested != null) {
    errs.push("contested: present but no effect has confidence: contested — mark the effect or drop the block");
  }

  if (!Array.isArray(e.physics_link) || e.physics_link.length === 0 || e.physics_link.some((p) => !isNonEmptyString(p))) {
    errs.push("physics_link: required non-empty array of KB file paths");
  }

  if (e.sources != null) {
    if (!Array.isArray(e.sources) || e.sources.some((s) => !isNonEmptyString(s)))
      errs.push("sources: must be an array of non-empty strings when present");
  }

  // Only meaningful once the shape is sound — renderNetEntry assumes a valid entry.
  if (errs.length === 0) {
    const rendered = renderNetEntry(raw as NetEntry).length;
    if (rendered > NET_RENDER_MAX) {
      errs.push(
        `entry renders to ${rendered} chars, over the ${NET_RENDER_MAX} ceiling — cut a modifier or tighten a feel line. Length is attention the lever has not earned`
      );
    }
  }

  return errs;
}

const PHASE_LABEL: Record<(typeof NET_PHASES)[number], string> = {
  entry: "ENTRY",
  mid: "MID  ",
  exit: "EXIT ",
};

const END_LABEL: Record<(typeof NET_ENDS)[number], string> = {
  front: "front",
  rear: "rear ",
};

/**
 * Render one net for the model, in the fixed grid order so the block is byte-stable and every
 * entry occupies the same shape. `tag` is not rendered (see the file header). Sources are not
 * rendered either — the north star forbids naming sources to drivers; they stay in the file.
 */
export function renderNetEntry(entry: NetEntry): string {
  const lines: string[] = [];
  const dirWord = entry.change.direction === "increase" ? "more/stiffer" : "less/softer";
  lines.push(
    `CHANGE: ${entry.change.parameter} ${entry.change.direction} (${dirWord}) | step: ${entry.change.typical_step}`
  );

  const byCell = new Map<string, NetEffect>();
  for (const ef of entry.effects) byCell.set(`${ef.phase}/${ef.end}`, ef);
  for (const cell of NET_GRID) {
    const ef = byCell.get(`${cell.phase}/${cell.end}`);
    const head = `  ${PHASE_LABEL[cell.phase]} ${END_LABEL[cell.end]}`;
    if (!ef || ef.tag === "none") {
      lines.push(`${head}: nothing reliable`);
    } else {
      lines.push(`${head} (${ef.confidence}): ${ef.feel}`);
    }
  }

  if (entry.overall) lines.push(`  OVERALL: ${entry.overall}`);
  lines.push(`  DOSE: ${entry.dose_response}`);
  for (const m of entry.modifiers ?? []) {
    lines.push(`  ${m.action.toUpperCase()} IF ${m.context}${m.note ? ` — ${m.note}` : ""}`);
  }
  if (entry.contested) {
    lines.push(`  CONTESTED — claim A: ${entry.contested.claim_a}`);
    lines.push(`            claim B: ${entry.contested.claim_b}`);
    lines.push(`            what decides it on track: ${entry.contested.discriminator}`);
  }
  lines.push(`  WHY: ${entry.physics_link.join(", ")}`);
  return lines.join("\n");
}
