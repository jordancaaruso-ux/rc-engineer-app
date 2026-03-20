/**
 * True when both values look like YYYY-MM-DD (from <input type="date" />)
 * and end is strictly before start.
 */
export function isEndDateBeforeStartDateYmd(startInput: string, endInput: string): boolean {
  const s = startInput.trim().slice(0, 10);
  const e = endInput.trim().slice(0, 10);
  if (s.length !== 10 || e.length !== 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return false;
  return e < s;
}
