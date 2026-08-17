import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";
import { isSpeedhiveHostname, validateSpeedhiveTrackUrl } from "@/lib/speedhive/speedhiveUrl";

export type TrackTimingUrls = {
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
};

export const TRACK_TIMING_PASTE_EXAMPLES =
  "e.g. tftr.liverc.com or speedhive.mylaps.com/practice/4591";

/**
 * The form hint shows one example, not the pair. A Speedhive practice id says nothing a driver
 * recognises and it is the half that wraps at 390px — where the hint's real job is saying what
 * filling the field buys you. Both providers still ship on the validation errors above, which is
 * where the shape of an acceptable URL actually gets asked for.
 */
export const TRACK_TIMING_PASTE_EXAMPLE_SHORT = "e.g. tftr.liverc.com";

/**
 * One pasted URL, two possible fields — tell them apart by host so the driver never has to
 * know which timing provider column they are filling in.
 *
 * Shared by every surface that takes a timing URL: the mid-run notice
 * (TrackTimingSourceNotice), the inline "New track" row, and the Tracks page add form.
 */
export function classifyTrackTimingUrl(
  raw: string
):
  | { ok: true; field: "liveRcUrl" | "speedhiveUrl"; url: string }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: `Paste the track's timing page — ${TRACK_TIMING_PASTE_EXAMPLES}`,
    };
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  const liveRc = validateLiveRcTrackUrl(candidate);
  if (liveRc.ok) return { ok: true, field: "liveRcUrl", url: liveRc.normalized };

  const speedhive = validateSpeedhiveTrackUrl(candidate);
  if (speedhive.ok) return { ok: true, field: "speedhiveUrl", url: speedhive.normalized };

  // Right provider, wrong page: their own parse errors say which page to grab instead.
  const host = hostnameOf(candidate);
  if (isSpeedhiveHostname(host)) return { ok: false, error: speedhive.error };
  if (/\.liverc\.com$/i.test(host)) return { ok: false, error: liveRc.error };
  return {
    ok: false,
    error: `That isn't a LiveRC or Speedhive track page — ${TRACK_TIMING_PASTE_EXAMPLES}`,
  };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
