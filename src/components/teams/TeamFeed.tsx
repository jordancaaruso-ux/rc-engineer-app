"use client";

import { useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";
import { TeamFeedEntryCard } from "@/components/teams/TeamFeedEntryCard";
import type { TeamFeedEntryView } from "@/lib/teams/loadTeamFeed";

/**
 * The team's activity spine.
 *
 * Every entry is derived from a logged run — nothing here is authored, so the feed can never
 * go stale because someone forgot to post. The flip side is that quiet weeks look quiet, and
 * that is honest: it means nobody has run.
 *
 * Paging is an explicit "Load older" rather than infinite scroll, which fights the mobile
 * dock and makes comment anchoring unreliable when a push deep-links into a thread.
 */
export function TeamFeed({
  teamId,
  initialEntries,
  initialCursor,
  pinnedRunId,
}: {
  teamId: string;
  initialEntries: TeamFeedEntryView[];
  initialCursor: string | null;
  pinnedRunId?: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOlder() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/feed?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        entries?: TeamFeedEntryView[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not load older runs");
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.runId));
        return [...prev, ...(data.entries ?? []).filter((e) => !seen.has(e.runId))];
      });
      setCursor(data.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load older runs");
    } finally {
      setBusy(false);
    }
  }

  if (entries.length === 0) {
    return (
      <CardPanel contentClassName="px-4 py-6 text-center">
        <p className="text-[14px] font-semibold text-foreground">No shared runs yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Runs appear here as soon as a teammate logs one with sharing on. There is nothing to
          post — the feed fills itself.
        </p>
      </CardPanel>
    );
  }

  return (
    <div className="space-y-3">
      <Eyebrow>Activity</Eyebrow>
      {entries.map((entry) => (
        <TeamFeedEntryCard
          key={entry.runId}
          entry={entry}
          teamId={teamId}
          highlighted={entry.runId === pinnedRunId}
        />
      ))}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      {cursor ? (
        <div className="flex justify-center pt-1">
          <Button variant="outline" onClick={() => void loadOlder()} disabled={busy}>
            {busy ? "Loading…" : "Load older"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
