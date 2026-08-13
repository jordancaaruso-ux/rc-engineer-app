/**
 * Nets schema — pure (no fs / no server-only) so both the runtime loader and the
 * validator script share one definition. Authoring rules: content/nets/README.md.
 */

export const NET_PHASES = ["entry", "mid", "exit", "all"] as const;
export const NET_POWERS = ["on-power", "off-power", "braking", "any"] as const;
export const NET_ENDS = ["front", "rear", "car"] as const;
export const NET_CONFIDENCES = ["consensus", "majority", "contested"] as const;
export const NET_DOSE_RESPONSES = ["monotonic", "to_a_point", "threshold"] as const;
export const NET_MODIFIER_ACTIONS = ["amplifies", "attenuates", "reverses"] as const;
export const NET_DIRECTIONS = ["increase", "decrease"] as const;

export type NetEffect = {
  phase: (typeof NET_PHASES)[number];
  power: (typeof NET_POWERS)[number];
  end: (typeof NET_ENDS)[number];
  feel: string;
  confidence: (typeof NET_CONFIDENCES)[number];
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
    typical_step?: string;
  };
  effects: NetEffect[];
  secondary_effects?: string[];
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

/** Validate one parsed YAML document. Returns error strings; empty = valid. */
export function validateNetEntry(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") return ["entry is not an object"];
  const e = raw as Record<string, unknown>;

  if (!isNonEmptyString(e.id)) errs.push("id: required non-empty string");
  if (!isNonEmptyString(e.discipline)) errs.push("discipline: required non-empty string");

  const change = e.change as Record<string, unknown> | undefined;
  if (!change || typeof change !== "object") {
    errs.push("change: required object");
  } else {
    if (!isNonEmptyString(change.parameter)) errs.push("change.parameter: required non-empty string");
    if (!oneOf(change.direction, NET_DIRECTIONS))
      errs.push(`change.direction: must be one of ${NET_DIRECTIONS.join("|")}`);
    if (change.typical_step != null && !isNonEmptyString(change.typical_step))
      errs.push("change.typical_step: must be a non-empty string when present");
  }

  const effects = e.effects;
  let hasContestedEffect = false;
  if (!Array.isArray(effects) || effects.length === 0) {
    errs.push("effects: required non-empty array");
  } else {
    effects.forEach((ef, i) => {
      if (!ef || typeof ef !== "object") {
        errs.push(`effects[${i}]: not an object`);
        return;
      }
      const f = ef as Record<string, unknown>;
      if (!oneOf(f.phase, NET_PHASES)) errs.push(`effects[${i}].phase: must be one of ${NET_PHASES.join("|")}`);
      if (!oneOf(f.power, NET_POWERS)) errs.push(`effects[${i}].power: must be one of ${NET_POWERS.join("|")}`);
      if (!oneOf(f.end, NET_ENDS)) errs.push(`effects[${i}].end: must be one of ${NET_ENDS.join("|")}`);
      if (!isNonEmptyString(f.feel)) errs.push(`effects[${i}].feel: required non-empty string`);
      if (!oneOf(f.confidence, NET_CONFIDENCES))
        errs.push(`effects[${i}].confidence: must be one of ${NET_CONFIDENCES.join("|")}`);
      if (f.confidence === "contested") hasContestedEffect = true;
    });
  }

  if (e.secondary_effects != null) {
    if (!Array.isArray(e.secondary_effects) || e.secondary_effects.some((s) => !isNonEmptyString(s)))
      errs.push("secondary_effects: must be an array of non-empty strings when present");
  }

  if (!oneOf(e.dose_response, NET_DOSE_RESPONSES))
    errs.push(`dose_response: must be one of ${NET_DOSE_RESPONSES.join("|")}`);

  if (e.modifiers != null) {
    if (!Array.isArray(e.modifiers)) {
      errs.push("modifiers: must be an array when present");
    } else {
      e.modifiers.forEach((m, i) => {
        if (!m || typeof m !== "object") {
          errs.push(`modifiers[${i}]: not an object`);
          return;
        }
        const mm = m as Record<string, unknown>;
        if (!isNonEmptyString(mm.context)) errs.push(`modifiers[${i}].context: required non-empty string`);
        if (!oneOf(mm.action, NET_MODIFIER_ACTIONS))
          errs.push(`modifiers[${i}].action: must be one of ${NET_MODIFIER_ACTIONS.join("|")}`);
      });
    }
  }

  const contested = e.contested as Record<string, unknown> | undefined;
  if (hasContestedEffect) {
    if (!contested || typeof contested !== "object") {
      errs.push("contested: required when any effect has confidence: contested");
    } else {
      for (const k of ["claim_a", "claim_b", "discriminator"] as const) {
        if (!isNonEmptyString(contested[k])) errs.push(`contested.${k}: required non-empty string`);
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

  return errs;
}

/**
 * Render one net for the model, in a fixed field order so the block is byte-stable.
 * Structured-for-recall, prose-for-mechanism: the KB carries the why; this carries the what.
 */
export function renderNetEntry(entry: NetEntry): string {
  const lines: string[] = [];
  const dirWord = entry.change.direction === "increase" ? "more/stiffer" : "less/softer";
  lines.push(
    `CHANGE: ${entry.change.parameter} ${entry.change.direction} (${dirWord})` +
      (entry.change.typical_step ? ` | typical step: ${entry.change.typical_step}` : "")
  );
  for (const ef of entry.effects) {
    lines.push(
      `  EFFECT [${ef.phase} / ${ef.power} / ${ef.end}] (${ef.confidence}): ${ef.feel}`
    );
  }
  for (const s of entry.secondary_effects ?? []) {
    lines.push(`  ALSO: ${s}`);
  }
  lines.push(`  DOSE: ${entry.dose_response}`);
  for (const m of entry.modifiers ?? []) {
    lines.push(`  ${m.action.toUpperCase()} IF: ${m.context}${m.note ? ` — ${m.note}` : ""}`);
  }
  if (entry.contested) {
    lines.push(`  CONTESTED — claim A: ${entry.contested.claim_a}`);
    lines.push(`            claim B: ${entry.contested.claim_b}`);
    lines.push(`            what decides it on track: ${entry.contested.discriminator}`);
  }
  return lines.join("\n");
}
