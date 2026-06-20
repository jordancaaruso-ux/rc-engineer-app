"use client";

import { useCallback, useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";

type RatingRow = {
  id: string;
  stars: number;
  note: string | null;
  createdAt: string;
  user: { id: string; email: string | null; name: string | null };
  message: {
    id: string;
    content: string;
    metadataJson: unknown;
    thread: { id: string; primaryRunId: string | null; compareRunId: string | null };
  };
  contextSnapshot: {
    question?: string;
    answer?: string;
    runId?: string | null;
    compareRunId?: string | null;
    kbSections?: string[];
  };
};

export function EngineerFeedbackAdminSection() {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    setError(null);
    const sp = new URLSearchParams({ limit: "30" });
    if (opts?.cursor) sp.set("cursor", opts.cursor);
    const res = await fetch(`/api/admin/engineer-ratings?${sp.toString()}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { ratings: RatingRow[]; nextCursor: string | null };
    setRows((prev) => (opts?.append ? [...prev, ...data.ratings] : data.ratings));
    setNextCursor(data.nextCursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load ratings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setCursor(nextCursor);
    try {
      await load({ append: true, cursor: nextCursor });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    }
  }

  async function exportFeedback() {
    setExportBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/engineer-feedback/export", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { message?: string };
        setSuccess(data.message ?? "Exported to docs/engineer-feedback/");
      } else {
        const blob = await res.blob();
        const stamp = new Date().toISOString().slice(0, 10);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `engineer-feedback-inbox-${stamp}.zip`;
        anchor.click();
        URL.revokeObjectURL(url);
        setSuccess("Downloaded engineer-feedback-inbox.zip");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <CardPanel className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Engineer feedback (admin)</h2>
      <p className="text-xs text-muted-foreground leading-snug">
        Founder-only 0–10 ratings from Engineer chat. Export for Cursor agents via the button below
        (or <code className="text-foreground">npm run engineer:export-feedback</code> locally). See{" "}
        <code className="text-foreground">docs/ENGINEER_ITERATION.md</code>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={exportBusy}
          onClick={() => void exportFeedback()}
        >
          {exportBusy ? "Exporting…" : "Export feedback"}
        </Button>
      </div>
      {success ? <p className="text-xs text-foreground">{success}</p> : null}
      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ratings yet.</p>
      ) : null}
      <ul className="space-y-3 max-h-[420px] overflow-y-auto">
        {rows.map((r) => {
          const ctx = r.contextSnapshot ?? {};
          const question = ctx.question ?? "(no question captured)";
          return (
            <li key={r.id} className="rounded-lg border border-border/70 px-3 py-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span
                  className={
                    r.stars <= 6 ? "font-mono text-destructive" : "font-mono text-foreground"
                  }
                >
                  {r.stars}/10
                </span>
                <span>{r.user.email ?? r.user.id}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {ctx.runId ? <span className="font-mono">run {ctx.runId.slice(0, 8)}…</span> : null}
              </div>
              <p className="text-foreground/90">
                <span className="text-muted-foreground">Q:</span> {question}
              </p>
              <p className="text-foreground/80 line-clamp-3 whitespace-pre-wrap">
                <span className="text-muted-foreground">A:</span> {r.message.content}
              </p>
              {r.note ? (
                <p className="text-muted-foreground italic whitespace-pre-wrap">Note: {r.note}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {nextCursor ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="text-xs text-primary hover:underline"
        >
          Load more{cursor ? "…" : ""}
        </button>
      ) : null}
    </CardPanel>
  );
}
