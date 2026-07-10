"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/utils";

type Team = { id: string; name: string };

/**
 * Apple-style pill selector for the Sessions scope: `My sessions` vs `Teams`.
 * Replaces the old plain-text "View:" links. Two segments always:
 *  - No team memberships → the Teams segment renders muted and routes to `/teams`
 *    (a hint to set a team up), My sessions stays active.
 *  - Exactly one team → Teams selects that team.
 *  - More than one team → a second row of team-name chips appears (only while in
 *    team scope) to pick which team; Teams defaults to the first team.
 *
 * Scope switching navigates to the bare route (dropping filters), matching the
 * previous link behavior — no filter/query is threaded across scopes.
 */
export function SessionsScopeSwitcher({
  teams,
  activeTeamId,
}: {
  teams: Team[];
  activeTeamId: string | null;
}) {
  const router = useRouter();
  const hasTeams = teams.length > 0;
  const scope: "mine" | "team" = activeTeamId ? "team" : "mine";
  const defaultTeamId = activeTeamId ?? teams[0]?.id ?? null;

  function handleChange(next: "mine" | "team") {
    if (next === "mine") {
      if (scope !== "mine") router.push("/runs/history");
      return;
    }
    // Teams
    if (!hasTeams) {
      router.push("/teams");
      return;
    }
    if (defaultTeamId && defaultTeamId !== activeTeamId) {
      router.push(`/runs/history?teamId=${encodeURIComponent(defaultTeamId)}`);
    }
  }

  const options = [
    { value: "mine" as const, label: "My sessions" },
    { value: "team" as const, label: "Teams", muted: !hasTeams },
  ];

  return (
    <div className="space-y-2">
      <SegmentedControl
        options={options}
        value={scope}
        onChange={handleChange}
        ariaLabel="Session scope"
        size="sm"
        className="w-full max-w-xs"
      />
      {scope === "team" && teams.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {teams.map((t) => {
            const active = t.id === activeTeamId;
            return (
              <Link
                key={t.id}
                href={`/runs/history?teamId=${encodeURIComponent(t.id)}`}
                className={cn(
                  "rounded-full border px-3 py-1 font-sans text-xs font-semibold tracking-tight transition-colors",
                  active
                    ? "border-muted-foreground/40 bg-muted text-foreground"
                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                {t.name}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
