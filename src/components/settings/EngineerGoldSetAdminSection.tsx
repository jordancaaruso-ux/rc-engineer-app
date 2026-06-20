"use client";

import { useCallback, useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";

type CandidateRow = {
  id: string;
  status: string;
  question: string;
  answer: string;
  runId: string | null;
  compareRunId: string | null;
  createdAt: string;
  promotedCaseId: string | null;
  reviewer: { score: number; tags: string[]; rationale: string } | null;
};

export function EngineerGoldSetAdminSection() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");

  const load = useCallback(async () => {
    setError(null);
    const sp = new URLSearchParams({ limit: "40", status: statusFilter });
    const res = await fetch(`/api/admin/engineer-gold-set?${sp.toString()}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { candidates: CandidateRow[] };
    setRows(data.candidates);
  }, [statusFilter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load candidates");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function patchCandidate(id: string, action: "promote" | "dismiss", question?: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/engineer-gold-set/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, question }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function reviewPending() {
    setBusy("review");
    setError(null);
    try {
      const res = await fetch("/api/admin/engineer-gold-set/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allPending: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(null);
    }
  }

  async function promoteReviewedWeek() {
    setBusy("bulk");
    setError(null);
    try {
      const res = await fetch("/api/admin/engineer-gold-set/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "promote-reviewed", minScore: 4, sinceDays: 7 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk promote failed");
    } finally {
      setBusy(null);
    }
  }

  async function editQuestion(id: string, current: string) {
    const next = window.prompt("Edit question text", current);
    if (next === null || next.trim() === current.trim()) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/engineer-gold-set/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", question: next.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardPanel className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Gold-set candidates (admin)</h2>
      <p className="text-xs text-muted-foreground leading-snug">
        Your in-app Engineer questions are auto-captured here after each reply. Review, promote to
        the regression set, or export a markdown packet. Sync promoted cases with{" "}
        <code className="text-foreground">npm run engineer:sync-gold-set</code>.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="pending">pending</option>
            <option value="promoted">promoted</option>
            <option value="dismissed">dismissed</option>
            <option value="all">all</option>
          </select>
        </label>
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void load()}>
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void reviewPending()}
        >
          {busy === "review" ? "Reviewing…" : "Review pending"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void promoteReviewedWeek()}
        >
          {busy === "bulk" ? "Promoting…" : "Promote reviewed (7d)"}
        </Button>
        <a
          href={`/api/admin/engineer-gold-set/export?format=markdown&status=${statusFilter}`}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
        >
          Export markdown
        </a>
        <a
          href={`/api/admin/engineer-gold-set/export?format=json&status=${statusFilter}`}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
        >
          Export JSON
        </a>
      </div>
      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No candidates in this filter.</p>
      ) : null}
      <ul className="space-y-3 max-h-[520px] overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 text-xs space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="font-mono text-foreground">{row.status}</span>
              <span>{new Date(row.createdAt).toLocaleString()}</span>
              {row.runId ? <span className="font-mono">run {row.runId.slice(0, 8)}…</span> : null}
              {row.reviewer ? (
                <span className="font-mono text-foreground">
                  reviewer {row.reviewer.score}/5
                </span>
              ) : null}
            </div>
            <p className="text-foreground/90 whitespace-pre-wrap">
              <span className="text-muted-foreground">Q:</span> {row.question}
            </p>
            <p className="text-foreground/80 line-clamp-4 whitespace-pre-wrap">
              <span className="text-muted-foreground">A:</span> {row.answer}
            </p>
            {row.reviewer?.rationale ? (
              <p className="text-muted-foreground italic line-clamp-2">{row.reviewer.rationale}</p>
            ) : null}
            {row.status === "pending" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy === row.id}
                  onClick={() => void patchCandidate(row.id, "promote")}
                >
                  Promote
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={() => editQuestion(row.id, row.question)}
                >
                  Edit question
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={() => void patchCandidate(row.id, "dismiss")}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </CardPanel>
  );
}
