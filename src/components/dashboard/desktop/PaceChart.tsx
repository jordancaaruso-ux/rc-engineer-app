import { formatLap } from "@/lib/runLaps";

const W = 620;
const H = 168;
const PAD = 12;

/**
 * The hero's pace series — best lap per run today, or per session over the last eight.
 *
 * **Faster laps plot LOWER, so an improving series slopes down.** That is the opposite of
 * the usual "up is good" reflex and it is deliberate: it matches the `Sparkline` already
 * on the day-verdict card, and a lap chart that rose as times got quicker would read as a
 * different quantity on the same screen. The mapping is the same one that component uses:
 *
 *   y = pad + ((max - value) * (h - 2 * pad)) / (max - min)
 *
 * `preserveAspectRatio="none"` lets the 620-unit viewBox stretch to whatever the flex
 * column gives it while the stroke stays visually even, because the vertical scale is
 * fixed at 168px.
 *
 * The draw-on entrance uses the app's existing `.rc-draw` class (`pathLength="1"` +
 * dashoffset), which is already gated on `prefers-reduced-motion` in globals.css — so
 * reduced motion gets the line already drawn rather than a special case here.
 */
export function PaceChart({
  series,
  deltaSeconds,
}: {
  series: Array<{ runId: string; label: string; best: number }>;
  deltaSeconds: number | null;
}) {
  if (series.length < 2) {
    return (
      <div className="flex h-[168px] items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-faint">
        {series.length === 1 ? "One run so far — the trend starts next time out" : "No timed runs yet"}
      </div>
    );
  }

  const values = series.map((p) => p.best);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (series.length - 1);
  // Flat series would divide by zero; park it on the centre line instead.
  const y = (v: number) => (range === 0 ? H / 2 : PAD + ((max - v) * (H - 2 * PAD)) / range);

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.best).toFixed(1)}`).join(" ");
  const lastX = x(series.length - 1);
  const lastY = y(values[values.length - 1]);
  const endColor =
    deltaSeconds == null ? "#64625E" : deltaSeconds < 0 ? "#4FD089" : "#E5644E";

  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[168px] w-full overflow-visible"
        role="img"
        aria-label={`Pace across ${series.length} runs, from ${formatLap(first.best)} to ${formatLap(last.best)}. Lower is faster.`}
      >
        <line x1="0" y1="12" x2={W} y2="12" stroke="rgb(var(--color-border))" strokeWidth="1" strokeDasharray="2 5" />
        <line x1="0" y1="84" x2={W} y2="84" stroke="rgb(var(--color-border))" strokeWidth="1" strokeDasharray="2 5" />
        <line x1="0" y1="156" x2={W} y2="156" stroke="rgb(var(--color-border))" strokeWidth="1" />

        <polyline
          className="rc-draw"
          pathLength="1"
          points={points}
          fill="none"
          stroke="#64625E"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {series.slice(0, -1).map((p, i) => (
          <circle key={p.runId} cx={x(i)} cy={y(p.best)} r="3" fill="#64625E" />
        ))}
        <circle cx={lastX} cy={lastY} r="6" fill={endColor} />
      </svg>

      <div className="mt-1 flex items-baseline justify-between gap-3 font-mono text-[10px] text-faint">
        <span className="truncate">
          {first.label} {formatLap(first.best)}
        </span>
        <span className="truncate">
          {formatLap(last.best)} {last.label}
        </span>
      </div>
    </div>
  );
}
