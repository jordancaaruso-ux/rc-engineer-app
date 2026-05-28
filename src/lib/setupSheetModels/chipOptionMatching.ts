/** Normalize option tokens for label/value comparison (chips + snapshot). */
export function normalizeChipOptionToken(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

export function chipOptionValuesAligned(
  labels: readonly string[],
  optionValues?: readonly string[] | null
): readonly string[] | undefined {
  if (!optionValues || optionValues.length !== labels.length) return undefined;
  return optionValues;
}

/**
 * Which chip label is selected for a stored snapshot value.
 * Matches stored `optionValues` first, then display labels (legacy / hand-entered).
 */
export function selectedChipLabelForStoredValue(
  rawValue: string,
  labels: readonly string[],
  optionValues?: readonly string[] | null,
  mapFreeTextToOtherChip = true
): string | null {
  const raw = typeof rawValue === "string" ? rawValue : "";
  const isBool =
    labels.length === 2
    && labels.some((o) => normalizeChipOptionToken(o) === "yes")
    && labels.some((o) => normalizeChipOptionToken(o) === "no");
  if (isBool) {
    const yes = raw === "1" || normalizeChipOptionToken(raw) === "yes" || normalizeChipOptionToken(raw) === "true";
    return yes ? labels.find((o) => normalizeChipOptionToken(o) === "yes") ?? "yes" : labels.find((o) => normalizeChipOptionToken(o) === "no") ?? "no";
  }

  const v = normalizeChipOptionToken(raw);
  if (!v) return null;

  const values = chipOptionValuesAligned(labels, optionValues);
  if (values) {
    for (let i = 0; i < labels.length; i++) {
      if (normalizeChipOptionToken(values[i]!) === v) return labels[i]!;
      if (normalizeChipOptionToken(labels[i]!) === v) return labels[i]!;
    }
  } else {
    for (const opt of labels) {
      if (normalizeChipOptionToken(opt) === v) return opt;
    }
  }

  if (!mapFreeTextToOtherChip) return null;
  const otherOpt = labels.find((o) => normalizeChipOptionToken(o) === "other");
  if (otherOpt && v) return otherOpt;
  return null;
}

export function selectedChipLabelsForStoredMulti(
  rawValue: string,
  labels: readonly string[],
  optionValues?: readonly string[] | null
): Set<string> {
  const tokens = rawValue
    .split(/[,;/+|]|\s+/)
    .map((s) => normalizeChipOptionToken(s))
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const out = new Set<string>();
  const values = chipOptionValuesAligned(labels, optionValues);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    const stored = values ? values[i]! : label;
    if (tokenSet.has(normalizeChipOptionToken(stored)) || tokenSet.has(normalizeChipOptionToken(label))) {
      out.add(label);
    }
  }
  return out;
}

/** Snapshot token written when the user picks a chip (label → stored value). */
export function storedValueForChipLabel(
  label: string,
  labels: readonly string[],
  optionValues?: readonly string[] | null
): string {
  const isBool =
    labels.length === 2
    && labels.some((o) => normalizeChipOptionToken(o) === "yes")
    && labels.some((o) => normalizeChipOptionToken(o) === "no");
  if (isBool) return normalizeChipOptionToken(label) === "yes" ? "1" : "";

  const values = chipOptionValuesAligned(labels, optionValues);
  if (!values) return label;
  const idx = labels.findIndex((l) => normalizeChipOptionToken(l) === normalizeChipOptionToken(label));
  return idx >= 0 ? values[idx]! : label;
}

/** Human-readable label for a stored grouped value (import / compare text). */
export function displayLabelForStoredChipValue(
  rawValue: string,
  labels: readonly string[],
  optionValues?: readonly string[] | null
): string {
  const raw = typeof rawValue === "string" ? rawValue : "";
  if (!raw.trim()) return "";
  const selected = selectedChipLabelForStoredValue(raw, labels, optionValues, false);
  if (selected) return selected;
  const multi = selectedChipLabelsForStoredMulti(raw, labels, optionValues);
  if (multi.size > 0) return labels.filter((l) => multi.has(l)).join(", ");
  return raw.trim();
}
