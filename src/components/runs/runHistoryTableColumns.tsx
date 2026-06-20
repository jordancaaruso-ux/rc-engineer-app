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
      <col className="w-[5.5rem]" />
      {showSessionColumn ? <col /> : null}
      <col className="hidden md:table-column w-[14%]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="w-[4.25rem]" />
      <col className="max-md:w-[26%] md:w-[5.5rem]" />
    </colgroup>
  );
}
