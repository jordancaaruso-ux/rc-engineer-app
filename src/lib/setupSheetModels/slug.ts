/** User-facing name → stable slug for SetupSheetModel.slug */
export function slugifySetupSheetModelName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!s) return "sheet_model";
  if (/^[a-z]/.test(s)) return s;
  return `m_${s}`;
}

export function uniqueSlugCandidate(base: string, existing: Set<string>): string {
  let slug = base;
  let n = 0;
  while (existing.has(slug)) {
    n += 1;
    slug = `${base}_${n}`;
  }
  return slug;
}
