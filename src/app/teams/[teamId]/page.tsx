import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Settings, Users } from "lucide-react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { loadTeamFeedModel } from "@/lib/teams/loadTeamFeed";
import { TeamFeed } from "@/components/teams/TeamFeed";
import { TeamRosterStrip } from "@/components/teams/TeamRosterStrip";

/**
 * `force-dynamic` with no `revalidate`: a comment must appear the moment it is posted, and
 * a cached team feed during a race meeting is worse than no feed at all.
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

  const model = await loadTeamFeedModel({
    viewerId: user.id,
    teamId,
    timeZone,
    pinnedRunId: pinnedRunId ?? null,
  });
  // Non-members get a 404 rather than a 403 — team existence isn't confirmed to outsiders.
  if (!model) notFound();

  const lastActivity = Object.values(model.lastActivityByUserId)
    .filter((iso): iso is string => !!iso)
    .sort()
    .at(-1);

  return (
    <>
      <header className="page-header">
        <PageBackLink href="/teams" />
        {/* Three classes, each load-bearing:
              flex-1   — without it the wrapper shrinks to its contents and `Manage` ends up
                         glued to the team name, 371px short of the card edge below it.
              min-w-0  — a flex item's automatic minimum size is its CONTENT width, so a long
                         team name pushed the wrapper (and Manage) straight past the column
                         instead of truncating.
              ml-auto  — on the link rather than `justify-between` here, because the desktop
                         header rule in globals.css forces `justify-content: flex-start` on any
                         `.page-header` child holding the title. An auto margin it cannot override. */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
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
          <Link
            href={`/teams/${encodeURIComponent(teamId)}/settings`}
            className="tap-active ml-auto inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition hover:border-accent/40 hover:bg-muted/60"
          >
            <Settings className="size-3.5" aria-hidden />
            Manage
          </Link>
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
            className="tap-active inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition hover:border-accent/40 hover:bg-muted/60"
          >
            <Users className="size-3.5" aria-hidden />
            Team sessions
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
