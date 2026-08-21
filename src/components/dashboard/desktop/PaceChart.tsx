import { formatLap } from "@/lib/runLaps";

const W = 620;
const H = 168;
const PAD = 12;

/**
 * The hero's pace series — best lap per run today, per earlier session at the same track,
 * or (when that track has no earlier session) every lap inside the one run there.
 *
 * `kind` is not cosmetic. A session series and a lap series are different quantities on
 * the same axis, so the emphasised point changes with it: a session series highlights the
 * LAST point, because the newest run is the news; a lap series highlights the BEST lap,
 * because the final lap of a run is not a headline.
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
 * **The dots are HTML, not SVG, and that is the point.** Stretching the viewBox means the
 * horizontal and vertical scales differ by a factor that changes with the window width, so
 * an SVG `<circle>` in here draws as an ellipse — fat on a wide window, tall on a narrow
 * one, most obvious on the r=6 marker. The line does not care (`non-scaling-stroke`), so
 * only the markers move out: absolutely positioned over the same box at `left: x / W` as a
 * percentage and `top: y` in pixels, which is exactly where the stretch would have put them
 * because the vertical scale is 1 unit = 1px. A CSS circle stays round at every width.
 * Do not put them back inside the `<svg>`.
 *
 * The draw-on entrance uses the app's existing `.rc-draw` class (`pathLength="1"` +
 * dashoffset), which is already gated on `prefers-reduced-motion` in globals.css — so
 * reduced motion gets the line already drawn rather than a special case here.
 */
export function PaceChart({
  series,
  deltaSeconds,
  kind = "sessions",
  trackName,
}: {
  series: Array<{ runId: string; label: string; best: number }>;
  deltaSeconds: number | null;
  kind?: "sessions" | "laps";
  /** Named in the empty state so a thin series says WHERE it is thin. */
  trackName?: string | null;
}) {
  const isLaps = kind === "laps";

  if (series.length < 2) {
    return (
      <div className="flex h-[168px] items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-[12px] text-faint">
        {series.length === 0
          ? "No timed laps yet"
          : isLaps
            ? "One timed lap so far"
            : trackName
              ? `First session at ${trackName} — the trend starts next time out`
              : "One run so far — the trend starts next time out"}
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

  // Laps emphasise the quickest lap of the run; sessions emphasise the newest run.
  const markIndex = isLaps ? values.indexOf(min) : series.length - 1;
  const markX = x(markIndex);
  const markY = y(values[markIndex]);
  const markColor = isLaps
    ? "rgb(var(--color-gain))"
    : deltaSeconds == null
      ? "rgb(var(--color-faint))"
      : deltaSeconds < 0
        ? "rgb(var(--color-gain))"
        : "rgb(var(--color-destructive))";

  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div className="min-w-0">
      <div className="relative h-[168px] w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[168px] w-full overflow-visible"
          role="img"
          aria-label={
            isLaps
              ? `Lap times across ${series.length} laps of your last run, quickest ${formatLap(min)}. Lower is faster.`
              : `Pace across ${series.length} runs, from ${formatLap(first.best)} to ${formatLap(last.best)}. Lower is faster.`
          }
        >
          <line x1="0" y1="12" x2={W} y2="12" stroke="rgb(var(--color-border))" strokeWidth="1" strokeDasharray="2 5" />
          <line x1="0" y1="84" x2={W} y2="84" stroke="rgb(var(--color-border))" strokeWidth="1" strokeDasharray="2 5" />
          <line x1="0" y1="156" x2={W} y2="156" stroke="rgb(var(--color-border))" strokeWidth="1" />

          <polyline
            className="rc-draw"
            pathLength="1"
            points={points}
            fill="none"
            stroke="rgb(var(--color-faint))"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

        </svg>

        {series.map((p, i) =>
          i === markIndex ? null : (
            <span
              key={p.runId}
              aria-hidden
              className="pointer-events-none absolute block size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint"
              style={{ left: `${(x(i) / W) * 100}%`, top: `${y(p.best)}px` }}
            />
          )
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute block size-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(markX / W) * 100}%`, top: `${markY}px`, backgroundColor: markColor }}
        />
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-3 tabular-nums text-[10px] text-faint">
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
