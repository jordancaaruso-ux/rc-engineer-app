import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { assertUserInTeam } from "@/lib/teamAccess";
import { prisma } from "@/lib/prisma";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { TeamSettingsClient } from "@/components/teams/TeamSettingsClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ teamId: string }> };

/**
 * Team administration lives on its own route rather than in a modal, so the forms stay off
 * the feed's hot path — admin work is rare, the feed is the thing people open.
 */
export default async function TeamSettingsPage({ params }: Props): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Team settings</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  const { teamId } = await params;

  // `assertUserInTeam` returns a boolean rather than throwing — it must be checked.
  if (!(await assertUserInTeam(teamId, user.id))) notFound();

  const team = await prisma.team.findFirst({
    where: { id: teamId },
    select: { id: true, name: true },
  });
  if (!team) notFound();

  return (
    <>
      <header className="page-header">
        <PageBackLink href={`/teams/${team.id}`} />
        <div>
          <h1 className="page-title">Team settings</h1>
          <p className="page-subtitle">Name, members, and leaving the team.</p>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <TeamSettingsClient teamId={team.id} />
      </section>
    </>
  );
}
