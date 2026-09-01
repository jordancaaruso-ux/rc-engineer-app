import type {
  PdfFormFieldMappingRule,
  PdfFormOptionFieldRef,
} from "@/lib/setupCalibrations/types";
import type {
  PdfFormFieldEntry,
  PdfFormFieldsExtraction,
} from "@/lib/setupDocuments/pdfFormFields";

/**
 * Carry a calibrated sheet's meaning onto a rebuilt EDITION of the same paper, by geometry.
 *
 * ============================== THE PROBLEM ==============================
 *
 * An edition is the same printed sheet re-published with every AcroForm box renamed (`Text12`
 * became `Front Camber` — see `createSheetEditionForModel`). The primary calibration's rules
 * name boxes that no longer exist, so an edition minted its own vocabulary and the Engineer,
 * the aggregations and the geometry strip could not read a word of it.
 *
 * What DID survive the rename is the geometry: the boxes sit where they always sat, because the
 * paper is the same paper. So the box a rule means is findable without a human: take the widget
 * the rule points at on the primary file, find the widget printed at the same place on the
 * edition file, and rewrite the rule to that widget's name. The left-hand side — the canonical
 * key a human once chose — never changes; only the PDF-side address does.
 *
 * ============================== WHAT THE PAIRING TOLERATES ==============================
 *
 * Rebuilders nudge things. On the file this was built for (the A800RR edition, 2026-08-16) the
 * electronics block moved up to ~13pt. Tick-box grids, though, sit ~10pt apart, so one distance
 * threshold cannot both absorb the nudge and stay out of the neighbouring tick box. Two passes:
 *
 *   1. near-exact (≤ {@link EXACT_TOLERANCE_PT}), globally greedy by distance — lands everything
 *      that did not move, including every dense grid;
 *   2. nearest-remaining (≤ {@link LOOSE_TOLERANCE_PT}), same page and widget type, accepted only
 *      while clearly unambiguous (runner-up at least {@link AMBIGUITY_MARGIN_PT} further away) —
 *      and measured AFTER subtracting the local drift, the median displacement of the nearest
 *      already-matched pairs. A block that moved together (the A800RR's electronics rows moved
 *      ~7pt as one) puts every box midway between two rows of the other file; raw distance is
 *      genuinely ambiguous there, while drift-relative distance is near zero for the right box.
 *
 * A rule whose widgets cannot all be re-addressed is DROPPED AND REPORTED, never half-written:
 * a half-transferred choice row would read some of its ticks and silently lose the rest.
 *
 * Pure: extractions and mappings in, mappings and a report out. The caller owns storage.
 */

export const EXACT_TOLERANCE_PT = 3;
export const LOOSE_TOLERANCE_PT = 25;
export const AMBIGUITY_MARGIN_PT = 5;

export type WidgetLoc = {
  fieldName: string;
  /** Widget's index within its field — the `widgetInstanceIndex` mapping rules use. */
  instanceIndex: number;
  fieldType: string;
  pageNumber: number;
  cx: number;
  cy: number;
};

export type PairedWidget = { loc: WidgetLoc; distance: number };

export type WidgetPairing = {
  /** `${primaryFieldName}#${instanceIndex}` → edition widget. */
  byPrimaryRef: Map<string, PairedWidget>;
  unmatchedPrimary: WidgetLoc[];
  unmatchedEdition: WidgetLoc[];
};

export type DroppedRule = { key: string; reason: string };

export type TransferResult = {
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  derivedMappings: Record<string, PdfFormFieldMappingRule>;
  extraSimpleKeys: Record<string, string>;
  dropped: DroppedRule[];
  /**
   * Keys whose rule leaned on a loose (pass-2) pairing — the box moved more than
   * {@link EXACT_TOLERANCE_PT}. Correct whenever only the box moved; NOT provable by geometry when
   * the row gained or lost a printed option next to it. Check these against the page pictures.
   */
  looselyPairedKeys: Array<{ key: string; maxDistancePt: number }>;
  /** Edition widgets no primary widget claimed — boxes the rebuilt sheet added. */
  unmatchedEditionWidgets: WidgetLoc[];
  /** Primary widgets with no edition counterpart — boxes the rebuild removed. */
  unmatchedPrimaryWidgets: WidgetLoc[];
};

export function refKey(w: Pick<WidgetLoc, "fieldName" | "instanceIndex">): string {
  return `${w.fieldName}#${w.instanceIndex}`;
}

function widgetLocs(extraction: PdfFormFieldsExtraction): WidgetLoc[] {
  const out: WidgetLoc[] = [];
  for (const field of extraction.fields) {
    for (const w of field.widgets) {
      out.push({
        fieldName: field.name,
        instanceIndex: w.instanceIndex,
        fieldType: field.type,
        pageNumber: w.pageNumber,
        cx: w.x + w.width / 2,
        cy: w.y + w.height / 2,
      });
    }
  }
  return out;
}

function distance(a: WidgetLoc, b: WidgetLoc): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function compatible(a: WidgetLoc, b: WidgetLoc): boolean {
  return a.pageNumber === b.pageNumber && a.fieldType === b.fieldType;
}

/** How many nearby matched pairs vote on the local drift, and how far away they may sit. */
const DRIFT_NEIGHBOURS = 8;
const DRIFT_NEIGHBOUR_RADIUS_PT = 200;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The displacement the sheet around `p` has undergone: median move of the nearest already-matched
 * pairs on the same page. Zero with nothing matched nearby — raw distance then decides alone.
 */
function localDrift(
  p: WidgetLoc,
  matched: Array<{ from: WidgetLoc; dx: number; dy: number }>
): { dx: number; dy: number } {
  const near = matched
    .filter((m) => m.from.pageNumber === p.pageNumber)
    .map((m) => ({ ...m, d: distance(m.from, p) }))
    .filter((m) => m.d <= DRIFT_NEIGHBOUR_RADIUS_PT)
    .sort((a, b) => a.d - b.d)
    .slice(0, DRIFT_NEIGHBOURS);
  if (near.length < 3) return { dx: 0, dy: 0 };
  return { dx: median(near.map((m) => m.dx)), dy: median(near.map((m) => m.dy)) };
}

/** Globally greedy by distance: the closest still-unclaimed pair wins, then the next. */
function greedyMatch(
  primaries: WidgetLoc[],
  editions: WidgetLoc[],
  maxDistance: number,
  claimedPrimary: Set<string>,
  claimedEdition: Set<string>,
  byPrimaryRef: Map<string, PairedWidget>,
  requireMargin: boolean
): void {
  type Candidate = { p: WidgetLoc; e: WidgetLoc; d: number };

  const matched: Array<{ from: WidgetLoc; dx: number; dy: number }> = [];
  if (requireMargin) {
    for (const p of primaries) {
      const pair = byPrimaryRef.get(refKey(p));
      if (pair) matched.push({ from: p, dx: pair.loc.cx - p.cx, dy: pair.loc.cy - p.cy });
    }
  }

  const candidates: Candidate[] = [];
  for (const p of primaries) {
    if (claimedPrimary.has(refKey(p))) continue;
    const drift = requireMargin ? localDrift(p, matched) : { dx: 0, dy: 0 };
    const virtual: WidgetLoc = { ...p, cx: p.cx + drift.dx, cy: p.cy + drift.dy };
    let nearest: Candidate | null = null;
    let runnerUpD = Infinity;
    for (const e of editions) {
      if (claimedEdition.has(refKey(e))) continue;
      if (!compatible(p, e)) continue;
      const d = distance(virtual, e);
      if (d > maxDistance) continue;
      if (!nearest || d < nearest.d) {
        runnerUpD = nearest ? nearest.d : runnerUpD;
        nearest = { p, e, d };
      } else if (d < runnerUpD) {
        runnerUpD = d;
      }
    }
    if (!nearest) continue;
    if (requireMargin && runnerUpD - nearest.d < AMBIGUITY_MARGIN_PT) continue;
    candidates.push(nearest);
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    if (claimedPrimary.has(refKey(c.p)) || claimedEdition.has(refKey(c.e))) continue;
    claimedPrimary.add(refKey(c.p));
    claimedEdition.add(refKey(c.e));
    // Report the RAW move, not the drift-relative one — the report reads as "how far it moved".
    byPrimaryRef.set(refKey(c.p), { loc: c.e, distance: distance(c.p, c.e) });
  }
}

export function pairWidgetsByGeometry(
  primary: PdfFormFieldsExtraction,
  edition: PdfFormFieldsExtraction,
  /**
   * `"OldName#idx" → "NewName#idx"` pairs a human has settled by reading the printed page —
   * claimed before any geometry runs. The one authority geometry must yield to: when a row gained
   * or lost a printed option, every box's nearest neighbour is the WRONG box (the A800RR chassis
   * row gained C01B-RSL and shifted the whole row), and only the page picture can say so.
   */
  manualPairs?: Record<string, string>
): WidgetPairing {
  const primaries = widgetLocs(primary);
  const editions = widgetLocs(edition);
  const claimedPrimary = new Set<string>();
  const claimedEdition = new Set<string>();
  const byPrimaryRef = new Map<string, PairedWidget>();

  const primariesByRef = new Map(primaries.map((p) => [refKey(p), p] as const));
  const editionsByRef = new Map(editions.map((e) => [refKey(e), e] as const));
  for (const [from, to] of Object.entries(manualPairs ?? {})) {
    const p = primariesByRef.get(from);
    const e = editionsByRef.get(to);
    if (!p) throw new Error(`manual pair names unknown primary widget ${from}`);
    if (!e) throw new Error(`manual pair names unknown edition widget ${to}`);
    if (claimedPrimary.has(from) || claimedEdition.has(to)) {
      throw new Error(`manual pair ${from} → ${to} collides with another manual pair`);
    }
    claimedPrimary.add(from);
    claimedEdition.add(to);
    // Distance 0: a human read the page, so the key must not surface as "verify against the page".
    byPrimaryRef.set(from, { loc: e, distance: 0 });
  }

  greedyMatch(primaries, editions, EXACT_TOLERANCE_PT, claimedPrimary, claimedEdition, byPrimaryRef, false);
  greedyMatch(primaries, editions, LOOSE_TOLERANCE_PT, claimedPrimary, claimedEdition, byPrimaryRef, true);

  return {
    byPrimaryRef,
    unmatchedPrimary: primaries.filter((p) => !claimedPrimary.has(refKey(p))),
    unmatchedEdition: editions.filter((e) => !claimedEdition.has(refKey(e))),
  };
}

type OptionsByValue = Record<string, PdfFormOptionFieldRef>;

/** Every (pdfFieldName, widgetInstanceIndex) pair a rule reads, in a uniform shape. */
function ruleRefs(rule: PdfFormFieldMappingRule): Array<{ ref: PdfFormOptionFieldRef; optionValue?: string }> {
  if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
    return Object.entries(rule.options).map(([optionValue, r]) => ({
      ref: { pdfFieldName: rule.pdfFieldName, widgetInstanceIndex: r.widgetInstanceIndex },
      optionValue,
    }));
  }
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    return Object.entries(rule.options).map(([optionValue, r]) => ({ ref: r, optionValue }));
  }
  const simple = rule as { pdfFieldName?: string; widgetInstanceIndex?: number };
  if (!simple.pdfFieldName?.trim()) return [];
  return [{ ref: { pdfFieldName: simple.pdfFieldName, widgetInstanceIndex: simple.widgetInstanceIndex } }];
}

function transferRule(
  key: string,
  rule: PdfFormFieldMappingRule,
  pairing: WidgetPairing,
  primaryFieldsByName: Map<string, PdfFormFieldEntry>,
  dropped: DroppedRule[],
  noteDistance: (key: string, distance: number) => void
): PdfFormFieldMappingRule | null {
  const isGrouped =
    "mode" in rule &&
    (rule.mode === "singleChoiceWidgetGroup" ||
      rule.mode === "multiSelectWidgetGroup" ||
      rule.mode === "singleChoiceNamedFields" ||
      rule.mode === "multiSelectNamedFields");

  if (isGrouped) {
    const single = rule.mode === "singleChoiceWidgetGroup" || rule.mode === "singleChoiceNamedFields";
    const nextOptions: OptionsByValue = {};
    for (const { ref, optionValue } of ruleRefs(rule)) {
      const target = pairing.byPrimaryRef.get(`${ref.pdfFieldName}#${ref.widgetInstanceIndex ?? 0}`);
      if (!target) {
        dropped.push({
          key,
          reason: `option “${optionValue}” reads ${ref.pdfFieldName}#${ref.widgetInstanceIndex ?? 0}, which has no counterpart on the edition`,
        });
        return null;
      }
      noteDistance(key, target.distance);
      nextOptions[optionValue!] = {
        pdfFieldName: target.loc.fieldName,
        widgetInstanceIndex: target.loc.instanceIndex,
      };
    }
    const names = new Set(Object.values(nextOptions).map((o) => o.pdfFieldName));
    if (names.size === 1) {
      const pdfFieldName = [...names][0]!;
      return {
        mode: single ? "singleChoiceWidgetGroup" : "multiSelectWidgetGroup",
        pdfFieldName,
        options: Object.fromEntries(
          Object.entries(nextOptions).map(([v, r]) => [v, { widgetInstanceIndex: r.widgetInstanceIndex ?? 0 }])
        ),
      };
    }
    return {
      mode: single ? "singleChoiceNamedFields" : "multiSelectNamedFields",
      options: nextOptions,
    };
  }

  const simple = rule as { pdfFieldName?: string; widgetInstanceIndex?: number };
  const name = simple.pdfFieldName?.trim();
  if (!name) return null;
  const entry = primaryFieldsByName.get(name);
  if (!entry) {
    dropped.push({ key, reason: `rule names ${name}, which the primary file itself does not have` });
    return null;
  }

  if (simple.widgetInstanceIndex !== undefined) {
    const target = pairing.byPrimaryRef.get(`${name}#${simple.widgetInstanceIndex}`);
    if (!target) {
      dropped.push({ key, reason: `${name}#${simple.widgetInstanceIndex} has no counterpart on the edition` });
      return null;
    }
    noteDistance(key, target.distance);
    return { pdfFieldName: target.loc.fieldName, widgetInstanceIndex: target.loc.instanceIndex };
  }

  /*
   * No index means "the whole field": one widget is one box, and a multi-widget field is read by
   * inference over ALL its widgets (`inferSingleChoiceFromSimpleMultiWidget` and friends). That
   * inference only works if the edition also keeps those widgets under ONE name, so a whole-field
   * rule transfers only when every widget lands on the same edition field.
   */
  const targets = entry.widgets.map((w) => pairing.byPrimaryRef.get(`${name}#${w.instanceIndex}`));
  if (targets.some((t) => !t)) {
    dropped.push({ key, reason: `${name}: not every widget has a counterpart on the edition` });
    return null;
  }
  const targetNames = new Set(targets.map((t) => t!.loc.fieldName));
  if (targetNames.size !== 1) {
    dropped.push({
      key,
      reason: `${name}: widgets scatter across edition fields ${[...targetNames].join(", ")} — a whole-field read cannot follow`,
    });
    return null;
  }
  for (const t of targets) noteDistance(key, t!.distance);
  const targetName = [...targetNames][0]!;
  if (entry.widgets.length === 1) {
    // A one-widget field can land on a multi-widget edition field; address its widget explicitly.
    return { pdfFieldName: targetName, widgetInstanceIndex: targets[0]!.loc.instanceIndex };
  }
  return { pdfFieldName: targetName };
}

export function transferMappingsByGeometry(input: {
  primary: PdfFormFieldsExtraction;
  edition: PdfFormFieldsExtraction;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  derivedMappings?: Record<string, PdfFormFieldMappingRule>;
  extraSimpleKeys?: Record<string, string>;
  /** See {@link pairWidgetsByGeometry} — page-picture-settled pairs that outrank geometry. */
  manualPairs?: Record<string, string>;
}): TransferResult {
  const pairing = pairWidgetsByGeometry(input.primary, input.edition, input.manualPairs);
  const primaryFieldsByName = new Map(input.primary.fields.map((f) => [f.name, f] as const));
  const dropped: DroppedRule[] = [];
  const maxDistanceByKey = new Map<string, number>();
  const noteDistance = (key: string, distance: number) => {
    maxDistanceByKey.set(key, Math.max(maxDistanceByKey.get(key) ?? 0, distance));
  };

  const transferAll = (mappings: Record<string, PdfFormFieldMappingRule>) => {
    const out: Record<string, PdfFormFieldMappingRule> = {};
    for (const [key, rule] of Object.entries(mappings)) {
      const next = transferRule(key, rule, pairing, primaryFieldsByName, dropped, noteDistance);
      if (next) out[key] = next;
    }
    return out;
  };

  const formFieldMappings = transferAll(input.formFieldMappings);
  const derivedMappings = transferAll(input.derivedMappings ?? {});

  const extraSimpleKeys: Record<string, string> = {};
  for (const [key, pdfFieldName] of Object.entries(input.extraSimpleKeys ?? {})) {
    const entry = primaryFieldsByName.get(pdfFieldName);
    const target = entry ? pairing.byPrimaryRef.get(`${pdfFieldName}#${entry.widgets[0]?.instanceIndex ?? 0}`) : null;
    if (!target) {
      dropped.push({ key, reason: `extra key box ${pdfFieldName} has no counterpart on the edition` });
      continue;
    }
    noteDistance(key, target.distance);
    extraSimpleKeys[key] = target.loc.fieldName;
  }

  return {
    formFieldMappings,
    derivedMappings,
    extraSimpleKeys,
    dropped,
    looselyPairedKeys: [...maxDistanceByKey.entries()]
      .filter(([, d]) => d > EXACT_TOLERANCE_PT)
      .map(([key, d]) => ({ key, maxDistancePt: Math.round(d * 10) / 10 }))
      .sort((a, b) => b.maxDistancePt - a.maxDistancePt),
    unmatchedEditionWidgets: pairing.unmatchedEdition,
    unmatchedPrimaryWidgets: pairing.unmatchedPrimary,
  };
}
