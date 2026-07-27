"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

type TeamRow = { id: string; name: string; role: string };

type MemberRow = {
  userId: string;
  role: string;
  joinedAt: string;
  name: string | null;
  email: string | null;
};

type PendingInviteRow = {
  id: string;
  createdAt: string;
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
  pendingInvites: PendingInviteRow[];
};

/** An invite addressed to the viewer, from `GET /api/teams/invites`. */
type MyInviteRow = {
  id: string;
  teamId: string;
  teamName: string;
  invitedByLabel: string | null;
  createdAt: string;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function TeamsClient() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const [myInvites, setMyInvites] = useState<MyInviteRow[]>([]);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setListErr(null);
    try {
      const data = await jsonFetch<{ teams: TeamRow[] }>("/api/teams");
      setTeams(Array.isArray(data.teams) ? data.teams : []);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Could not load teams");
      setTeams([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (teamId: string) => {
    setDetailErr(null);
    setLoadingDetail(true);
    try {
      const data = await jsonFetch<{ team: TeamDetail }>(`/api/teams/${encodeURIComponent(teamId)}`);
      setDetail(data.team);
      setRenameName(data.team.name);
    } catch (e) {
      setDetail(null);
      setDetailErr(e instanceof Error ? e.message : "Could not load team");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const refreshMyInvites = useCallback(async () => {
    try {
      const data = await jsonFetch<{ invites: MyInviteRow[] }>("/api/teams/invites");
      setMyInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      // Non-fatal: the teams list is still usable if the invite inbox fails to load.
      setMyInvites([]);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    void refreshMyInvites();
  }, [refreshList, refreshMyInvites]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setCreateErr(null);
    setCreateBusy(true);
    try {
      const { team } = await jsonFetch<{ team: { id: string; name: string } }>("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewTeamName("");
      await refreshList();
      setSelectedId(team.id);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    setAddErr(null);
    setAddNotice(null);
    setAddBusy(true);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(selectedId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setAddEmail("");
      // They are not a member yet — say so, or the empty members table reads as a failure.
      setAddNotice(`Invite sent to ${email}. They join once they accept.`);
      await loadDetail(selectedId);
      await refreshList();
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setAddBusy(false);
    }
  }

  async function handleRespondToInvite(inviteId: string, action: "accept" | "decline") {
    setInviteErr(null);
    setInviteBusyId(inviteId);
    try {
      await jsonFetch(`/api/teams/invites/${encodeURIComponent(inviteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refreshMyInvites();
      await refreshList();
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : "Could not respond to that invite");
    } finally {
      setInviteBusyId(null);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!selectedId) return;
    if (!window.confirm("Withdraw this invite?")) return;
    try {
      await jsonFetch(
        `/api/teams/${encodeURIComponent(selectedId)}/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" }
      );
      await loadDetail(selectedId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not withdraw invite");
    }
  }

  async function handleRemoveMember(mode: "leave" | "remove", targetUserId: string) {
    if (!selectedId) return;
    const ok = window.confirm(
      mode === "leave" ? "Leave this team?" : "Remove this member from the team?"
    );
    if (!ok) return;
    try {
      const url =
        mode === "leave"
          ? `/api/teams/${encodeURIComponent(selectedId)}/members`
          : `/api/teams/${encodeURIComponent(selectedId)}/members?userId=${encodeURIComponent(targetUserId)}`;
      await jsonFetch(url, { method: "DELETE" });
      if (mode === "leave") {
        setSelectedId(null);
        setDetail(null);
      } else {
        await loadDetail(selectedId);
      }
      await refreshList();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    const name = renameName.trim();
    if (!name) return;
    setRenameErr(null);
    setRenameBusy(true);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await loadDetail(selectedId);
      await refreshList();
    } catch (err) {
      setRenameErr(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameBusy(false);
    }
  }

  const isAdmin = detail?.viewerRole === "admin";

  return (
    <div className="space-y-6 max-w-4xl">
      {myInvites.length > 0 ? (
        <CardPanel contentClassName="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {myInvites.length === 1 ? "Team invite" : `Team invites (${myInvites.length})`}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1">
              Joining shares your runs, setups and lap data with everyone on the team — including
              runs you logged before you joined. You can leave at any time, which ends their access.
            </p>
          </div>
          {inviteErr ? <p className="text-xs text-destructive">{inviteErr}</p> : null}
          <ul className="space-y-2">
            {myInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm text-foreground">
                  {inv.teamName}
                  {inv.invitedByLabel ? (
                    <span className="text-muted-foreground text-xs"> · from {inv.invitedByLabel}</span>
                  ) : null}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={inviteBusyId === inv.id}
                    onClick={() => void handleRespondToInvite(inv.id, "accept")}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:brightness-105 disabled:opacity-50"
                  >
                    {inviteBusyId === inv.id ? "Joining…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={inviteBusyId === inv.id}
                    onClick={() => void handleRespondToInvite(inv.id, "decline")}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </CardPanel>
      ) : null}

      <CardPanel contentClassName="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Create team</h2>
        <form onSubmit={handleCreateTeam} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 flex-1 min-w-[200px]">
            <label className="text-[10px] text-muted-foreground">Name</label>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="e.g. Club practice group"
            />
          </div>
          <button
            type="submit"
            disabled={createBusy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:brightness-105 disabled:opacity-50"
          >
            {createBusy ? "Creating…" : "Create"}
          </button>
        </form>
        {createErr ? <p className="text-xs text-destructive">{createErr}</p> : null}
      </CardPanel>

      <CardPanel contentClassName="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Your teams</h2>
        {loadingList ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
        {listErr ? <p className="text-xs text-destructive">{listErr}</p> : null}
        {!loadingList && teams.length === 0 ? (
          <p className="text-xs text-muted-foreground">You are not in any team yet.</p>
        ) : (
          <ul className="space-y-1">
            {teams.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm transition ${
                    selectedId === t.id ? "bg-muted font-medium" : "hover:bg-muted/60"
                  }`}
                >
                  <span>{t.name}</span>
                  <span className="text-muted-foreground text-xs ml-2">({t.role})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>

      {selectedId ? (
        <CardPanel contentClassName="space-y-4">
          {loadingDetail ? <p className="text-xs text-muted-foreground">Loading team…</p> : null}
          {detailErr ? <p className="text-xs text-destructive">{detailErr}</p> : null}
          {detail ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{detail.name}</h2>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    You are <span className="font-medium text-foreground">{detail.viewerRole}</span>.{" "}
                    <Link
                      href={`/runs/history?teamId=${encodeURIComponent(detail.id)}`}
                      className="text-accent underline"
                    >
                      View team sessions
                    </Link>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveMember("leave", detail.viewerUserId)}
                  className="text-xs rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-muted"
                >
                  Leave team
                </button>
              </div>

              {isAdmin ? (
                <form onSubmit={handleRename} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <div className="space-y-1 flex-1 min-w-[200px]">
                    <label className="text-[10px] text-muted-foreground">Rename team</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={renameBusy}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {renameBusy ? "Saving…" : "Save name"}
                  </button>
                  {renameErr ? <p className="text-xs text-destructive w-full">{renameErr}</p> : null}
                </form>
              ) : null}

              {isAdmin ? (
                <form onSubmit={handleInviteMember} className="border-t border-border pt-3 space-y-2">
                  <Eyebrow>Invite member (existing account email, allowlisted)</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      type="email"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      placeholder="peer@example.com"
                    />
                    <button
                      type="submit"
                      disabled={addBusy}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {addBusy ? "Sending…" : "Send invite"}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    They get a notification and choose whether to join. Nobody is added to a team
                    without accepting.
                  </p>
                  {addNotice ? <p className="text-xs text-muted-foreground">{addNotice}</p> : null}
                  {addErr ? <p className="text-xs text-destructive">{addErr}</p> : null}
                </form>
              ) : null}

              {detail.pendingInvites.length > 0 ? (
                <div className="border-t border-border pt-3">
                  <Eyebrow className="mb-2">Invited — awaiting response</Eyebrow>
                  <ul className="space-y-1">
                    {detail.pendingInvites.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {inv.name ?? inv.email ?? "—"}
                          {inv.name && inv.email ? (
                            <span className="text-xs"> · {inv.email}</span>
                          ) : null}
                        </span>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="text-xs text-destructive hover:underline"
                            onClick={() => void handleRevokeInvite(inv.id)}
                          >
                            Withdraw
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="border-t border-border pt-3">
                <Eyebrow className="mb-2">Members</Eyebrow>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-2">Name</th>
                        <th className="py-2 pr-2">Email</th>
                        <th className="py-2 pr-2">Role</th>
                        <th className="py-2 w-[6rem]" />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.members.map((m) => (
                        <tr key={m.userId} className="border-b border-border/60">
                          <td className="py-2 pr-2">{m.name ?? "—"}</td>
                          <td className="py-2 pr-2 text-muted-foreground">{m.email ?? "—"}</td>
                          <td className="py-2 pr-2">{m.role}</td>
                          <td className="py-2">
                            {isAdmin && m.userId !== detail.viewerUserId ? (
                              <button
                                type="button"
                                className="text-xs text-destructive hover:underline"
                                onClick={() => void handleRemoveMember("remove", m.userId)}
                              >
                                Remove
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </CardPanel>
      ) : null}
    </div>
  );
}
