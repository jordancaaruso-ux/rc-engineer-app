"use client";

import { useState, type ReactNode } from "react";
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, StatStrip } from "@/components/ui/panel";
import type { DebriefFromNew, DebriefRecap } from "@/lib/debrief/buildDebriefRecap";
import type { WorkbenchDebrief } from "@/lib/runs/sessionWorkbenchModel";
import { formatRunDateShort } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";

/**
 * The debrief — the driver's own note on a meeting, with the figures beside it.
 *
 * Founder call 2026-09-14: this has ONE home, the Sessions day, between the chart and the
 * runs. It is a card in place, not a route (a route would key a URL on a track name) and not
 * a sheet (a textarea in a portalled sheet fights the iOS viewport). One free-text box, no
 * structure: a driver who raced all weekend and logged nothing still has one thing to say
 * about it, and the box is that. Things to try stays its own list.
 *
 * The figures (his second pass, same day): best lap, best top 5, best five-minute stint —
 * each naming the run that did it, and the name opens that run in the list below. Then how
 * the car felt across the meeting, the tyres (their own three figures each when more than one
 * was run), and the air. No direction words, no comparisons: the first version led with
 * "quicker than earlier" and "it doesn't mean anything" at the end of a day.
 *
 * 2026-09-15: two one-row additions, and nothing else moves — the card must stay short enough
 * not to push the runs down. "vs field" under the marks: your pace against the middle of the
 * field, the meeting's average then your best run ("vs median" read as unclear, his call). And
 * a From new row inside the tyre that was fitted new, never a line of its own — "From new by
 * itself doesn't make sense".
 *
 * Saves on blur like every other inline correction (run notes, `RunDetailPanel`): no button
 * to hunt for, nothing lost by tapping away.
 */

function ratingWords(direction: NonNullable<DebriefRecap["rating"]>["direction"]): string | null {
  switch (direction) {
    case "improving":
      return "coming to you";
    case "fading":
      return "going away";
    case "flat":
      return "same all day";
    case "holding":
      return "settled";
    case "swinging":
      return "up and down";
    default:
      return null;
  }
}

/** Six ratings fit on one line at 390px beside the label; past that, the day's low and high. */
function ratingFigures(arc: number[]): string {
  if (arc.length <= 6) return arc.join(" → ");
  const low = Math.min(...arc);
  const high = Math.max(...arc);
  return low === high ? `${low} every run` : `low ${low}, high ${high}`;
}

/** Seconds on the app's lap-delta sign — + slower, a real minus quicker — to two places. */
function formatGap(seconds: number): string {
  const abs = Math.abs(seconds).toFixed(2);
  if (Number(abs) === 0) return "0.00";
  return `${seconds < 0 ? "−" : "+"}${abs}`;
}

/** Green quicker, red slower: pace deltas are the one place those two colours live. */
function gapTone(seconds: number): string | undefined {
  if (Math.abs(seconds) < 0.005) return undefined;
  return seconds < 0 ? "text-gain" : "text-destructive";
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border/70 py-1.5 last:border-b-0">
      <span className="type-data-label w-[64px] flex-none pt-0.5">{label}</span>
      <div className="min-w-0 text-[13px] leading-snug text-foreground">{children}</div>
    </div>
  );
}

/**
 * Runs 2–5 on a set fitted new at this meeting, each against that set's run 1 on top 5. Plain
 * ink, not green or red: a tyre going off is the expected direction, not a verdict.
 */
function FromNewRow({ steps }: { steps: DebriefFromNew[] }) {
  if (steps.length === 0) return null;
  return (
    <table className="mt-1 border-collapse tabular-nums">
      <thead>
        <tr>
          <td className="p-0" />
          {steps.map((step) => (
            <th
              key={step.tyreRun}
              scope="col"
              className="whitespace-nowrap pl-3 text-right text-[11px] font-normal leading-[1.3] text-faint"
            >
              run {step.tyreRun}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th
            scope="row"
            className="whitespace-nowrap p-0 text-left text-[11px] font-semibold leading-[1.35] text-muted-foreground"
          >
            From new
          </th>
          {steps.map((step) => (
            <td
              key={step.tyreRun}
              className="whitespace-nowrap pl-3 text-right text-[12px] font-semibold leading-[1.35] text-foreground"
            >
              {formatGap(step.seconds)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function RecapLines({
  recap,
  onOpenRun,
}: {
  recap: DebriefRecap;
  onOpenRun: (runId: string) => void;
}) {
  const lines: ReactNode[] = [];

  /*
   * The three lap figures side by side under ONE word, "Best" — founder call 2026-09-14
   * evening: stacked as three rows they "read as three different things" and cost the
   * card most of its height. A strip says they are one fact (the meeting's best) seen
   * three ways; the run under each figure is the door onto that run.
   */
  const marks = [
    recap.best ? { key: "lap", label: "Lap", value: formatLap(recap.best.seconds), run: recap.best } : null,
    recap.top5 ? { key: "top5", label: "Top 5", value: formatLap(recap.top5.seconds), run: recap.top5 } : null,
    recap.fiveMin ? { key: "stint", label: "5 min", value: recap.fiveMin.label, run: recap.fiveMin } : null,
  ].filter((m): m is NonNullable<typeof m> => m != null);
  if (marks.length > 0) {
    lines.push(
      <div key="best" className="pb-2">
        <div className="type-data-label mb-1">Best</div>
        <StatStrip gridClassName={marks.length === 3 ? "grid-cols-3" : marks.length === 2 ? "grid-cols-2" : "grid-cols-1"}>
          {marks.map((mark) => (
            <div key={mark.key} className="border-l border-t border-border px-2.5 py-2">
              <div className="type-data-label">{mark.label}</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums leading-tight text-foreground">
                {mark.value}
              </div>
              <button
                type="button"
                onClick={() => onOpenRun(mark.run.runId)}
                className="tap-active mt-0.5 text-left text-[11px] leading-snug text-faint underline decoration-border underline-offset-2 hover:text-foreground"
              >
                {mark.run.runLabel}
                {mark.run.dayLabel ? <span className="block">{mark.run.dayLabel}</span> : null}
              </button>
            </div>
          ))}
        </StatStrip>
      </div>
    );
  }

  // Pace against the middle of the field: the meeting's average, then the best run — one row,
  // and the run name opens that run like the marks above do.
  if (recap.field) {
    const field = recap.field;
    lines.push(
      <Line key="field" label="vs field">
        <span className={cn("font-semibold tabular-nums", gapTone(field.avg))}>{formatGap(field.avg)}</span>
        <span className="text-faint"> avg · </span>
        <span className={cn("font-semibold tabular-nums", gapTone(field.best))}>{formatGap(field.best)}</span>
        <span className="text-faint"> best </span>
        <button
          type="button"
          onClick={() => onOpenRun(field.runId)}
          className="tap-active text-[12px] text-faint underline decoration-border underline-offset-2 hover:text-foreground"
        >
          {field.runLabel}
        </button>
      </Line>
    );
  }

  if (recap.rating) {
    const words = ratingWords(recap.rating.direction);
    lines.push(
      <Line key="rating" label="Felt">
        <span className="tabular-nums">{ratingFigures(recap.rating.arc)}</span>
        {words ? <span className="text-faint"> · {words}</span> : null}
      </Line>
    );
  }

  const air = recap.airTempC
    ? recap.airTempC.min === recap.airTempC.max
      ? `${recap.airTempC.min} °C`
      : `${recap.airTempC.min}–${recap.airTempC.max} °C`
    : null;

  if (recap.tyres.length === 1) {
    // One compound: the air rides on the same line rather than costing a row of its own.
    const tyre = recap.tyres[0]!;
    lines.push(
      <Line key="tyre" label="Tyres">
        {tyre.name}
        <span className="text-faint">
          {" · "}
          {tyre.runCount} {tyre.runCount === 1 ? "run" : "runs"}
          {air ? ` · ${air}` : ""}
        </span>
        <FromNewRow steps={tyre.fromNew} />
      </Line>
    );
  } else if (recap.tyres.length > 1) {
    // More than one compound: each gets the meeting's three figures, so the line answers
    // "which tyre was the day on" without the driver working it out from the rows.
    recap.tyres.forEach((tyre, index) => {
      const figures = [
        tyre.best != null ? `best ${formatLap(tyre.best)}` : null,
        tyre.top5 != null ? `top 5 ${formatLap(tyre.top5)}` : null,
        tyre.fiveMin,
      ].filter(Boolean);
      lines.push(
        <Line key={`tyre-${tyre.name}`} label={index === 0 ? "Tyres" : ""}>
          <span className="block">
            {tyre.name}
            <span className="text-faint">
              {" · "}
              {tyre.runCount} {tyre.runCount === 1 ? "run" : "runs"}
            </span>
          </span>
          {figures.length ? (
            <span className="block text-[12px] tabular-nums text-faint">{figures.join(" · ")}</span>
          ) : null}
          <FromNewRow steps={tyre.fromNew} />
        </Line>
      );
    });
  }

  if (air && recap.tyres.length !== 1) {
    lines.push(
      <Line key="air" label="Air">
        {air}
      </Line>
    );
  }

  if (lines.length === 0) return null;
  return <div className="mb-3">{lines}</div>;
}

export function DebriefCard({
  debrief,
  displayTimeZone,
  onOpenRun,
}: {
  debrief: WorkbenchDebrief;
  /** The reader's clock, for the "updated" stamp. */
  displayTimeZone: string | null;
  /** Opens a run in the list below — the same door a point on the chart is. */
  onOpenRun: (runId: string) => void;
}) {
  const [savedText, setSavedText] = useState(debrief.text);
  const [updatedAtIso, setUpdatedAtIso] = useState(debrief.updatedAtIso);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const weekend = (debrief.recap?.dayCount ?? 1) > 1;
  /*
   * One word, and it is the whole state of the card. While the day or the event is still
   * running this is an Overview — what has happened so far — and only once the meeting is
   * finished is it a Debrief. Founder call 2026-09-16. The prompt inside the empty box does
   * NOT follow it: "What did you learn today / this weekend?" reads the same either way, and
   * a second moving part here buys nothing.
   */
  const title = debrief.isOver ? "Debrief" : "Overview";

  const save = async (raw: string) => {
    const next = raw.trim();
    if (next === savedText) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/debriefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingKey: debrief.identity.meetingKey,
          localDayKey: debrief.identity.localDayKey,
          trackKey: debrief.identity.trackKey,
          text: next,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        debrief: { text: string; updatedAtIso: string } | null;
      };
      setSavedText(json.debrief?.text ?? "");
      setUpdatedAtIso(json.debrief?.updatedAtIso ?? null);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const meta =
    status === "error"
      ? "not saved"
      : status === "saving"
        ? "saving"
        : updatedAtIso
          ? `updated ${formatRunDateShort(updatedAtIso, displayTimeZone)}`
          : null;

  return (
    <CardPanel contentClassName="px-3 pb-3 pt-2.5">
      <div className="eyebrow-band mb-1.5 flex items-center gap-2">
        <Eyebrow className="mb-0">{title}</Eyebrow>
        {meta ? (
          <span
            className={cn(
              "ml-auto text-[11px] leading-[1.25]",
              status === "error" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {meta}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5">
        {debrief.recap ? <RecapLines recap={debrief.recap} onOpenRun={onOpenRun} /> : null}
        <AutoGrowTextarea
          minRows={2}
          /*
           * Grows with what you write, then scrolls — the card sits between the day's chart and
           * its runs, so a weekend's worth of thoughts must not push the runs off the screen.
           * Founder call 2026-09-16.
           */
          maxRows={10}
          defaultValue={debrief.text}
          aria-label={weekend ? `Weekend ${title.toLowerCase()}` : `Day ${title.toLowerCase()}`}
          placeholder={weekend ? "What did you learn this weekend?" : "What did you learn today?"}
          onBlur={(e) => void save(e.currentTarget.value)}
          className="w-full rounded-md border border-ring/40 bg-background px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-ring"
        />
      </div>
    </CardPanel>
  );
}
