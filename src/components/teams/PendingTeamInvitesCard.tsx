"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";

type MyInviteRow = {
  id: string;
  teamId: string;
  teamName: string;
  invitedByLabel: string | null;
  createdAt: string;
};

/**
 * Dashboard surface for pending team invites — renders nothing at all when there are none.
 *
 * Push is the primary channel, but it only lands if the driver installed the PWA or the iOS app and
 * granted permission. This card is the fallback so an invite can't sit unseen forever: the dashboard
 * is the one screen everybody opens. Accept/decline itself lives on `/teams`, where the disclosure
 * ("they see your whole history") is spelled out — this only says an invite is waiting.
 *
 * Deliberately client-side and self-contained rather than threaded through `dashboardServer.ts`:
 * the dashboard model is a large cached aggregate and this needs neither its caching nor its cost.
 */
export function PendingTeamInvitesCard({ className }: { className?: string } = {}) {
  const [invites, setInvites] = useState<MyInviteRow[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/teams/invites", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { invites?: MyInviteRow[] };
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      // Silent: a failed invite check must not put an error on the dashboard.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (invites.length === 0) return null;

  const single = invites.length === 1 ? invites[0] : null;

  return (
    <CardPanel
      className={className}
      contentClassName="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-foreground">
          {single ? `Invite to join ${single.teamName}` : `${invites.length} team invites`}
        </h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          {single?.invitedByLabel
            ? `${single.invitedByLabel} invited you. Nothing is shared until you accept.`
            : "Nothing is shared until you accept."}
        </p>
      </div>
      <Link
        href="/teams"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:brightness-105"
      >
        Review
      </Link>
    </CardPanel>
  );
}
