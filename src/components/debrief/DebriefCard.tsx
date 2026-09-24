"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SetupChangedSincePreviousList } from "@/components/runs/SetupChangedSincePreviousList";
import type { DebriefFromNew, DebriefRecap, DebriefSetup } from "@/lib/debrief/buildDebriefRecap";
import { applyBulletEdit, BULLET, cleanBullets, withBullets } from "@/lib/debrief/debriefBullets";
import {
  confirmDebriefSave,
  openDebriefNote,
  rememberDebriefDraft,
  settleDebriefDraft,
} from "@/lib/debrief/debriefNotesThisTab";
import type { WorkbenchDebrief } from "@/lib/runs/sessionWorkbenchModel";
import { formatRunDateShort } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { useUnits } from "@/components/providers/UnitsProvider";
import { formatTempRange } from "@/lib/units/unitSystem";

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
 * 2026-09-18, the same row again: "vs field median". A bare "median" had no subject and that
 * is why it read as unclear in September; naming the field as well as the middle fixes the
 * half that was missing, and leaves the row honest about what it measures.
 *
 * 2026-09-18: one more line, last — the setup, START against END. The runs below already wear
 * a wrench per run that changed the car, so this is the net of the meeting, not a replay: "7
 * changes", and the list opens on a tap in the same table the wrench uses. A car that ended
 * where it started says so, with how many changes it took to get back — his call, so that
 * "touched nothing" and "tried everything and came home" never read the same.
 *
 * 2026-09-19: the box writes dot points — a dot waiting on the tap, a new one on every Return
 * (`debriefBullets`). Still one plain-text note underneath; "one empty notes thing looks a bit
 * cheap" was the complaint, and short points read better than a blob.
 *
 * Saves on blur like every other inline correction (run notes, `RunDetailPanel`): nothing lost
 * by tapping away.
 *
 * 2026-09-19: the save says so, under the box — "Saving…", then a tick and "Auto-saved". His
 * complaint was "I'll leave the page, go back and then it's not there"; nothing had been lost
 * (the page had drawn an old copy), but a save nobody can see is a save nobody trusts. A Save
 * button was built first and he took it back out the same day: "doesn't look very clean… a
 * subtle but clear auto saved would be the best". The box also saves a moment after the typing
 * stops, when the app goes to the background, and when the card goes away, and the request is
 * `keepalive` so closing the app doesn't cut it off.
 *
 * The pane draws this card afresh every time it changes, from a page copy of the note loaded
 * before any save — so it opens on this tab's memory of the meeting, not on that copy alone
 * (`debriefNotesThisTab`, bug found 2026-09-17: a saved note came back as the old one).
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

/**
 * One row of the card: label, value, and optionally something full-width underneath.
 *
 * Every row is a pair of cells in ONE grid (`RecapLines`), so the label column is exactly as wide
 * as the longest label on this card and no label wraps. At a fixed 64px "vs field median" and
 * "Handling rating" both broke in two, the rows came out at different heights, and that unevenness
 * was most of why the card "didn't look clean" (founder, 2026-09-19).
 */
type Row = {
  key: string;
  label: string;
  /** A second, quieter label on the row's LAST line — "From new", level with its figures. */
  foot?: string;
  value: ReactNode;
  /** Opens under the row at the card's full width (the setup list needs the room). */
  below?: ReactNode;
};

function RowCells({ row, last }: { row: Row; last: boolean }) {
  const rule = last || row.below ? "" : "border-b border-border/70";
  return (
    <>
      <div className={cn("flex flex-col justify-between whitespace-nowrap py-2 pr-4", rule)}>
        <span className="type-data-label leading-[18px]">{row.label}</span>
        {row.foot ? (
          <span className="text-[11px] font-semibold leading-[1.35] text-muted-foreground">{row.foot}</span>
        ) : null}
      </div>
      <div className={cn("min-w-0 py-2 text-[13px] leading-[18px] text-foreground", rule)}>{row.value}</div>
      {row.below ? (
        <div className={cn("col-span-2 min-w-0 pb-2", last ? "" : "border-b border-border/70")}>{row.below}</div>
      ) : null}
    </>
  );
}

/**
 * Pieces joined by " · " that break BETWEEN pieces and never inside one — and a piece that lands
 * on a new line loses its dot. Every piece carries its dot in front; the row is pulled left by
 * one dot's width and the clip hides whichever dots end up at the start of a line.
 *
 * At 390px the value column is ~200px, and a sentence left to wrap where it liked gave "· 36 /
 * made" and "· 4 / runs". The first piece alone may wrap inside (a long tyre name has to).
 */
function Dotted({ children }: { children: ReactNode }) {
  return (
    <span className="block overflow-hidden">
      <span className="-ml-[12px] flex flex-wrap">
        {Children.toArray(children).map((piece, index) => (
          <span
            key={index}
            className={cn(
              "min-w-0 before:inline-block before:w-[12px] before:text-center before:text-faint before:content-['·']",
              index > 0 && "whitespace-nowrap"
            )}
          >
            {piece}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Runs 2–5 on a set fitted new at this meeting, each against that set's run 1 on top 5. Plain
 * ink, not green or red: a tyre going off is the expected direction, not a verdict.
 */
function FromNewRow({ steps }: { steps: DebriefFromNew[] }) {
  if (steps.length === 0) return null;
  return (
    <table className="-ml-3 mt-1 border-collapse tabular-nums">
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
            className="sr-only"
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

/**
 * A car's setup over the meeting, first run against last. Three readings: nobody touched it;
 * it came home where it started after `made` changes; or it ended `rows.length` boxes away
 * (with `made` beside it when some of the way was undone). Only the last opens the list.
 *
 * The moved state is a sentence, not a subtotal (founder call 2026-09-18): "19 changes · 36
 * made" read as a part and a whole, when the two numbers are a distance and a count. "Ended 19
 * changes from where you started" says which is which in the driver's own words, and borrows
 * the phrase the came-home state already uses so the three readings sound like one voice.
 *
 * 2026-09-19: the same sentence, cut to fit one line at 390px — "19 changes from start · 36
 * made", and "Back at start · 7 changes made" beside it. "from start" is what keeps the first
 * number a distance; the two states still share the phrase.
 */
function SetupSummary({
  setup,
  open,
  onToggle,
}: {
  setup: DebriefSetup;
  open: boolean;
  onToggle: () => void;
}) {
  const net = setup.rows.length;
  const car = setup.carName ? <span>{setup.carName}</span> : null;
  if (setup.made === 0) {
    return (
      <Dotted>
        {car}
        <span>Unchanged</span>
      </Dotted>
    );
  }
  if (net === 0) {
    return (
      <Dotted>
        {car}
        <span>Back at start</span>
        <span className="text-faint">
          {setup.made} {setup.made === 1 ? "change" : "changes"} made
        </span>
      </Dotted>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="tap-active flex w-full items-center gap-1 text-left text-[13px] leading-[18px] text-foreground"
    >
      <span className="min-w-0 flex-1">
        <Dotted>
          {car}
          <span>
            <span className="font-semibold tabular-nums">{net}</span> {net === 1 ? "change" : "changes"} from start
          </span>
          {setup.made > net ? <span className="text-faint">{setup.made} made</span> : null}
        </Dotted>
      </span>
      <ChevronDown
        className={cn("h-3.5 w-3.5 flex-none text-faint transition-transform", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}

function RecapLines({
  recap,
  onOpenRun,
}: {
  recap: DebriefRecap;
  onOpenRun: (runId: string) => void;
}) {
  const rows: Row[] = [];
  let best: ReactNode = null;
  const [openSetupCarId, setOpenSetupCarId] = useState<string | null>(null);
  const units = useUnits();

  /*
   * The three lap figures side by side under ONE word, "Best" — founder call 2026-09-14
   * evening: stacked as three rows they "read as three different things" and cost the
   * card most of its height. A strip says they are one fact (the meeting's best) seen
   * three ways; the run under each figure is the door onto that run.
   *
   * 2026-09-19: the strip lost its box. A rounded, bordered well on top of a ruled list was two
   * layouts in one card, and the well was the tallest thing in it. Now the three figures stand
   * on the same hairline the rows use, split by the same hairline upright.
   */
  const marks = [
    recap.best ? { key: "lap", label: "Lap", value: formatLap(recap.best.seconds), run: recap.best } : null,
    recap.top5 ? { key: "top5", label: "Top 5", value: formatLap(recap.top5.seconds), run: recap.top5 } : null,
    recap.fiveMin ? { key: "stint", label: "5 min", value: recap.fiveMin.label, run: recap.fiveMin } : null,
  ].filter((m): m is NonNullable<typeof m> => m != null);
  if (marks.length > 0) {
    best = (
      <div className="border-b border-border/70 pb-2.5 pt-1">
        <div className="type-data-label mb-1.5">Best</div>
        <div className={cn("grid sm:max-w-[540px]", marks.length === 3 ? "grid-cols-3" : marks.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {marks.map((mark, index) => (
            <div key={mark.key} className={cn("min-w-0", index > 0 && "border-l border-border/70 pl-3")}>
              <div className="text-[11px] leading-[1.3] text-muted-foreground">{mark.label}</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums leading-tight text-foreground">
                {mark.value}
              </div>
              {/*
               * Run and day on ONE line (founder call 2026-09-19 — two lines made the strip the
               * tallest thing in the card). A third of 390px can't hold "Run 12 · Sun 28 Jun", so
               * the day is its weekday: inside one meeting that names the day, and the tap
               * settles anything it doesn't.
               */}
              <button
                type="button"
                onClick={() => onOpenRun(mark.run.runId)}
                className="tap-active mt-0.5 block max-w-full truncate text-left text-[11px] leading-snug text-faint underline decoration-border underline-offset-2 hover:text-foreground"
              >
                {mark.run.runLabel}
                {mark.run.dayLabel ? ` · ${mark.run.dayLabel.split(" ")[0]}` : null}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /*
   * Pace against the middle of the field: the meeting's average, then the best run — one row,
   * and the run name opens that run like the marks above do.
   *
   * 2026-09-18: the label names the statistic. "vs field" is not a figure anyone can define,
   * and the number under it is your top 5 minus the MEDIAN of every driver's top 5 on that
   * sheet, so the label says median. That also retired the word "avg" from the row: the two
   * averages here mean opposite things — the field's middle, and the mean of your own runs —
   * and one row could not carry both. "over 6 runs" says whose average it is. A meeting with
   * a single fielded run shows that one figure, not the same number twice under two words.
   */
  if (recap.field) {
    const field = recap.field;
    const bestRun = (
      <button
        type="button"
        onClick={() => onOpenRun(field.runId)}
        className="tap-active text-[12px] text-faint underline decoration-border underline-offset-2 hover:text-foreground"
      >
        {field.runLabel}
      </button>
    );
    rows.push({
      key: "field",
      label: "vs field median",
      // Two pieces: side by side where there is room, and on a phone one under the other with
      // the two figures level — not a sentence that wraps where it likes.
      value: (
        <Dotted>
          {field.runCount > 1 ? (
            <span>
              <span className={cn("font-semibold tabular-nums", gapTone(field.avg))}>{formatGap(field.avg)}</span>
              <span className="text-faint"> over {field.runCount} runs</span>
            </span>
          ) : null}
          <span>
            <span className={cn("font-semibold tabular-nums", gapTone(field.best))}>{formatGap(field.best)}</span>
            {field.runCount > 1 ? <span className="text-faint"> best</span> : null} {bestRun}
          </span>
        </Dotted>
      ),
    });
  }

  if (recap.rating) {
    const words = ratingWords(recap.rating.direction);
    rows.push({
      key: "rating",
      label: "Handling rating",
      value: (
        <Dotted>
          <span className="whitespace-nowrap tabular-nums">{ratingFigures(recap.rating.arc)}</span>
          {words ? <span className="text-faint">{words}</span> : null}
        </Dotted>
      ),
    });
  }

  // One decimal, spaced, in the reader's unit: "18.4 °C", "65.1–71.6 °F".
  const air = recap.airTempC
    ? formatTempRange(recap.airTempC.min, recap.airTempC.max, units, { space: true, decimals: 1 })
    : null;

  if (recap.tyres.length === 1) {
    // One compound: the air rides on the same line rather than costing a row of its own.
    const tyre = recap.tyres[0]!;
    rows.push({
      key: "tyre",
      label: "Tyres",
      foot: tyre.fromNew.length > 0 ? "From new" : undefined,
      value: (
        <>
          <Dotted>
            <span>{tyre.name}</span>
            <span className="text-faint">
              {tyre.runCount} {tyre.runCount === 1 ? "run" : "runs"}
            </span>
            {air ? <span className="text-faint">{air}</span> : null}
          </Dotted>
          <FromNewRow steps={tyre.fromNew} />
        </>
      ),
    });
  } else if (recap.tyres.length > 1) {
    // More than one compound: each gets the meeting's three figures, so the line answers
    // "which tyre was the day on" without the driver working it out from the rows.
    recap.tyres.forEach((tyre, index) => {
      const figures = [
        tyre.best != null ? `best ${formatLap(tyre.best)}` : null,
        tyre.top5 != null ? `top 5 ${formatLap(tyre.top5)}` : null,
        tyre.fiveMin,
      ].filter(Boolean);
      rows.push({
        key: `tyre-${tyre.name}`,
        label: index === 0 ? "Tyres" : "",
        foot: tyre.fromNew.length > 0 ? "From new" : undefined,
        value: (
          <>
            <Dotted>
              <span>{tyre.name}</span>
              <span className="text-faint">
                {tyre.runCount} {tyre.runCount === 1 ? "run" : "runs"}
              </span>
            </Dotted>
            {figures.length ? (
              <span className="block text-[12px] tabular-nums text-faint">
                <Dotted>
                  {figures.map((figure, figureIndex) => (
                    <span key={figureIndex}>{figure}</span>
                  ))}
                </Dotted>
              </span>
            ) : null}
            <FromNewRow steps={tyre.fromNew} />
          </>
        ),
      });
    });
  }

  if (air && recap.tyres.length !== 1) {
    rows.push({ key: "air", label: "Air", value: air });
  }

  // Last, so the list it opens lands directly above the runs it summarises, not between the
  // marks and the tyres. One line per car; the label reads once, like the tyre lines.
  recap.setup.forEach((setup, index) => {
    const open = openSetupCarId === setup.carId;
    rows.push({
      key: `setup-${setup.carId}`,
      label: index === 0 ? "Setup" : "",
      value: (
        <SetupSummary
          setup={setup}
          open={open}
          onToggle={() => setOpenSetupCarId(open ? null : setup.carId)}
        />
      ),
      below: open ? <SetupChangedSincePreviousList rows={setup.rows} runId={setup.endRunId} /> : undefined,
    });
  });

  if (!best && rows.length === 0) return null;
  return (
    <div className="mb-3">
      {best}
      {rows.length > 0 ? (
        <div className="grid grid-cols-[max-content_minmax(0,1fr)]">
          {rows.map((row, index) => (
            <RowCells key={row.key} row={row} last={index === rows.length - 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How long the typing has to stop before the box saves itself. */
const SAVE_AFTER_PAUSE_MS = 1500;

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
  const { meetingKey, localDayKey, trackKey } = debrief.identity;
  // Read once per mount — the box is uncontrolled, so this is the text it opens with.
  const [opened] = useState(() =>
    openDebriefNote(meetingKey, { text: debrief.text, updatedAtIso: debrief.updatedAtIso })
  );
  const savedTextRef = useRef(opened.saved.text);
  const sendingTextRef = useRef<string | null>(null);
  const [updatedAtIso, setUpdatedAtIso] = useState(opened.saved.updatedAtIso);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  /** The box holds something the server doesn't — the line under it reads "Saving…". */
  const [dirty, setDirty] = useState(opened.boxText.trim() !== opened.saved.text);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weekend = (debrief.recap?.dayCount ?? 1) > 1;
  /*
   * One word, and it is the whole state of the card. While the day or the event is still
   * running this is an Overview — what has happened so far — and only once the meeting is
   * finished is it a Debrief. Founder call 2026-09-16. The prompt inside the empty box does
   * NOT follow it: "What did you learn today / this weekend?" reads the same either way, and
   * a second moving part here buys nothing.
   */
  const title = debrief.isOver ? "Debrief" : "Overview";

  /*
   * What the box's text means as a note: the dots nobody wrote beside taken off — and an older,
   * undotted note that was opened and left alone is still that same note, so tapping in and out
   * of it saves nothing and moves no "updated" stamp.
   */
  const noteOf = useCallback((boxValue: string) => {
    const note = cleanBullets(boxValue);
    return note === withBullets(savedTextRef.current) ? savedTextRef.current : note;
  }, []);

  const save = useCallback(
    async (raw: string) => {
      const next = raw.trim();
      // Already on its way (a blur and the resend below can both ask for the same text).
      if (next === sendingTextRef.current) return;
      // Nothing to send — unless another text is still on its way and this one has to land after it.
      if (next === savedTextRef.current && sendingTextRef.current == null) {
        settleDebriefDraft(meetingKey, next);
        return;
      }
      sendingTextRef.current = next;
      setStatus("saving");
      try {
        const res = await fetch("/api/debriefs", {
          method: "PUT",
          // Outlives the page: the app closed or swiped away mid-save still lands it.
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingKey, localDayKey, trackKey, text: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          debrief: { text: string; updatedAtIso: string } | null;
          savedAtIso: string;
        };
        const newest = confirmDebriefSave(meetingKey, {
          text: json.debrief?.text ?? "",
          updatedAtIso: json.debrief?.updatedAtIso ?? null,
          savedAtIso: json.savedAtIso,
        });
        savedTextRef.current = newest.text;
        setUpdatedAtIso(newest.updatedAtIso);
        setStatus("idle");
        // More may have been typed while this was on its way.
        const box = boxRef.current;
        setDirty(box != null && noteOf(box.value).trim() !== newest.text);
      } catch {
        setStatus("error");
      } finally {
        if (sendingTextRef.current === next) sendingTextRef.current = null;
      }
    },
    [meetingKey, localDayKey, trackKey, noteOf]
  );

  /*
   * The box can open holding text no save has confirmed: the save that left with it failed, or
   * is still on its way on a slow signal. Send it again rather than let the box pass it off as
   * saved — the server takes the same text twice without harm.
   */
  useEffect(() => {
    if (opened.boxText !== opened.saved.text) void save(opened.boxText);
  }, [opened, save]);

  const saveBox = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    const box = boxRef.current;
    if (box) void save(noteOf(box.value));
  }, [save, noteOf]);

  /*
   * The doors that don't need a tap away: the app sent to the background (a phone gives no other
   * warning before it may be closed), and the card going away — another day picked, another page.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") saveBox();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", saveBox);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", saveBox);
      saveBox();
    };
  }, [saveBox]);

  /** Every point keeps its dot, whatever the keyboard just did (`debriefBullets`). */
  const keepBullets = (el: HTMLTextAreaElement, inputType: string) => {
    const edit = applyBulletEdit(el.value, el.selectionStart, inputType);
    if (edit.value !== el.value) {
      el.value = edit.value;
      el.setSelectionRange(edit.caret, edit.caret);
    }
    boxRef.current = el;
    const note = noteOf(el.value);
    rememberDebriefDraft(meetingKey, note);
    setDirty(note.trim() !== savedTextRef.current);
    // A moment after the typing stops — short enough to beat a quick exit, long enough not to
    // send a request per word.
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(saveBox, SAVE_AFTER_PAUSE_MS);
  };

  // The band carries the date alone; whether it is saved is said under the box, where the eyes are.
  const meta = updatedAtIso ? `updated ${formatRunDateShort(updatedAtIso, displayTimeZone)}` : null;

  return (
    <CardPanel contentClassName="px-3 pb-3 pt-2.5">
      <div className="eyebrow-band mb-1.5 flex items-center gap-2">
        <Eyebrow className="mb-0">{title}</Eyebrow>
        {meta ? (
          <span className="ml-auto text-[11px] leading-[1.25] text-muted-foreground">{meta}</span>
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
          defaultValue={withBullets(opened.boxText)}
          aria-label={weekend ? `Weekend ${title.toLowerCase()}` : `Day ${title.toLowerCase()}`}
          placeholder={weekend ? "• What did you learn this weekend?" : "• What did you learn today?"}
          onFocus={(e) => {
            boxRef.current = e.currentTarget;
            // The first dot is waiting. iOS places its own caret after the focus event, so the
            // caret is set again on the next frame.
            const el = e.currentTarget;
            if (el.value !== "") return;
            el.value = BULLET;
            el.setSelectionRange(BULLET.length, BULLET.length);
            requestAnimationFrame(() => {
              if (el.value === BULLET) el.setSelectionRange(BULLET.length, BULLET.length);
            });
          }}
          onInput={(e) => {
            const native = e.nativeEvent as InputEvent;
            // Mid-composition (an IME, some autocorrects) the text isn't settled — wait for its end.
            if (native.isComposing) return;
            keepBullets(e.currentTarget, native.inputType ?? "");
          }}
          onCompositionEnd={(e) => keepBullets(e.currentTarget, "")}
          onBlur={(e) => {
            const el = e.currentTarget;
            // A dot with nothing beside it is an empty box — the prompt comes back.
            if (cleanBullets(el.value) === "") el.value = "";
            boxRef.current = el;
            saveBox();
          }}
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-ring"
        />
        {/* The line keeps its height when empty, so the runs below never jump as it comes and goes. */}
        <div
          aria-live="polite"
          className="mt-1 flex min-h-[14px] items-center justify-end gap-1 text-[11px] leading-[14px] text-muted-foreground"
        >
          {status === "error" ? (
            <button type="button" onClick={saveBox} className="text-destructive underline underline-offset-2">
              Not saved · Retry
            </button>
          ) : status === "saving" || dirty ? (
            "Saving…"
          ) : updatedAtIso ? (
            <>
              <Check aria-hidden className="size-3" strokeWidth={2.5} />
              Auto-saved
            </>
          ) : null}
        </div>
      </div>
    </CardPanel>
  );
}
