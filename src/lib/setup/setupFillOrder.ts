import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Flattens a setup sheet template into the linear question list the sequential fill flow walks.
 *
 * Ordering is *not* invented here: `buildSetupSheetTemplateFromParsedSchema` already emits
 * `groups[]` in section order with `fields[]` sorted by the schema's `sortOrder`. This just walks
 * that structure and decides which control each field gets, so the fill flow and the grid sheet can
 * never disagree about what a field is.
 */

export type SetupFillStepKind = "number" | "text" | "choice" | "multiChoice" | "boolean";

export type SetupFillStep = {
  key: string;
  label: string;
  unit?: string;
  sectionId: string;
  sectionTitle: string;
  kind: SetupFillStepKind;
  /** Display labels, for choice / multiChoice. */
  options?: string[];
  /** Stored snapshot tokens aligned with `options`, when the schema declares them. */
  optionValues?: string[];
  /** 1-based position within this section, for the "6 of 14" progress line. */
  indexInSection: number;
  sectionSize: number;
};

export function buildSetupFillSteps(template: SetupSheetTemplate): SetupFillStep[] {
  const chipOptions = template.fieldChipOptionsByKey ?? {};
  const steps: SetupFillStep[] = [];
  const seen = new Set<string>();

  for (const group of template.groups) {
    // Collect first so `sectionSize` reflects what actually made it in (duplicates dropped).
    const inSection: SetupFillStep[] = [];
    for (const field of group.fields) {
      if (field.editable === false) continue;
      // A key can appear in more than one layout row (pair/corner4 duplication); ask once.
      if (seen.has(field.key)) continue;
      seen.add(field.key);

      const chips = chipOptions[field.key];
      const options = chips?.options?.filter((o) => o.trim().length > 0);
      const hasChoices = Boolean(options && options.length >= 2);

      let kind: SetupFillStepKind;
      if (hasChoices) {
        kind = chips?.multi ? "multiChoice" : "choice";
      } else if (field.input === "checkbox" || field.valueType === "boolean") {
        kind = "boolean";
      } else if (field.valueType === "number") {
        kind = "number";
      } else {
        kind = "text";
      }

      inSection.push({
        key: field.key,
        label: field.label,
        unit: field.unit,
        sectionId: group.id,
        sectionTitle: group.title,
        kind,
        ...(hasChoices ? { options } : {}),
        ...(hasChoices && chips?.optionValues?.length === options?.length
          ? { optionValues: chips.optionValues }
          : {}),
        indexInSection: 0,
        sectionSize: 0,
      });
    }

    inSection.forEach((step, i) => {
      step.indexInSection = i + 1;
      step.sectionSize = inSection.length;
    });
    steps.push(...inSection);
  }

  return steps;
}

/**
 * A multi-select value as stored tokens, tolerating the legacy comma-joined string form.
 */
export function readSetupFillMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Whether a step counts as filled.
 *
 * Note "0" is answered: the fill flow's boolean control writes "0" for No precisely so a deliberate
 * No is distinguishable from never-asked, and the review screen's "left blank" list depends on that.
 *
 * Lives here rather than in the fill flow component so the server can count a parked draft's
 * progress without importing a client component — and so the two can never disagree.
 */
export function isSetupFillStepAnswered(step: SetupFillStep, value: unknown): boolean {
  if (step.kind === "multiChoice") return readSetupFillMultiValue(value).length > 0;
  if (value == null) return false;
  return String(value).trim() !== "";
}

export function countAnsweredSetupFillSteps(
  steps: SetupFillStep[],
  values: SetupSnapshotData
): number {
  return steps.reduce((n, s) => (isSetupFillStepAnswered(s, values[s.key]) ? n + 1 : n), 0);
}

/** Section boundaries for the jump-to-section control, in fill order. */
export function setupFillSections(
  steps: SetupFillStep[]
): Array<{ id: string; title: string; firstStepIndex: number; size: number }> {
  const out: Array<{ id: string; title: string; firstStepIndex: number; size: number }> = [];
  steps.forEach((step, i) => {
    const last = out[out.length - 1];
    if (last && last.id === step.sectionId) {
      last.size += 1;
      return;
    }
    out.push({ id: step.sectionId, title: step.sectionTitle, firstStepIndex: i, size: 1 });
  });
  return out;
}
