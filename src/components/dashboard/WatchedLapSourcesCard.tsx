"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

type SourceRow = {
  id: string;
  sourceUrl: string;
  driverName: string | null;
  carId: string | null;
  lastCheckedAt: string | null;
  lastSeenSessionCompletedAt: string | null;
};

type CheckResult =
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "new_imported";
      importedSessionId: string;
      importedFromUrl: string;
      sessionId: string;
      sessionCompletedAtIso: string | null;
      parserId: string;
      message: string | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "no_change";
      message: string | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "error";
      error: string;
      parserId: string | null;
    };

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted/60 hover:text-foreground ${className}`;
}

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

export function WatchedLapSourcesCard() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [resultNote, setResultNote] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [driverName, setDriverName] = useState("");
  const [carId, setCarId] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);

  async function loadSources() {
    setLoadErr(null);
    try {
      const res = await fetch("/api/lap-watch/sources", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr((data as { error?: string })?.error ?? "Could not load watched sources.");
        return;
      }
      setSources(Array.isArray((data as { sources?: unknown }).sources) ? ((data as { sources: SourceRow[] }).sources as SourceRow[]) : []);
    } catch {
      setLoadErr("Could not load watched sources.");
    }
  }

  useEffect(() => {
    void loadSources();
  }, []);

  async function addSource() {
    const sourceUrl = url.trim();
    if (!sourceUrl) {
      setAddErr("Paste a LiveRC timing URL.");
      return;
    }
    setAddErr(null);
    try {
      const res = await fetch("/api/lap-watch/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          driverName: driverName.trim() || null,
          carId: carId.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddErr((data as { error?: string })?.error ?? "Could not add source.");
        return;
      }
      setUrl("");
      setDriverName("");
      setCarId("");
      await loadSources();
    } catch {
      setAddErr("Could not add source.");
    }
  }

  async function removeSource(id: string) {
    try {
      await fetch(`/api/lap-watch/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      await loadSources();
    }
  }

  async function check(forceImport: boolean) {
    setBusy(true);
    setResults([]);
    setResultNote(null);
    try {
      const res = await fetch("/api/lap-watch/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceImport }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResultNote((data as { error?: string })?.error ?? "Check failed.");
        return;
      }
      const r = Array.isArray((data as { results?: unknown }).results) ? ((data as { results: CheckResult[] }).results as CheckResult[]) : [];
      setResults(r);
      const imported = r.filter((x) => x.status === "new_imported").length;
      const errs = r.filter((x) => x.status === "error").length;
      setResultNote(
        imported === 0 && errs === 0
          ? "No new sessions detected."
          : imported > 0
            ? `Imported ${imported} new session${imported === 1 ? "" : "s"}${errs ? ` · ${errs} error` : ""}.`
            : `${errs} error${errs === 1 ? "" : "s"} while checking.`
      );
      await loadSources();
    } catch {
      setResultNote("Check failed.");
    } finally {
      setBusy(false);
    }
  }

  const importedRows = useMemo(() => results.filter((r) => r.status === "new_imported"), [results]);

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Watched lap-time sources</div>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            Manual check (track-safe). When a session looks new, it is imported into your private lap-time library.
          </p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={btnPrimary()} disabled={busy} onClick={() => void check(false)}>
            {busy ? "Checking…" : "Check now"}
          </button>
          <button type="button" className={btnGhost()} disabled={busy} onClick={() => void check(true)}>
            Force import (test)
          </button>
        </div>
      </div>

      {resultNote ? <div className="text-[11px] text-muted-foreground">{resultNote}</div> : null}

      {importedRows.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/40 p-2 space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">New sessions</div>
          <ul className="space-y-1 text-[11px]">
            {importedRows.map((r) => (
              <li key={`${r.sourceId}-${(r as any).importedSessionId}`} className="flex flex-wrap items-center gap-2">
                <span className="text-foreground font-medium">
                  {r.driverName || "Session"} ·{" "}
                  {r.sessionCompletedAtIso ? formatRunCreatedAtDateTime(r.sessionCompletedAtIso) : "—"}
                </span>
                <Link
                  href={`/runs/new?importedLapTimeSessionId=${encodeURIComponent((r as any).importedSessionId)}`}
                  className={cn(btnPrimary("px-2 py-1 text-[10px]"), "no-underline")}
                >
                  Log this run
                </Link>
                <Link href="/laps/import" className={cn(btnGhost("px-2 py-1 text-[10px]"), "no-underline")}>
                  View laps
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-muted/40 p-2 space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Add source</div>
        <div className="space-y-1">
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
            placeholder="LiveRC URL (practice session_list d=YYYY-MM-DD, or results /results/)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
              placeholder="Driver name (race result only)"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
              placeholder="Car id (optional)"
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
            />
            <button type="button" className={btnPrimary()} onClick={() => void addSource()}>
              Add
            </button>
          </div>
          {addErr ? <div className="text-[11px] text-destructive">{addErr}</div> : null}
        </div>
      </div>

      <div className="space-y-1">
        {loadErr ? <div className="text-[11px] text-destructive">{loadErr}</div> : null}
        {sources.length === 0 && !loadErr ? (
          <div className="text-[11px] text-muted-foreground">No watched sources yet.</div>
        ) : null}
        {sources.length > 0 ? (
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={s.id} className="rounded-md border border-border bg-card/60 p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-foreground break-all">{s.sourceUrl}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.driverName ? `Driver: ${s.driverName} · ` : ""}
                      Last seen:{" "}
                      {s.lastSeenSessionCompletedAt ? formatRunCreatedAtDateTime(s.lastSeenSessionCompletedAt) : "—"} · Last checked:{" "}
                      {s.lastCheckedAt ? formatRunCreatedAtDateTime(s.lastCheckedAt) : "—"}
                    </div>
                  </div>
                  <button type="button" className={btnGhost("px-2 py-1 text-[10px]")} onClick={() => void removeSource(s.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

