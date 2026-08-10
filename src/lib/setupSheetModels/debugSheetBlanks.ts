/**
 * The manufacturer blanks checked into the repo, for trying the fill surface on real sheets.
 *
 * Deliberately the best case and the worst case rather than a tidy sample: Xray names its own
 * fields, Mugen ships `Text2`…`Text142`. A fill surface that only feels right on the Xray sheet
 * has not been tested.
 */
export const DEBUG_SHEET_BLANKS = {
  "xray-x4-2026": {
    label: "Xray X4 ’26",
    note: "201 fields, nearly all named by the manufacturer",
    path: "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf",
  },
  "xray-x4-2022": {
    label: "Xray X4 ’22",
    note: "178 fields, almost all named",
    path: "scripts/setup-extract-eval/gold/xray-x4-2022/files/X42022_blank.pdf",
  },
  "mugen-mtc3": {
    label: "Mugen MTC3",
    note: "142 fields, none named — the hard case",
    path: "scripts/setup-extract-eval/gold/mugen-mtc3/files/MTC3_EditableSetupSheet_CW.pdf",
  },
} as const;

export type DebugSheetBlankId = keyof typeof DEBUG_SHEET_BLANKS;

export function isDebugSheetBlankId(id: string): id is DebugSheetBlankId {
  return Object.prototype.hasOwnProperty.call(DEBUG_SHEET_BLANKS, id);
}
