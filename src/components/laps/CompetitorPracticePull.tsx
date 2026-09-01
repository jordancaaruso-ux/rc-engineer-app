"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { formatRunDateTime } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";
import type { KnownCompetitor } from "@/lib/speedhive/knownCompetitors";

type PulledSession = {
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  lapCount: number;
  bestLapSeconds: number | null;
  importedSessionId: string | null;
};

/**
 * Pull a saved driver's practice at a track, on a button.
 *
 * The card only exists when there is something to pull WITH — a saved competitor and a track
 * whose MYLAPS practice page we know. Rendering it empty with two disabled dropdowns would be
 * a lesson about MYLAPS on a page nobody came to read one.
 *
 * Nothing here fetches until asked, and asking is the whole interaction: pick who, pick where,
 * press. Their session then imports like any other and opens on the sheet, where it can be
 * compared with a run of yours.
 */
export function CompetitorPracticePull({
  competitors,
  tracks,
}: {
  competitors: KnownCompetitor[];
  /** Only tracks with a MYLAPS practice page — the rest cannot be looked in. */
  tracks: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [transponder, setTransponder] = useState(competitors[0]?.transponder ?? "");
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PulledSession[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (competitors.length === 0 || tracks.length === 0) return null;

  async function pull() {
    setBusy(true);
    setNote(null);
    setSessions(null);
    try {
      const res = await fetch("/api/laps/competitor-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transponder, trackId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { sessions?: PulledSession[]; hint?: string | null; error?: string }
        | null;
      if (!res.ok) {
        setNote(data?.error ?? "That didn't work.");
        return;
      }
      setSessions(data?.sessions ?? []);
      if (data?.hint) setNote(data.hint);
    } catch {
      setNote("That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function open(session: PulledSession) {
    if (session.importedSessionId) {
      router.push(`/laps/analysis?session=${encodeURIComponent(session.importedSessionId)}`);
      return;
    }
    setImportingUrl(session.sessionUrl);
    setNote(null);
    try {
      const res = await fetch("/api/lap-time-sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [session.sessionUrl] }),
      });
      const data = (await res.json().catch(() => null)) as {
        results?: Array<{ success?: boolean; importedSessionId?: string; error?: string }>;
      } | null;
      const first = data?.results?.[0];
      if (first?.success && first.importedSessionId) {
        router.push(`/laps/analysis?session=${encodeURIComponent(first.importedSessionId)}`);
        return;
      }
      setNote(first?.error ?? "Couldn't bring that session in.");
    } catch {
      setNote("Couldn't bring that session in.");
    } finally {
      setImportingUrl(null);
    }
  }

  const selectClass =
    "min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-primary-ink/50";

  return (
    <CardPanel contentClassName="space-y-3">
      <Eyebrow>Someone else&apos;s practice</Eyebrow>
      <p className="text-[12px] leading-snug text-muted-foreground">
        A driver you saved in Settings, at a MYLAPS track. Nothing is fetched until you ask.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={transponder}
          onChange={(e) => setTransponder(e.target.value)}
          aria-label="Driver"
          className={selectClass}
        >
          {competitors.map((c) => (
            <option key={c.transponder} value={c.transponder}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={trackId}
          onChange={(e) => setTrackId(e.target.value)}
          aria-label="Track"
          className={selectClass}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void pull()}
          className="btn-surface shrink-0 px-3 py-2 text-[13px] font-medium disabled:opacity-60"
        >
          {busy ? "Looking…" : "Look"}
        </button>
      </div>

      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}

      {sessions && sessions.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border">
          {sessions.map((s) => (
            <li key={s.sessionUrl}>
              <button
                type="button"
                disabled={importingUrl != null}
                onClick={() => void open(s)}
                className="tap-active flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/40 disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">
                    {s.sessionCompletedAtIso ? formatRunDateTime(s.sessionCompletedAtIso) : "Practice"}
                  </span>
                  <span className="ui-caption mt-0.5 block truncate">
                    {s.lapCount} lap{s.lapCount === 1 ? "" : "s"}
                    {s.bestLapSeconds != null ? ` · best ${formatLap(s.bestLapSeconds)}` : ""}
                  </span>
                </span>
                <span className="type-timestamp shrink-0">
                  {importingUrl === s.sessionUrl
                    ? "Bringing in…"
                    : s.importedSessionId
                      ? "Open"
                      : "Bring in"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </CardPanel>
  );
}
