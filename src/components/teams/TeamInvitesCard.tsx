"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import type { PaidTier } from "@/lib/entitlementLogic";
import type { PendingInviteForViewer } from "@/lib/teams/pendingInvites";

type InviteAction = "accept" | "decline";

/**
 * Where a team invite is answered — the consent step itself, and the only UI that calls
 * `POST /api/teams/invites/[inviteId]`.
 *
 * It went missing once: it lived in the old all-in-one Teams client, the Teams feed rework deleted
 * that file, and the invite branch merged in on top without it. Invites kept sending, pushing and
 * showing on the dashboard, and the dashboard's Review button led here to a page with nothing to
 * press. Keep it on `/teams` — the push and the dashboard card both link to that URL.
 *
 * The one line of copy is the disclosure, not a how-to: accepting shares the driver's whole run
 * history with the team, retroactively, and the API comment on the accept route requires the UI to
 * say so before the call is made.
 *
 * `joinLock` is the plan's team limit (`teamLimitFor`, founder call 2026-09-24): Starter joins no
 * team, Notebook one. Then Accept becomes the door to the plan that holds one more, the line says
 * which plan that is, and Decline stays. The invite stays pending, so it can still be accepted
 * after an upgrade.
 */
export function TeamInvitesCard({
  invites,
  joinLock = null,
}: {
  invites: PendingInviteForViewer[];
  joinLock?: { includedIn: PaidTier } | null;
}) {
  const router = useRouter();
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ id: string; action: InviteAction } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const rows = invites.filter((invite) => !answeredIds.includes(invite.id));
  if (rows.length === 0) return null;

  async function respond(invite: PendingInviteForViewer, action: InviteAction) {
    if (busy) return;
    setBusy({ id: invite.id, action });
    setError(null);
    try {
      const res = await fetch(`/api/teams/invites/${encodeURIComponent(invite.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not answer that invite");

      if (action === "accept") {
        // Straight into the team they just joined. `busy` stays set so nothing can be pressed
        // twice while the feed loads.
        router.push(`/teams/${encodeURIComponent(invite.teamId)}`);
        router.refresh();
        return;
      }
      setAnsweredIds((ids) => [...ids, invite.id]);
      setBusy(null);
      // The page may now have exactly one team and no invites, which is its cue to open that team.
      router.refresh();
    } catch (err) {
      setError({
        id: invite.id,
        message: err instanceof Error ? err.message : "Could not answer that invite",
      });
      setBusy(null);
    }
  }

  return (
    <CardPanel contentClassName="p-0">
      <div className="eyebrow-band px-4">
        <Eyebrow className="mb-0">{rows.length === 1 ? "Invite" : "Invites"}</Eyebrow>
      </div>
      <ul className="divide-y divide-border/40">
        {rows.map((invite) => {
          const rowBusy = busy?.id === invite.id ? busy.action : null;
          return (
            <li key={invite.id} className="space-y-2.5 px-4 py-3">
              <div className="min-w-0">
                <p className="ui-title truncate text-[13px] font-semibold text-foreground">
                  {invite.teamName}
                </p>
                {invite.invitedByLabel ? (
                  <p className="type-timestamp truncate">From {invite.invitedByLabel}</p>
                ) : null}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {joinLock == null
                  ? "The team sees your runs, past ones too. You see theirs."
                  : joinLock.includedIn === "pro"
                    ? `More than one team is included in ${TIER_LABELS.pro}.`
                    : `Teams are included in ${TIER_LABELS[joinLock.includedIn]}.`}
              </p>
              <div className="flex gap-2">
                {joinLock == null ? (
                  <Button
                    disabled={busy != null}
                    aria-busy={rowBusy === "accept"}
                    onClick={() => void respond(invite, "accept")}
                  >
                    {rowBusy === "accept" ? "Joining…" : "Accept"}
                  </Button>
                ) : (
                  // Hidden inside the app, which sells nothing (`web-only`, globals.css).
                  <ButtonLink href={`/billing?plan=${joinLock.includedIn}`} className="web-only">
                    Upgrade to {TIER_LABELS[joinLock.includedIn]}
                  </ButtonLink>
                )}
                <Button
                  variant="outline"
                  disabled={busy != null}
                  aria-busy={rowBusy === "decline"}
                  onClick={() => void respond(invite, "decline")}
                >
                  {rowBusy === "decline" ? "Declining…" : "Decline"}
                </Button>
              </div>
              {error?.id === invite.id ? (
                <p className="text-[12px] text-destructive">{error.message}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </CardPanel>
  );
}
