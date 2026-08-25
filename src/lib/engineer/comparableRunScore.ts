import {
  TRACK_GRIP_TAG_IDS,
  TRACK_LAYOUT_TAG_IDS,
  normalizeGripTags,
  normalizeLayoutTags,
} from "@/lib/trackMetaTags";

/**
 * How close a past run is to the one being discussed, on the three axes the founder
 * named as what makes conditions "the same": tyre, grip level, layout.
 *
 * DELIBERATELY NOT A THRESHOLD. Founder 2026-08-04: *"There's no rule — you can scale
 * confidence with similarity. In identical conditions obviously a lot, if only tire and
 * grip are close then you're a little confident etc."* So this reports a per-axis
 * breakdown for the Engineer to reason from, and the numeric `score` exists only to rank
 * candidates before we hand the top few over. Never surface the score — it is not a
 * confidence figure, and reading it as one is the mistake this whole change replaces.
 *
 * GRIP AND LAYOUT ARE ORDINAL, NOT CATEGORICAL. Both vocabularies are ordered scales
 * (VERY_LOW → VERY_HIGH, VERY_TECHNICAL → VERY_FAST), so LOW-vs-MEDIUM grip is one notch
 * apart while LOW-vs-VERY_HIGH is four. Comparing them as tag sets would collapse both to
 * "different" and throw away the gradient the founder actually asked for. Distance on the
 * scale is the measure; a track carrying two tags sits between them.
 *
 * Distinct from `pickEngineerReferenceRun`, which answers a different question ("what did
 * you change since last session") and stays chronological on purpose.
 */

export type AxisMatch = "same" | "adjacent" | "different" | "unknown";

/**
 * The grip level to judge a run by: what the driver recorded for THAT SESSION if he
 * recorded one, otherwise the venue's general tags.
 *
 * Track.gripTags describes a venue across all conditions, so before per-run grip existed
 * every run at a track scored a perfect grip match against every other run there — two of
 * the three similarity axes silently collapsed into "same track". A run's own level is the
 * honest signal; the track's tags are the fallback for older rows and anyone who skipped it.
 *
 * Returned as an array because a venue can carry several tags and the scale maths already
 * averages them; a single session level is simply an array of one.
 */
export function resolveGripTags(
  runGripLevel: string | null | undefined,
  trackGripTags: readonly string[] | null | undefined
): readonly string[] | null {
  const own = runGripLevel?.trim();
  if (own) return [own];
  return trackGripTags ?? null;
}

export type RunConditions = {
  /** TireType id — the tyre itself, not the set or its wear index. */
  tireTypeId: string | null;
  gripTags: readonly string[] | null;
  layoutTags: readonly string[] | null;
};

export type ComparabilityBreakdown = {
  tyre: AxisMatch;
  grip: AxisMatch;
  layout: AxisMatch;
  /** Ranking only. Not a confidence value and never shown to the driver. */
  score: number;
};

/**
 * One past run offered as a reference, with how near it actually is. Lives in this pure
 * module rather than beside the query so the reasoning-spine types can name it without
 * pulling in a database import.
 */
export type ComparableRun = {
  runId: string;
  whenIso: string;
  trackName: string | null;
  /** The driver's own 1–10 verdict. Null when the run predates the rating or it was skipped. */
  carRating: number | null;
  comparability: ComparabilityBreakdown;
  /** Plain-language closeness, e.g. "same tyre, grip one notch away, same layout style". */
  howClose: string;
};

/**
 * Mean position on the ordered scale, so a track tagged both LOW and MEDIUM sits halfway
 * between them rather than being forced onto one. Null when nothing recognised was tagged.
 */
function scalePosition(raw: readonly string[] | null | undefined, scale: readonly string[]): number | null {
  const known = (raw ?? []).filter((t) => scale.includes(t));
  if (known.length === 0) return null;
  const sum = known.reduce((acc, t) => acc + scale.indexOf(t), 0);
  return sum / known.length;
}

function matchOnScale(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
  scale: readonly string[],
  normalize: (t: unknown) => string[]
): AxisMatch {
  const posA = scalePosition(normalize(a ?? []), scale);
  const posB = scalePosition(normalize(b ?? []), scale);
  if (posA == null || posB == null) return "unknown";
  const distance = Math.abs(posA - posB);
  if (distance === 0) return "same";
  return distance <= 1 ? "adjacent" : "different";
}

function matchTyre(a: string | null, b: string | null): AxisMatch {
  if (!a || !b) return "unknown";
  return a === b ? "same" : "different";
}

/**
 * Weights reflect that all three axes have to line up before a past run says much.
 * Founder: tyre-and-grip alone earns only "a little" confidence, so layout carries real
 * weight rather than acting as a tiebreaker. An unknown axis scores zero — it neither
 * helps nor is punished, because a missing tag is our data gap, not a mismatch.
 */
const AXIS_POINTS: Record<AxisMatch, number> = {
  same: 1,
  adjacent: 0.5,
  different: 0,
  unknown: 0,
};

export function scoreComparability(
  current: RunConditions,
  candidate: RunConditions
): ComparabilityBreakdown {
  const tyre = matchTyre(current.tireTypeId, candidate.tireTypeId);
  const grip = matchOnScale(
    current.gripTags,
    candidate.gripTags,
    TRACK_GRIP_TAG_IDS,
    normalizeGripTags
  );
  const layout = matchOnScale(
    current.layoutTags,
    candidate.layoutTags,
    TRACK_LAYOUT_TAG_IDS,
    normalizeLayoutTags
  );

  const score = AXIS_POINTS[tyre] * 3 + AXIS_POINTS[grip] * 3 + AXIS_POINTS[layout] * 2;

  return { tyre, grip, layout, score };
}

/**
 * The breakdown as a plain sentence for the context JSON. Written the way an engineer
 * would say what he is leaning on, because this is what the model calibrates against —
 * there is no separate confidence field any more.
 */
export function describeComparability(b: ComparabilityBreakdown): string {
  const parts: string[] = [];

  if (b.tyre === "same") parts.push("same tyre");
  else if (b.tyre === "different") parts.push("different tyre");

  if (b.grip === "same") parts.push("same grip level");
  else if (b.grip === "adjacent") parts.push("grip one notch away");
  else if (b.grip === "different") parts.push("well off on grip");

  if (b.layout === "same") parts.push("same layout style");
  else if (b.layout === "adjacent") parts.push("layout one notch away");
  else if (b.layout === "different") parts.push("well off on layout");

  const unknowns = (["tyre", "grip", "layout"] as const).filter((k) => b[k] === "unknown");

  if (parts.length === 0) return "nothing recorded to compare conditions on";

  const known = parts.join(", ");
  if (unknowns.length === 0) return known;
  return `${known}; ${unknowns.join(" and ")} not recorded`;
}
