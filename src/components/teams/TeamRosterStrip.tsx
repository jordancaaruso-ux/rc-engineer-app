import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import type { TeamMemberDisplay } from "@/lib/teams/teamMemberDisplay";

/**
 * Who's in the team and how recently each of them last shared a run.
 *
 * This sits above the feed on purpose. Teammates log at very different latencies — some
 * between heats, some that evening — so "Kirra · 3 days ago" is the context that stops a
 * quiet feed reading as a broken one.
 */
export function TeamRosterStrip({
  members,
  lastActivityByUserId,
}: {
  members: TeamMemberDisplay[];
  lastActivityByUserId: Record<string, string | null>;
}) {
  if (members.length === 0) return null;

  return (
    <CardPanel contentClassName="p-0">
      <div className="px-4 pt-3">
        <Eyebrow>Roster</Eyebrow>
      </div>
      <ul className="divide-y divide-border/40">
        {members.map((member) => {
          const last = lastActivityByUserId[member.userId] ?? null;
          return (
            <li key={member.userId} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="ui-title truncate text-[13px] font-semibold text-foreground">
                {member.label}
              </span>
              {last ? (
                <RelativeTime iso={last} fallback="—" display="relative" className="shrink-0" />
              ) : (
                <span className="type-timestamp shrink-0">No shared runs</span>
              )}
            </li>
          );
        })}
      </ul>
    </CardPanel>
  );
}
