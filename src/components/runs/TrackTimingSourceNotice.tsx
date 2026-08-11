"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  TRACK_TIMING_PASTE_EXAMPLES as PASTE_EXAMPLES,
  classifyTrackTimingUrl,
  type TrackTimingUrls,
} from "@/lib/tracks/trackTimingUrl";

export type { TrackTimingUrls };

/**
 * A LiveRC subdomain *is* the track's identity, so it's worth the line length — where a
 * Speedhive practice id says nothing a driver would recognise.
 */
function liveRcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Says out loud what lap discovery will search for the selected track, and lets the driver
 * fix it in place when the answer is "nothing".
 *
 * Tracks are a shared catalog (docs/ASSET_ACCESS_NORTH_STAR.md) — you routinely log runs at a
 * track someone else added, and a track entry without a timing URL searched nothing while
 * looking exactly like a scan that found nothing. Timing URLs are an open contribution
 * (any driver may PATCH them), so the fix belongs here rather than a trip to the Tracks page
 * mid-run.
 */
export function TrackTimingSourceNotice({
  trackId,
  trackName,
  liveRcUrl,
  speedhiveUrl,
  onSaved,
  className,
}: {
  trackId: string;
  trackName?: string | null;
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
  /** Saved URLs as the server normalized them — the caller re-scans off the changed props. */
  onSaved: (next: TrackTimingUrls) => void;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveRc = liveRcUrl?.trim() || null;
  const speedhive = speedhiveUrl?.trim() || null;
  const track = trackName?.trim() || null;

  async function save() {
    if (saving) return;
    const parsed = classifyTrackTimingUrl(url);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [parsed.field]: parsed.url }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        track?: { liveRcUrl?: string | null; speedhiveUrl?: string | null };
      };
      if (!res.ok || !data.track) {
        setError(data.error ?? "Could not save that URL.");
        return;
      }
      setUrl("");
      onSaved({
        liveRcUrl: data.track.liveRcUrl ?? null,
        speedhiveUrl: data.track.speedhiveUrl ?? null,
      });
    } catch {
      setError("Could not save that URL.");
    } finally {
      setSaving(false);
    }
  }

  if (liveRc || speedhive) {
    const parts: string[] = [];
    if (liveRc) parts.push(`LiveRC (${liveRcHost(liveRc)})`);
    if (speedhive) parts.push("Speedhive");
    return (
      <p className={cn("ui-label-meta", className)}>
        <span aria-hidden className="mr-1.5 text-[#4FD089]">
          ●
        </span>
        Searching {track ?? "this track"} on {parts.join(" and ")}.
      </p>
    );
  }

  return (
    <div className={cn("rounded-md border border-border bg-surface-runna-inset p-2.5", className)}>
      <p className="text-[12px] font-semibold text-foreground">
        No timing site saved for {track ?? "this track"}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Nothing to search, so no sessions appear here. Paste its LiveRC or Speedhive page — tracks
        are shared, so it sticks for everyone.
      </p>
      <div className="mt-2 flex flex-col gap-1.5 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-runna px-2.5 py-1.5 text-[12px] outline-none"
          placeholder="LiveRC or Speedhive track page URL"
          aria-label={`Timing site URL for ${track ?? "this track"}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
        <button
          type="button"
          disabled={saving}
          className={cn(
            "shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground transition hover:brightness-95",
            saving && "opacity-60 pointer-events-none"
          )}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save timing site"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {PASTE_EXAMPLES}. No URL? Paste one session under{" "}
          <span className="text-foreground/90">URL Manual</span> instead.
        </p>
      )}
    </div>
  );
}
