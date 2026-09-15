/** "14.213" or "1:02.45" — the same shape the run rows print. Pure; shared by push and email. */
export function formatBestLap(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return seconds.toFixed(3);
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}
