"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { ModerationSheet, MoreButton } from "@/components/moderation/ModerationSheet";

/**
 * Names are the ones the team page prints (`loadTeamMemberDisplays`): "My name", else the account
 * name, else the email. So an email shows only for a driver who set no name, and only once.
 */
type MemberRow = {
  userId: string;
  role: string;
  joinedAt: string;
  /** The row's name. The viewer's own reads `You (Noah)`, as on the team page. */
  label: string;
  /** The bare name, for the More sheet. */
  name: string;
  /** The viewer blocked this teammate: their runs and comments are out of the viewer's feed. */
  blockedByViewer?: boolean;
};

/** Invited, not yet answered — not a member, so nothing is shared with them yet. */
type PendingInviteRow = {
  id: string;
  createdAt: string;
  name: string;
};

/** Answered no. Sent to admins only. */
type DeclinedInviteRow = {
  id: string;
  respondedAt: string;
  name: string;
  /** What Invite again sends, as if typed into the Invite form. */
  email: string | null;
};

type TeamDetail = {
  id: string;
  name: string;
  createdAt: string;
  viewerUserId: string;
  viewerRole: string;
  members: MemberRow[];
  pendingInvites: PendingInviteRow[];
  declinedInvites?: DeclinedInviteRow[];
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const inputClass =
  "min-h-9 w-full rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary-ink/40 focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Team administration, kept off the feed page.
 *
 * Confirmations are inline two-step buttons rather than `window.confirm` — native dialogs
 * look broken inside the Capacitor iOS shell, and an in-page confirm can say exactly what
 * is about to happen.
 *
 * Inviting does NOT add anyone: it sends an invite the other driver answers on `/teams`. So the
 * person lands in "Invited", not "Members", and stays there until they accept — without that card
 * an invite looked like a form that cleared itself and did nothing. A decline stays there too, for
 * admins, as Declined with Invite again: before, it just vanished and read as a glitch.
 */
export function TeamSettingsClient({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [pendingWithdraw, setPendingWithdraw] = useState<string | null>(null);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);

  const [reinviting, setReinviting] = useState<string | null>(null);
  const [reinviteErr, setReinviteErr] = useState<{ id: string; message: string } | null>(null);

  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // Report / Block for one teammate (App Store guideline 1.2).
  const [moreFor, setMoreFor] = useState<MemberRow | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await jsonFetch<{ team: TeamDetail }>(`/api/teams/${encodeURIComponent(teamId)}`);
      setDetail(data.team);
      setRenameName(data.team.name);
    } catch (e) {
      setDetail(null);
      setLoadErr(e instanceof Error ? e.message : "Could not load team");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const name = renameName.trim();
    if (!name || renameBusy) return;
    setRenameErr(null);
    setRenameBusy(true);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(teamId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await load();
      router.refresh();
    } catch (err) {
      setRenameErr(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviteBusy) return;
    setInviteErr(null);
    setInviteBusy(true);
    try {
      // Creates a pending invite and pushes it; the membership only exists once they accept.
      await jsonFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setInviteEmail("");
      await load();
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setInviteBusy(false);
    }
  }

  /** The Invite form's own call: it turns their declined invite back to pending, sent now. */
  async function reinvite(invite: DeclinedInviteRow) {
    if (!invite.email || reinviting) return;
    setReinviteErr(null);
    setReinviting(invite.id);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invite.email }),
      });
      await load();
    } catch (err) {
      setReinviteErr({
        id: invite.id,
        message: err instanceof Error ? err.message : "Could not send invite",
      });
    } finally {
      setReinviting(null);
    }
  }

  async function withdrawInvite(inviteId: string) {
    setWithdrawErr(null);
    try {
      await jsonFetch(
        `/api/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" }
      );
      setPendingWithdraw(null);
      await load();
    } catch (err) {
      setWithdrawErr(err instanceof Error ? err.message : "Could not withdraw invite");
    }
  }

  async function removeMember(targetUserId: string) {
    setActionErr(null);
    try {
      await jsonFetch(
        `/api/teams/${encodeURIComponent(teamId)}/members?userId=${encodeURIComponent(targetUserId)}`,
        { method: "DELETE" }
      );
      setPendingRemoval(null);
      await load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function leaveTeam() {
    setActionErr(null);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, { method: "DELETE" });
      router.push("/teams");
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Could not leave team");
      setPendingLeave(false);
    }
  }

  if (loading) {
    return <p className="text-[13px] text-muted-foreground">Loading team…</p>;
  }
  if (loadErr || !detail) {
    return <p className="text-[13px] text-destructive">{loadErr ?? "Team not found"}</p>;
  }

  const isAdmin = detail.viewerRole === "admin";
  const pendingInvites = detail.pendingInvites;
  const declinedInvites = detail.declinedInvites ?? [];

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <CardPanel contentClassName="space-y-2.5">
          <Eyebrow>Team name</Eyebrow>
          <form onSubmit={handleRename} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="rename-team" className="sr-only">
                Team name
              </label>
              <input
                id="rename-team"
                className={inputClass}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={renameBusy || !renameName.trim()}>
              {renameBusy ? "Saving…" : "Save"}
            </Button>
          </form>
          {renameErr ? <p className="text-[12px] text-destructive">{renameErr}</p> : null}
        </CardPanel>
      ) : null}

      {isAdmin ? (
        <CardPanel contentClassName="space-y-2.5">
          <Eyebrow>Invite</Eyebrow>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="invite-member" className="sr-only">
                Email
              </label>
              <input
                id="invite-member"
                className={inputClass}
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <Button type="submit" disabled={inviteBusy || !inviteEmail.trim()}>
              {inviteBusy ? "Sending…" : "Invite"}
            </Button>
          </form>
          {inviteErr ? <p className="text-[12px] text-destructive">{inviteErr}</p> : null}
        </CardPanel>
      ) : null}

      {pendingInvites.length > 0 || declinedInvites.length > 0 ? (
        <CardPanel contentClassName="p-0">
          <div className="eyebrow-band px-4">
            <Eyebrow className="mb-0">Invited</Eyebrow>
          </div>
          <ul className="divide-y divide-border/40">
            {pendingInvites.map((invite) => (
              <li key={invite.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ui-title truncate text-[13px] font-semibold text-foreground">
                      {invite.name}
                    </p>
                    <p className="type-timestamp truncate">
                      Sent <RelativeTime iso={invite.createdAt} fallback="recently" />
                    </p>
                  </div>
                  {isAdmin ? (
                    pendingWithdraw === invite.id ? (
                      <div className="flex shrink-0 gap-2">
                        <Button variant="outline" onClick={() => void withdrawInvite(invite.id)}>
                          Confirm
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPendingWithdraw(null);
                            setWithdrawErr(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="type-timestamp shrink-0 hover:text-destructive"
                        onClick={() => {
                          setPendingWithdraw(invite.id);
                          setWithdrawErr(null);
                        }}
                      >
                        Withdraw
                      </button>
                    )
                  ) : null}
                </div>
                {pendingWithdraw === invite.id && withdrawErr ? (
                  <p className="mt-1.5 text-[12px] text-destructive">{withdrawErr}</p>
                ) : null}
              </li>
            ))}
            {declinedInvites.map((invite) => (
              <li key={invite.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ui-title truncate text-[13px] font-semibold text-foreground">
                      {invite.name}
                    </p>
                    <p className="type-timestamp truncate">
                      Declined <RelativeTime iso={invite.respondedAt} fallback="recently" />
                    </p>
                  </div>
                  {isAdmin && invite.email ? (
                    <button
                      type="button"
                      className="type-timestamp shrink-0 hover:text-foreground disabled:opacity-60"
                      disabled={reinviting != null}
                      onClick={() => void reinvite(invite)}
                    >
                      {reinviting === invite.id ? "Sending…" : "Invite again"}
                    </button>
                  ) : null}
                </div>
                {reinviteErr?.id === invite.id ? (
                  <p className="mt-1.5 text-[12px] text-destructive">{reinviteErr.message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </CardPanel>
      ) : null}

      <CardPanel contentClassName="p-0">
        <div className="eyebrow-band px-4">
          <Eyebrow className="mb-0">Members</Eyebrow>
        </div>
        <ul className="divide-y divide-border/40">
          {detail.members.map((member) => {
            const isSelf = member.userId === detail.viewerUserId;
            return (
              <li key={member.userId} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ui-title truncate text-[13px] font-semibold text-foreground">
                      {member.label}
                    </p>
                    <p className="type-timestamp truncate">
                      {member.blockedByViewer ? "Blocked · " : ""}
                      {member.role === "admin" ? "Admin" : "Member"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isAdmin && !isSelf ? (
                      pendingRemoval === member.userId ? (
                        <div className="flex shrink-0 gap-2">
                          <Button variant="outline" onClick={() => void removeMember(member.userId)}>
                            Confirm
                          </Button>
                          <Button variant="outline" onClick={() => setPendingRemoval(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="type-timestamp shrink-0 hover:text-destructive"
                          onClick={() => setPendingRemoval(member.userId)}
                        >
                          Remove
                        </button>
                      )
                    ) : null}
                    {!isSelf && pendingRemoval !== member.userId ? (
                      <MoreButton
                        label={`More for ${member.name}`}
                        onClick={() => setMoreFor(member)}
                      />
                    ) : null}
                  </div>
                </div>
                {pendingRemoval === member.userId ? (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    They stop seeing this team&apos;s feed and sessions. Their own runs are untouched.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardPanel>

      <ModerationSheet
        open={moreFor !== null}
        onClose={() => setMoreFor(null)}
        title={moreFor?.name ?? "Teammate"}
        report={
          moreFor
            ? {
                kind: "driver",
                targetId: moreFor.userId,
                teamId: detail.id,
                label: `Report ${moreFor.name}`,
              }
            : undefined
        }
        block={
          moreFor
            ? {
                userId: moreFor.userId,
                name: moreFor.name,
                blocked: Boolean(moreFor.blockedByViewer),
              }
            : undefined
        }
        onBlockChange={() => {
          void load();
          router.refresh();
        }}
      />

      <CardPanel contentClassName="space-y-2.5">
        <Eyebrow>Leave team</Eyebrow>
        {pendingLeave ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              You&apos;ll lose access to this team&apos;s feed and shared sessions. Your own runs and
              comments stay.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void leaveTeam()}>
                Leave this team
              </Button>
              <Button variant="outline" onClick={() => setPendingLeave(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button variant="outline" onClick={() => setPendingLeave(true)}>
            Leave team
          </Button>
        )}
        {actionErr ? <p className="text-[12px] text-destructive">{actionErr}</p> : null}
      </CardPanel>
    </div>
  );
}
