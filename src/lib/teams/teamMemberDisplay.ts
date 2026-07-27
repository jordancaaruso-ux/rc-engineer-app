import "server-only";
import { prisma } from "@/lib/prisma";
import { getMyNameSettingsForUsers } from "@/lib/appSettings";

export type TeamMemberDisplay = {
  userId: string;
  /** What to print. The viewer's own row reads `You (Dave)`. */
  label: string;
  /** The bare name without the `You (…)` wrapper, for possessives and prompts. */
  name: string;
  isViewer: boolean;
};

/**
 * Display names for a set of team members.
 *
 * Names live per-user in `AppSetting` ("My name" in Settings), not on `User.name`, so the
 * roster matches what each member actually set. Falls back to the account name, then the
 * email, then a short id so a row is never blank.
 *
 * Shared by the team Sessions view and the team feed — both label peer rows, and they must
 * agree or the same person appears under two names.
 */
export async function loadTeamMemberDisplays(
  memberIds: readonly string[],
  viewerId: string
): Promise<Map<string, TeamMemberDisplay>> {
  if (memberIds.length === 0) return new Map();

  const ids = [...memberIds];
  const [members, myNames] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    }),
    getMyNameSettingsForUsers(ids),
  ]);

  const byUserId = new Map<string, TeamMemberDisplay>();
  for (const member of members) {
    const name =
      myNames[member.id]?.trim() ||
      member.name?.trim() ||
      member.email?.trim() ||
      member.id.slice(0, 8);
    const isViewer = member.id === viewerId;
    byUserId.set(member.id, {
      userId: member.id,
      label: isViewer ? `You (${name})` : name,
      name,
      isViewer,
    });
  }
  return byUserId;
}

/** The `Record<userId, label>` shape the existing run-history table expects. */
export function memberDisplayLabelRecord(
  displays: ReadonlyMap<string, TeamMemberDisplay>
): Record<string, string> {
  return Object.fromEntries([...displays.values()].map((d) => [d.userId, d.label]));
}
