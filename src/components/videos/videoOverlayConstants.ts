export const MAX_OFFSET_SEC = 300;
export const FINE_OFFSET_RANGE_SEC = 2;

/** HTMLMediaElement.HAVE_FUTURE_DATA — enough buffered to start without stall. */
export const HAVE_FUTURE_DATA = 3;

export const PLAYBACK_RATE_PRESETS = [1, 0.75, 0.5, 0.25] as const;
export type PlaybackRatePreset = (typeof PLAYBACK_RATE_PRESETS)[number];

export function formatClockTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPlaybackRateLabel(rate: number): string {
  if (rate === 1) return "1×";
  return `${rate}×`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clampOffset(sec: number): number {
  return clamp(sec, -MAX_OFFSET_SEC, MAX_OFFSET_SEC);
}

/** Display as signed mm:ss.ss (e.g. -2:05.50, +0:00.00). */
export function formatOffset(sec: number): string {
  const sign = sec < 0 ? "-" : sec > 0 ? "+" : "";
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  const sWhole = Math.floor(s);
  const frac = Math.round((s - sWhole) * 100);
  const ss = `${String(sWhole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
  return `${sign}${m}:${ss}`;
}

/** Parse mm:ss.ss or raw seconds. Returns null if invalid. */
export function parseOffset(input: string): number | null {
  const raw = input.trim().replace(/^\+/, "");
  if (!raw) return null;

  const mmss = /^(-?)(\d+):(\d+(?:\.\d+)?)$/.exec(raw);
  if (mmss) {
    const sign = mmss[1] === "-" ? -1 : 1;
    const minutes = Number(mmss[2]);
    const seconds = Number(mmss[3]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return clampOffset(sign * (minutes * 60 + seconds));
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return clampOffset(num);
}

export function isMobileOverlayUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}
