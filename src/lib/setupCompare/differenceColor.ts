/** Minimum alpha when a difference exists so very small intensities stay visible. */
const MIN_VISIBLE_ALPHA = 0.08;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Unified setup-comparison difference tint: red only, strength from normalized intensity.
 * intensity 0 → fully transparent; otherwise alpha is clamped to [MIN_VISIBLE_ALPHA, 1].
 */
export function getDifferenceColor(intensity: number): string {
  const t = clamp01(intensity);
  if (t <= 0) return "rgba(255, 0, 0, 0)";
  const alpha = Math.min(1, Math.max(MIN_VISIBLE_ALPHA, t));
  return `rgba(255, 0, 0, ${alpha})`;
}

/** Setup A vs B side-by-side: tint value column blue (A) or red (B). Same alpha curve as red. */
export function getDifferenceColorForRole(
  intensity: number,
  role: "a" | "b"
): string {
  const t = clamp01(intensity);
  if (t <= 0) return "rgba(0, 0, 0, 0)";
  const alpha = Math.min(1, Math.max(MIN_VISIBLE_ALPHA, t));
  if (role === "b") {
    return `rgba(255, 0, 0, ${alpha})`;
  }
  // primary / Setup A — sky-500 family
  return `rgba(14, 165, 233, ${alpha})`;
}
