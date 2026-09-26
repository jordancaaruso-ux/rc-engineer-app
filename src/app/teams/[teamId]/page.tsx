import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Settings, Users } from "lucide-react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { loadTeamFeedModel, teamsIndexSkipsToFor } from "@/lib/teams/loadTeamFeed";
import { TeamFeed } from "@/components/teams/TeamFeed";
import { TeamRosterStrip } from "@/components/teams/TeamRosterStrip";
import { unitSystemForRequest } from "@/lib/units/unitSystemServer";

/**
 * `force-dynamic` with no `revalidate`: a comment must appear the moment it is posted, and
 * a cached team feed during an event is worse than no feed at all.
 */
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ run?: string }>;
};

export default async function TeamFeedPage({ params, searchParams }: Props): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const [user, { teamId }, { run: pinnedRunId }, timeZone] = await Promise.all([
    requireCurrentUser(),
    params,
    searchParams,
    getExplicitTimeZoneForRunFormatting(),
  ]);

  const units = await unitSystemForRequest(user.id);
  const [model, soleTeamId] = await Promise.all([
    loadTeamFeedModel({
      viewerId: user.id,
      teamId,
      timeZone,
      units,
      pinnedRunId: pinnedRunId ?? null,
    }),
    teamsIndexSkipsToFor(user.id),
  ]);
  // Non-members get a 404 rather than a 403 — team existence isn't confirmed to outsiders.
  if (!model) notFound();

  /*
   * Back goes to Teams, except for a driver whose only team this is: `/teams` jumps straight back
   * here for them (`teamsIndexSkipsTo`), so the arrow went nowhere, and a team opened from a
   * comment notification could not be left with back. Settings is where Teams lives (founder,
   * 2026-09-26).
   */
  const backHref = soleTeamId === teamId ? "/settings" : "/teams";

  const lastActivity = Object.values(model.lastActivityByUserId)
    .filter((iso): iso is string => !!iso)
    .sort()
    .at(-1);

  return (
    <>
      <header className="page-header">
        <PageBackLink href={backHref} />
        {/* Title block is the header's ONLY in-flow child, which is what centres it.
            `Manage` used to sit in here beside it on an `ml-auto` and the pair centred
            as a unit, pushing the team name left until the back arrow overlapped it; it
            now lives beside "Team sessions" below, where it reads as one of the page's
            actions rather than as chrome. `min-w-0` stays load-bearing: a flex item's
            automatic minimum size is its CONTENT width, so a long team name would push
            past the column instead of truncating. */}
        <div className="min-w-0">
          {/* Truncation lives on the span, not the `h1`. `truncate` sets `overflow: hidden`,
              and `.page-title::before` — the yellow location tick — is a child pseudo-element,
              so on a long team name the title clipped its own marker away. */}
          <h1 className="page-title max-w-full">
            <span className="block truncate">{model.teamName}</span>
          </h1>
          <p className="page-subtitle">
            {model.members.length} member{model.members.length === 1 ? "" : "s"}
            {lastActivity ? (
              <>
                {" · last activity "}
                <RelativeTime iso={lastActivity} fallback="—" display="relative" />
              </>
            ) : null}
          </p>
        </div>
      </header>

      <section className="page-body max-w-2xl space-y-4">
        <TeamRosterStrip
          members={model.members}
          lastActivityByUserId={model.lastActivityByUserId}
        />

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/runs/history?teamId=${encodeURIComponent(teamId)}`}
            className="tap-active inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition hover:border-primary-ink/40 hover:bg-muted/60"
          >
            <Users className="size-3.5" aria-hidden />
            Team sessions
          </Link>
          <Link
            href={`/teams/${encodeURIComponent(teamId)}/settings`}
            className="tap-active inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition hover:border-primary-ink/40 hover:bg-muted/60"
          >
            <Settings className="size-3.5" aria-hidden />
            Manage
          </Link>
        </div>

        {model.pinnedEntry && !model.entries.some((e) => e.runId === model.pinnedEntry!.runId) ? (
          <TeamFeed
            teamId={teamId}
            initialEntries={[model.pinnedEntry]}
            initialCursor={null}
            pinnedRunId={model.pinnedEntry.runId}
          />
        ) : null}

        <TeamFeed
          teamId={teamId}
          initialEntries={model.entries}
          initialCursor={model.nextCursor}
          pinnedRunId={model.pinnedEntry?.runId ?? null}
        />
      </section>
    </>
  );
}
