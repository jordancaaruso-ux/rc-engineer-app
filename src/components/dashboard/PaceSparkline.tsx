/**
 * Pace micro-chart — best lap per point, oldest → newest.
 *
 * **Faster laps plot LOWER, so an improving series slopes down.** That is the opposite of the
 * "up is good" reflex and it is the app's settled convention: the desktop `PaceChart` carries the
 * same mapping and the same reasoning, and a lap chart that rose as times got quicker would read
 * as a different quantity on the same screen.
 *
 *   y = pad + ((max - value) * (h - 2 * pad)) / (max - min)
 *
 * Lived inside `DashboardDayVerdictCard` until 2026-08-20, when the phone dashboard's per-track
 * trends needed the same picture at a different width. One copy, so the two can never drift into
 * disagreeing about which way is faster.
 *
 * The end dot is the only colour: it marks the newest point, and `direction` decides whether that
 * reads as a gain, a loss, or neither. Callers that report rather than grade — the per-track
 * trends — pass "steady" for a slower window on purpose.
 */
export function PaceSparkline({
  values,
  direction,
  width = 72,
  height = 26,
}: {
  /** Best lap per point, oldest → newest. One point draws a single dot. */
  values: number[];
  direction: "faster" | "slower" | "steady";
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;

  const PAD = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const x = (i: number) =>
    values.length === 1 ? width / 2 : PAD + (i * (width - 2 * PAD)) / (values.length - 1);
  const y = (v: number) =>
    range === 0 ? height / 2 : PAD + ((max - v) * (height - 2 * PAD)) / range;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const endColor =
    direction === "faster"
      ? "rgb(var(--color-gain))"
      : direction === "slower"
        ? "rgb(var(--color-destructive))"
        : "rgb(var(--color-faint))";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke="rgb(var(--color-faint))" strokeWidth="1.5" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.6" fill={endColor} />
    </svg>
  );
}
