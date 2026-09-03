"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TrackCombobox, type TrackOption } from "@/components/runs/TrackCombobox";
import { BandHeader } from "@/components/ui/BandHeader";
import { CardPanel } from "@/components/ui/CardPanel";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { emptyManualSession } from "@/lib/manualVideoAnalysis/types";
import { cn } from "@/lib/utils";

/**
 * Start a video analysis: pick the track, press Start.
 *
 * One card, used in two places — the first cell of the Video page's grid, and the standalone
 * `/videos/analysis/manual/new` page that a run's Video section links to with the track and run
 * already known. It used to be a `<select>` in a 512px card in the middle of the monitor; the
 * favourites are chips now, so the usual track is one tap, and the whole catalogue sits behind
 * the same picker the log-run wizard uses.
 *
 * Nothing about lines is chosen here. The session opens on the track's most recent line set and
 * the flow's Lines step is where you confirm or swap it.
 */
export function NewAnalysisCard({
  presetTrackId = "",
  presetProfileId = "",
  presetRunId = "",
  stretch = false,
  className,
}: {
  presetTrackId?: string;
  presetProfileId?: string;
  presetRunId?: string;
  /**
   * Fill the grid cell so the card's edges line up with its neighbours (the Video page). The
   * Start button never moves with it — it stays directly under the track picker (founder call
   * 2026-09-03: a tall neighbour list had pushed it to the bottom of the monitor).
   */
  stretch?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [tracks, setTracks] = useState<TrackOption[]>([]);
  const [favouriteIds, setFavouriteIds] = useState<string[]>([]);
  const [trackId, setTrackId] = useState(presetTrackId);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetch("/api/tracks?favouritesFirst=1")
      .then((r) => r.json())
      .catch(() => ({ tracks: [] }))
      .then((d: { tracks?: TrackOption[]; favouriteIds?: string[] }) => {
        if (Array.isArray(d.tracks)) setTracks(d.tracks);
        if (Array.isArray(d.favouriteIds)) setFavouriteIds(d.favouriteIds);
      });
  }, []);

  // The favourites as chips, the preset track among them even when it is not a favourite — the
  // track a run was driven at is the one this card is for.
  const chips = useMemo(() => {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const ids = [...favouriteIds];
    if (presetTrackId && !ids.includes(presetTrackId)) ids.unshift(presetTrackId);
    return ids.map((id) => byId.get(id)).filter((t): t is TrackOption => t != null).slice(0, 8);
  }, [tracks, favouriteIds, presetTrackId]);

  async function resolveProfileId(): Promise<string | null> {
    if (presetProfileId) return presetProfileId;
    const res = await fetch(`/api/tracks/${trackId}/camera-profiles`);
    if (res.ok) {
      const { profiles } = (await res.json()) as { profiles?: Array<{ id: string }> };
      if (profiles?.[0]) return profiles[0].id;
    }
    const created = await fetch(`/api/tracks/${trackId}/camera-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sector lines" }),
    });
    if (!created.ok) return null;
    const { profile } = (await created.json()) as { profile: { id: string } };
    return profile.id;
  }

  async function createJob() {
    if (!trackId) {
      setMsg("Pick a track.");
      return;
    }
    setCreating(true);
    setMsg(null);
    const profileId = await resolveProfileId();
    if (!profileId) {
      setCreating(false);
      setMsg("Could not set up sector lines for this track.");
      return;
    }
    const runId = presetRunId.trim();
    const session = {
      ...emptyManualSession(),
      timingSource: runId ? ("run" as const) : ("url" as const),
      compare: { my: null, competitor: null, alignAt: "sf_start" as const },
    };
    const res = await fetch("/api/video-analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId,
        profileId,
        runId: runId || null,
        analysisMode: "manual",
        manualJson: session,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      setMsg("Could not start the analysis.");
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/videos/analysis/jobs/${id}`);
  }

  return (
    <CardPanel className={cn(stretch && "h-full", className)} contentClassName="flex h-full flex-col p-0">
      <BandHeader label="New analysis" />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrackId(t.id)}
                className={cn(chipToggleClass(trackId === t.id), "px-3 py-2 text-[12px]")}
              >
                {t.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="max-w-xl">
          <TrackCombobox
            tracks={tracks}
            value={trackId}
            onChange={setTrackId}
            favouriteTrackIds={favouriteIds}
            placeholder={chips.length ? "Another track…" : "Select track…"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={creating || !trackId}
            onClick={() => void createJob()}
            className="rounded-xl primary-face bg-primary px-5 py-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {creating ? "Starting…" : "Start video analysis"}
          </button>
          {msg ? <p className="text-[12px] text-muted-foreground">{msg}</p> : null}
        </div>
      </div>
    </CardPanel>
  );
}
