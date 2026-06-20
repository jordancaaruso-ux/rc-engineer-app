/** Column visibility flags shared by Sessions table header and body. */
export type RunHistoryColumnLayout = {
  showReorderColumn: boolean;
  showMemberColumn: boolean;
  showSessionColumn: boolean;
};

/** Shared column widths so expanded run tables stay aligned. */
export function RunHistoryColGroup({ layout }: { layout: RunHistoryColumnLayout }) {
  const { showReorderColumn, showMemberColumn, showSessionColumn } = layout;
  return (
    <colgroup>
      {showReorderColumn ? <col className="hidden md:table-column w-6" /> : null}
      {showMemberColumn ? <col className="w-[15%]" /> : null}
      <col className="max-md:w-[4.25rem] md:w-[5.5rem]" />
      {showSessionColumn ? <col /> : null}
      <col className="hidden md:table-column w-[14%]" />
      <col className="max-md:w-[3.25rem] md:w-[4.25rem]" />
      <col className="max-md:w-[3.25rem] md:w-[4.25rem]" />
      {/* Avg top 10 hidden below md — saves horizontal space on narrow viewports */}
      <col className="hidden md:table-column w-[4.25rem]" />
      <col className="max-md:w-[3.25rem] md:w-[4.25rem]" />
      <col className="max-md:w-[3.75rem] md:w-[5.5rem]" />
    </colgroup>
  );
}
