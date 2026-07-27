"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";

type MemberRow = {
  userId: string;
  role: string;
  joinedAt: string;
  name: string | null;
  email: string | null;
};

type TeamDetail = {
  id: string;
  name: string;
  createdAt: string;
  viewerUserId: string;
  viewerRole: string;
  members: MemberRow[];
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const inputClass =
  "min-h-9 w-full rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Team administration, kept off the feed page.
 *
 * Confirmations are inline two-step buttons rather than `window.confirm` — native dialogs
 * look broken inside the Capacitor iOS shell, and an in-page confirm can say exactly what
 * is about to happen.
 */
export function TeamSettingsClient({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

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

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    const email = addEmail.trim().toLowerCase();
    if (!email || addBusy) return;
    setAddErr(null);
    setAddBusy(true);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setAddEmail("");
      await load();
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "Could not add member");
    } finally {
      setAddBusy(false);
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
          <Eyebrow>Add member</Eyebrow>
          <p className="text-[13px] text-muted-foreground">
            They need an existing account on the sign-in allowlist. Invites for new people
            aren&apos;t built yet.
          </p>
          <form onSubmit={handleAddMember} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="add-member" className="sr-only">
                Member email
              </label>
              <input
                id="add-member"
                className={inputClass}
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <Button type="submit" disabled={addBusy || !addEmail.trim()}>
              {addBusy ? "Adding…" : "Add"}
            </Button>
          </form>
          {addErr ? <p className="text-[12px] text-destructive">{addErr}</p> : null}
        </CardPanel>
      ) : null}

      <CardPanel contentClassName="p-0">
        <div className="px-4 pt-3">
          <Eyebrow>Members</Eyebrow>
        </div>
        <ul className="divide-y divide-border/40">
          {detail.members.map((member) => {
            const isSelf = member.userId === detail.viewerUserId;
            return (
              <li key={member.userId} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ui-title truncate text-[13px] font-semibold text-foreground">
                      {member.name ?? member.email ?? "—"}
                      {isSelf ? " (you)" : ""}
                    </p>
                    <p className="type-timestamp truncate">
                      {member.email ?? "—"} · {member.role}
                    </p>
                  </div>
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
