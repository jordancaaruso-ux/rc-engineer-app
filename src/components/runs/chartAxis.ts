/**
 * Shared x-axis label density for the lap graphs.
 *
 * Both graphs used to hardcode "about 8 labels" (`Math.ceil(n / 8)`) regardless of how wide
 * the chart actually was, and compensated for the crowding by setting the labels at 9px —
 * below every other size in the app. That was the wrong lever: the 2026-08-14 one-voice pass
 * puts axis ticks on the ramp floor (`.fig-tick`, 10px Sora), and a 10px Sora digit is about
 * 1.4x the width of the 8-9px JetBrains Mono digit it replaces.
 *
 * So density is now derived from the space a label really needs. If a label doesn't fit, the
 * answer is fewer labels — never a smaller step. An axis does not need every fourth lap
 * marked; it needs marks you can read.
 */

/** Sora's tabular advance is 676/1000em (measured from the font binary, 2026-08-14). */
const SORA_TABULAR_ADVANCE_EM = 0.676;
/** `.fig-tick` — the ramp floor. */
const TICK_PX = 10;
/** Minimum clear space between two neighbouring labels. */
const MIN_GUTTER_PX = 12;

/**
 * How many laps to skip between x-axis labels.
 *
 * @param count       number of points in the x domain
 * @param chartWidth  measured width of the svg, in CSS px (viewBox is 1:1 with it)
 * @param maxLapLabel largest lap number that will be drawn — decides the label's width
 */
export function xLabelStep(count: number, chartWidth: number, maxLapLabel: number): number {
  if (count <= 1) return 1;
  const PAD_LEFT = 40;
  const PAD_RIGHT = 10;
  const inner = Math.max(1, chartWidth - PAD_LEFT - PAD_RIGHT);
  const digits = Math.max(1, String(Math.max(0, Math.floor(maxLapLabel))).length);
  const slot = digits * TICK_PX * SORA_TABULAR_ADVANCE_EM + MIN_GUTTER_PX;
  const maxLabels = Math.max(2, Math.floor(inner / slot));
  return Math.max(1, Math.ceil(count / maxLabels));
}
