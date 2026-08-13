import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { CardPanel } from "@/components/ui/CardPanel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { listTeamsWithActivity } from "@/lib/teams/loadTeamFeed";
import { CreateTeamForm } from "@/components/teams/CreateTeamForm";

export const dynamic = "force-dynamic";

/**
 * Team index. With one team there is nothing to choose, so go straight to it; the picker
 * only earns its place when there is more than one.
 */
export default async function TeamsPage(): Promise<ReactNode> {
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
  const teams = await listTeamsWithActivity(user.id);

  if (teams.length === 1) redirect(`/teams/${teams[0].id}`);

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

        <CreateTeamForm />
      </section>
    </>
  );
}
