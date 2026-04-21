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
