import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Column visibility flags shared by Sessions table header and body. */
export type RunHistoryColumnLayout = {
  showReorderColumn: boolean;
  showMemberColumn: boolean;
  showSessionColumn: boolean;
  showComparePairColumn?: boolean;
};

/** Main sessions grid columns (date, car, best, avg5, avg10, median, setup/laps). */
const SESSION_TABLE_BODY_COLS_WITHOUT_SESSION = 7;

/** Total `<td>` / `<th>` count for colspan (mobile flex row + desktop table). */
export function computeRunHistoryColSpan(layout: RunHistoryColumnLayout): number {
  return (
    (layout.showReorderColumn ? 1 : 0) +
    (layout.showMemberColumn ? 1 : 0) +
    SESSION_TABLE_BODY_COLS_WITHOUT_SESSION +
    (layout.showSessionColumn ? 1 : 0) +
    (layout.showComparePairColumn ? 1 : 0)
  );
}

/** Lap times, dates, and stat values — matches All laps grid in RunDetail. */
export const RUN_HISTORY_DATA_CLASS = "font-mono text-[11px] tabular-nums";

/** Muted mobile column headers (Date / Best / Top 5 / Median). */
export const RUN_HISTORY_DATA_HEADER_CLASS = "type-data-label";

/** Desktop-only action column — mobile buttons live in the flex row shell. */
export const RUN_HISTORY_ACTION_CELL_CLASS =
  "hidden md:table-cell whitespace-nowrap w-[1%] px-2 py-2 text-right";

/** Fixed date column width on mobile (~3.5rem). */
export const RUN_HISTORY_MOBILE_DATE_CLASS = "w-14 shrink-0 min-w-0 text-left";

/** Pushes the stats cluster right — grouped between date and action buttons. */
export const RUN_HISTORY_MOBILE_SPACER_CLASS = "min-w-0 flex-1";

/** Left-aligned tabular stats block (Best / Top 5 / Median). */
export const RUN_HISTORY_MOBILE_STATS_BLOCK_CLASS = "flex shrink-0 gap-3";

/** Fixed stat column widths — header and body share these for pixel alignment. */
export const RUN_HISTORY_MOBILE_STAT_BEST_CLASS = "w-12 shrink-0 text-left";
export const RUN_HISTORY_MOBILE_STAT_TOP5_CLASS = "w-12 shrink-0 text-left";
export const RUN_HISTORY_MOBILE_STAT_MEDIAN_CLASS = "w-[3.25rem] shrink-0 text-left";

/** Icon buttons column at the far right on mobile (~32×32px each, side-by-side). */
export const RUN_HISTORY_MOBILE_ACTIONS_CLASS = "flex shrink-0 flex-row gap-0.5";

/** Outer actions cell — shrink-0 so flex spacer width matches header and body rows. */
export const RUN_HISTORY_MOBILE_ACTIONS_SLOT_CLASS = "shrink-0";

/** Invisible twin buttons so header reserves the same width as data-row action buttons. */
export function RunHistoryMobileActionsPlaceholder() {
  return (
    <div className={RUN_HISTORY_MOBILE_ACTIONS_CLASS} aria-hidden>
      <div className="h-8 w-8 shrink-0" />
      <div className="h-8 w-8 shrink-0" />
    </div>
  );
}

/** Shared column structure for mobile header and body rows (date · spacer · stats · actions). */
export function RunHistoryMobileColumns({
  date,
  best,
  top5,
  median,
  actions,
}: {
  date: ReactNode;
  best: ReactNode;
  top5: ReactNode;
  median: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className={RUN_HISTORY_MOBILE_DATE_CLASS}>{date}</div>
      <div className={RUN_HISTORY_MOBILE_SPACER_CLASS} aria-hidden />
      <div className={RUN_HISTORY_MOBILE_STATS_BLOCK_CLASS}>
        <div className={RUN_HISTORY_MOBILE_STAT_BEST_CLASS}>{best}</div>
        <div className={RUN_HISTORY_MOBILE_STAT_TOP5_CLASS}>{top5}</div>
        <div className={RUN_HISTORY_MOBILE_STAT_MEDIAN_CLASS}>{median}</div>
      </div>
      <div className={RUN_HISTORY_MOBILE_ACTIONS_SLOT_CLASS}>
        {actions ?? <RunHistoryMobileActionsPlaceholder />}
      </div>
    </>
  );
}

export function RunHistoryMobileRowShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full min-w-0 items-center gap-1 px-1.5 py-1.5", className)}>
      {children}
    </div>
  );
}

/** Mobile header row — flex layout matching body rows (max-md only). */
export function RunHistoryMobileHeaderRow({
  colSpan,
}: {
  colSpan: number;
}) {
  return (
    <tr className="border-b border-border bg-muted/70 md:hidden">
      <th colSpan={colSpan} className="p-0 font-normal text-left">
        <RunHistoryMobileRowShell>
          <RunHistoryMobileColumns
            date={<span className={RUN_HISTORY_DATA_HEADER_CLASS}>Date</span>}
            best={<span className={RUN_HISTORY_DATA_HEADER_CLASS}>Best</span>}
            top5={<span className={RUN_HISTORY_DATA_HEADER_CLASS}>Top 5</span>}
            median={<span className={RUN_HISTORY_DATA_HEADER_CLASS}>Median</span>}
          />
        </RunHistoryMobileRowShell>
      </th>
    </tr>
  );
}

/** Desktop column widths — mobile uses colspan flex rows instead of table columns. */
export function RunHistoryColGroup({ layout }: { layout: RunHistoryColumnLayout }) {
  const { showReorderColumn, showMemberColumn, showSessionColumn } = layout;
  return (
    <colgroup className="max-md:hidden">
      {showReorderColumn ? <col className="w-6" /> : null}
      {showMemberColumn ? <col className="w-[15%]" /> : null}
      <col className="w-[5.5rem]" />
      {showSessionColumn ? <col /> : null}
      <col className="w-[14%]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="w-[1%]" />
    </colgroup>
  );
}
