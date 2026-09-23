"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { PracticeFieldBrowser } from "@/components/laps/PracticeFieldBrowser";
import type { PracticeFieldSource } from "@/lib/practiceField/practiceField";
import type { KnownCompetitor } from "@/lib/speedhive/knownCompetitors";

/**
 * Someone else's practice at a track, with no run of your own to start from: pick where, press
 * Find, and everyone who practised is there to search — a team manager's door, or yours on a day
 * you didn't drive. The lap sheet's Practice tab is the same list for "who else was out with me".
 *
 * It used to take one saved driver and one MYLAPS track and hand back that driver's sessions.
 * Since 2026-09-21 (founder call) it reads the whole practice list — LiveRC tracks included —
 * and the saved drivers are one-tap filters over it. See `PracticeFieldBrowser`.
 *
 * Nothing here fetches until asked. With no track that can be looked in, the card is not drawn:
 * nothing on it could work.
 */
export function CompetitorPracticePull({
  competitors,
  tracks,
  todayYmd,
}: {
  competitors: KnownCompetitor[];
  /** Only tracks with a LiveRC or MYLAPS practice link — the rest cannot be looked in. */
  tracks: Array<{ id: string; name: string; sources: PracticeFieldSource[] }>;
  /** Today in the viewer's zone, YYYY-MM-DD — where the day box opens, and as far as it goes. */
  todayYmd: string;
}) {
  const router = useRouter();
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const track = tracks.find((t) => t.id === trackId) ?? null;

  if (tracks.length === 0) return null;

  return (
    <CardPanel contentClassName="space-y-3">
      <Eyebrow>Someone else&apos;s practice</Eyebrow>
      <select
        value={trackId}
        onChange={(e) => setTrackId(e.target.value)}
        aria-label="Track"
        className="w-full min-w-0 rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-primary-ink/50"
      >
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {track ? (
        // Keyed on the track: another track is another list, another day box, another site switch.
        <PracticeFieldBrowser
          key={track.id}
          trackId={track.id}
          trackName={track.name}
          sources={track.sources}
          initialDayYmd={todayYmd}
          maxDayYmd={todayYmd}
          mode="open"
          competitors={competitors}
          onOpenSession={(id) => router.push(`/laps/analysis?session=${encodeURIComponent(id)}`)}
        />
      ) : null}
    </CardPanel>
  );
}
