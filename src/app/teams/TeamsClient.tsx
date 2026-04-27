"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type TeamRow = { id: string; name: string; role: string };

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

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

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

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    setAddErr(null);
    setAddBusy(true);
    try {
      await jsonFetch(`/api/teams/${encodeURIComponent(selectedId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setAddEmail("");
      await loadDetail(selectedId);
      await refreshList();
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "Could not add member");
    } finally {
      setAddBusy(false);
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
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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
      </div>

      {selectedId ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
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
                <form onSubmit={handleAddMember} className="border-t border-border pt-3 space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Add member (existing account email, allowlisted)
                  </h3>
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
                      {addBusy ? "Adding…" : "Add"}
                    </button>
                  </div>
                  {addErr ? <p className="text-xs text-destructive">{addErr}</p> : null}
                </form>
              ) : null}

              <div className="border-t border-border pt-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Members</h3>
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
        </div>
      ) : null}
    </div>
  );
}
