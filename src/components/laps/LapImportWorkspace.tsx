"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type SessionRow = {
  id: string;
  createdAt: string;
  sourceUrl: string;
  parserId: string;
  sourceType: string;
  linkedRunId: string | null;
  linkedEventId: string | null;
};

type ImportResultRow =
  | { url: string; success: true; importedSessionId: string }
  | { url: string; success: false; error: string };

export function LapImportWorkspace() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<ImportResultRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailJson, setDetailJson] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setListErr(null);
    try {
      const res = await fetch("/api/lap-time-sessions");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setListErr((data as { error?: string })?.error ?? "Could not load sessions.");
        return;
      }
      setSessions(Array.isArray((data as { sessions?: SessionRow }).sessions) ? (data as { sessions: SessionRow[] }).sessions : []);
    } catch {
      setListErr("Could not load sessions.");
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function onImport() {
    const urls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setHint("Paste one or more URLs (one per line).");
      return;
    }
    setBusy(true);
    setHint(null);
    setLastResults([]);
    try {
      const res = await fetch("/api/lap-time-sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setHint((data as { error?: string })?.error ?? "Import failed.");
        return;
      }
      const raw = (data as { results?: unknown }).results;
      const mapped: ImportResultRow[] = [];
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (!r || typeof r !== "object") continue;
          const o = r as Record<string, unknown>;
          const url = typeof o.url === "string" ? o.url : "";
          if (o.success === true && typeof o.importedSessionId === "string") {
            mapped.push({ url, success: true, importedSessionId: o.importedSessionId });
          } else if (o.success === false && typeof o.error === "string") {
            mapped.push({ url, success: false, error: o.error });
          }
        }
      }
      setLastResults(mapped);
      const ok = mapped.filter((m) => m.success).length;
      const fail = mapped.length - ok;
      setHint(
        mapped.length === 0
          ? "No results returned."
          : `Imported ${ok} session${ok === 1 ? "" : "s"}${fail > 0 ? ` · ${fail} failed` : ""}.`
      );
      await loadSessions();
    } catch {
      setHint("Import request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function expandSession(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetailJson(null);
      return;
    }
    setExpandedId(id);
    setDetailJson(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/lap-time-sessions/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDetailJson(JSON.stringify({ error: (data as { error?: string })?.error ?? "Not found" }, null, 2));
        return;
      }
      setDetailJson(JSON.stringify((data as { session?: unknown }).session ?? data, null, 2));
    } catch {
      setDetailJson(JSON.stringify({ error: "Request failed" }, null, 2));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Import from URLs</div>
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
          Paste LiveRC (or other supported) timing links — one per line. Each line uses the same parser as{" "}
          <Link href="/runs/new" className="text-accent underline underline-offset-2">
            Log your run
          </Link>
          . Failed lines do not cancel the rest.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={"https://…\nhttps://…"}
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none font-mono"
          disabled={busy}
          aria-label="Timing URLs, one per line"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onImport()}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import"}
          </button>
          {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
        </div>

        {lastResults.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[11px]">
            {lastResults.map((r) => (
              <li key={r.url + (r.success ? r.importedSessionId : r.error)} className="flex flex-wrap gap-x-2">
                <span className={cn("shrink-0 font-medium", r.success ? "text-emerald-600" : "text-destructive")}>
                  {r.success ? "OK" : "Fail"}
                </span>
                <span className="min-w-0 break-all text-muted-foreground">{r.url}</span>
                {!r.success ? <span className="text-destructive">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Imported sessions</div>
        {listErr ? <p className="mt-2 text-[11px] text-destructive">{listErr}</p> : null}
        {!listErr && sessions.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">None yet — import URLs above.</p>
        ) : null}
        <ul className="mt-2 space-y-1">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-md border border-border bg-muted/40">
              <button
                type="button"
                onClick={() => void expandSession(s.id)}
                className="flex w-full flex-col gap-0.5 px-2.5 py-2 text-left text-[11px] hover:bg-muted/60"
              >
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {new Date(s.createdAt).toLocaleString()}
                </span>
                <span className="break-all text-foreground">{s.sourceUrl}</span>
                <span className="text-[10px] text-muted-foreground">
                  {s.parserId} · {s.sourceType}
                  {s.linkedRunId ? ` · linked run` : ""}
                </span>
              </button>
              {expandedId === s.id ? (
                <div className="border-t border-border px-2.5 py-2">
                  {detailLoading ? (
                    <p className="text-[11px] text-muted-foreground">Loading…</p>
                  ) : (
                    <pre className="max-h-48 overflow-auto rounded border border-border bg-background p-2 text-[10px] leading-snug">
                      {detailJson ?? "—"}
                    </pre>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
