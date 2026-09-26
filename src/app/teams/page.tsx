import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { CardPanel } from "@/components/ui/CardPanel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { listTeamsWithActivity } from "@/lib/teams/loadTeamFeed";
import { listPendingInvitesForUser } from "@/lib/teams/pendingInvites";
import { teamJoinLock } from "@/lib/teams/teamLimit";
import { teamsIndexSkipsTo } from "@/lib/teams/teamInviteRules";
import { CreateTeamForm } from "@/components/teams/CreateTeamForm";
import { TeamInvitesCard } from "@/components/teams/TeamInvitesCard";
import { LockedBench } from "@/components/tools/LockedBench";

export const dynamic = "force-dynamic";

/**
 * Team index, and the one place a team invite is answered — the invite push and the dashboard's
 * Review button both land here.
 *
 * With one team there is nothing to choose, so go straight to it; the picker only earns its place
 * when there is more than one. An unanswered invite overrides that: redirecting a driver who is
 * already on one team would carry them straight past the invite they came to answer.
 *
 * The plan's team limit (`teamLimitFor`, founder call 2026-09-24) is drawn here, where it bites:
 * Starter joins no team and Notebook one, so at the limit the New team card becomes a lock and an
 * invite's Accept becomes the door to the plan that holds one more. The two routes refuse too.
 *
 * `?list=1` (`TEAMS_LIST_HREF`) skips the jump: the team page's New team comes here for the form
 * below.
 */
export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header is-echo">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  const [teams, invites, { list }] = await Promise.all([
    listTeamsWithActivity(user.id),
    listPendingInvitesForUser(user.id),
    searchParams,
  ]);

  const soleTeamId = teamsIndexSkipsTo(teams, invites.length, list === "1");
  if (soleTeamId) redirect(`/teams/${soleTeamId}`);

  const joinLock = await teamJoinLock({ id: user.id, email: user.email ?? null }, teams.length);

  return (
    <>
      <header className="page-header is-echo">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">
            {teams.length === 0
              ? "A team turns your teammates' runs into a shared feed — what they ran, what they changed, and what else moved."
              : "Pick a team to open its feed."}
          </p>
        </div>
      </header>

      <section className="page-body max-w-2xl space-y-4">
        {invites.length > 0 ? <TeamInvitesCard invites={invites} joinLock={joinLock} /> : null}

        {teams.length > 0 ? (
          <CardPanel contentClassName="p-0">
            <ul className="divide-y divide-border/40">
              {teams.map((team) => (
                <li key={team.id}>
                  <Link
                    href={`/teams/${team.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="hub-row-title truncate">{team.name}</p>
                      <p className="type-timestamp">
                        {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                        {" · "}
                        {team.lastActivityAt ? (
                          <RelativeTime iso={team.lastActivityAt} fallback="—" display="relative" />
                        ) : (
                          "no shared runs yet"
                        )}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </CardPanel>
        ) : null}

        {joinLock == null ? (
          <CreateTeamForm />
        ) : (
          <LockedBench
            label="New team"
            stretch={false}
            includedIn={joinLock.includedIn}
            line={
              joinLock.includedIn === "pro"
                ? "Be in more than one team."
                : "Share runs with your teammates."
            }
          />
        )}
      </section>
    </>
  );
}
