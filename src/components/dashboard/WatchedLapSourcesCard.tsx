"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

type SourceRow = {
  id: string;
  sourceUrl: string;
  targetMode?: "driver" | "class" | "none";
  targetClass?: string | null;
  driverName: string | null; // legacy
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
      displayDriverName: string;
      lapCount: number | null;
      bestLapSeconds: number | null;
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
      status: "no_driver_match";
      message: string;
      parsedCandidateCount: number;
      candidateDriverNamesSample: string[];
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

  const [liveRcDriverName, setLiveRcDriverName] = useState("");
  const [liveRcDriverBusy, setLiveRcDriverBusy] = useState(false);

  const [url, setUrl] = useState("");
  const [raceClass, setRaceClass] = useState("");
  const [carId, setCarId] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);

  function inferUrlKind(u: string): "practice_list" | "results_index" | "other" {
    try {
      const x = new URL(u.trim());
      const hostOk = /\.liverc\.com$/i.test(x.hostname);
      const path = x.pathname.toLowerCase().replace(/\/+$/, "");
      if (hostOk && path.endsWith("/practice") && (x.searchParams.get("p") ?? "").toLowerCase() === "session_list") {
        return "practice_list";
      }
      if (hostOk && path.endsWith("/results") && !x.searchParams.get("id")) {
        return "results_index";
      }
      return "other";
    } catch {
      return "other";
    }
  }

  async function loadSources() {
    setLoadErr(null);
    try {
      const res = await fetch("/api/lap-watch/sources", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const apiErr =
          (data as { error?: string; code?: string; detail?: string })?.error ??
          `Failed to load watched sources (HTTP ${res.status}).`;
        const detail = (data as { detail?: string })?.detail;
        setLoadErr(detail ? `${apiErr} (${detail})` : apiErr);
        return;
      }
      setSources(Array.isArray((data as { sources?: unknown }).sources) ? ((data as { sources: SourceRow[] }).sources as SourceRow[]) : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setLoadErr(`Failed to load watched sources (${msg}).`);
    }
  }

  useEffect(() => {
    void loadSources();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/live-rc-driver", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { liveRcDriverName?: string | null }) => {
        if (!alive) return;
        setLiveRcDriverName(typeof data.liveRcDriverName === "string" ? data.liveRcDriverName : "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function saveLiveRcDriverName() {
    setLiveRcDriverBusy(true);
    try {
      const res = await fetch("/api/settings/live-rc-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveRcDriverName: liveRcDriverName.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLiveRcDriverName(typeof (data as { liveRcDriverName?: string | null }).liveRcDriverName === "string" ? (data as { liveRcDriverName: string }).liveRcDriverName : "");
      }
    } finally {
      setLiveRcDriverBusy(false);
    }
  }

  async function addSource() {
    const sourceUrl = url.trim();
    if (!sourceUrl) {
      setAddErr("Paste a LiveRC timing URL.");
      return;
    }
    setAddErr(null);
    const kind = inferUrlKind(sourceUrl);
    if (kind === "practice_list" && !liveRcDriverName.trim()) {
      setAddErr("Set your LiveRC driver name first (used for practice sources).");
      return;
    }
    if (kind === "results_index" && !raceClass.trim()) {
      setAddErr("Enter your race class for results sources.");
      return;
    }
    try {
      const res = await fetch("/api/lap-watch/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          targetClass: kind === "results_index" ? raceClass.trim() : null,
          carId: carId.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddErr((data as { error?: string })?.error ?? "Could not add source.");
        return;
      }
      setUrl("");
      setRaceClass("");
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
      const noDriver = r.filter((x) => x.status === "no_driver_match");
      const parts: string[] = [];
      if (noDriver.length > 0) parts.push(noDriver.map((x) => x.message).join(" "));
      if (imported > 0) parts.push(`Imported ${imported} new session${imported === 1 ? "" : "s"}`);
      if (errs > 0) parts.push(`${errs} error${errs === 1 ? "" : "s"}`);
      setResultNote(
        parts.length > 0
          ? parts.join(" · ")
          : "No new sessions detected."
      );
      await loadSources();
    } catch {
      setResultNote("Check failed.");
    } finally {
      setBusy(false);
    }
  }

  const importedRows = useMemo(() => {
    const rows = results.filter((r) => r.status === "new_imported");
    function sortInstant(iso: string | null): number {
      if (!iso?.trim()) return Number.NEGATIVE_INFINITY;
      const t = new Date(iso.trim()).getTime();
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    }
    return [...rows].sort((a, b) => sortInstant(b.sessionCompletedAtIso) - sortInstant(a.sessionCompletedAtIso));
  }, [results]);

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
              <li key={r.importedSessionId} className="flex flex-wrap items-center gap-2">
                <span className="text-foreground font-medium min-w-0">
                  {r.displayDriverName} ·{" "}
                  {r.sessionCompletedAtIso ? formatRunCreatedAtDateTime(r.sessionCompletedAtIso) : "—"}
                  {r.lapCount != null ? (
                    <span className="text-muted-foreground font-normal"> · {r.lapCount} laps</span>
                  ) : null}
                  {r.bestLapSeconds != null ? (
                    <span className="text-muted-foreground font-normal font-mono">
                      {" "}
                      · best {r.bestLapSeconds.toFixed(3)}s
                    </span>
                  ) : null}
                </span>
                <Link
                  href={`/runs/new?importedLapTimeSessionId=${encodeURIComponent(r.importedSessionId)}`}
                  className={cn(btnPrimary("px-2 py-1 text-[10px]"), "no-underline")}
                >
                  Log this run
                </Link>
                <Link
                  href={`/laps/import?sessionId=${encodeURIComponent(r.importedSessionId)}`}
                  className={cn(btnGhost("px-2 py-1 text-[10px]"), "no-underline")}
                >
                  View laps
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-muted/40 p-2 space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">LiveRC identity</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
            placeholder="Your LiveRC driver name (e.g. Jordan Caruso)"
            value={liveRcDriverName}
            onChange={(e) => setLiveRcDriverName(e.target.value)}
          />
          <button type="button" className={btnPrimary()} disabled={liveRcDriverBusy} onClick={() => void saveLiveRcDriverName()}>
            {liveRcDriverBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

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
            {inferUrlKind(url) === "results_index" ? (
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
                placeholder="Race class (results pages)"
                value={raceClass}
                onChange={(e) => setRaceClass(e.target.value)}
              />
            ) : (
              <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                {inferUrlKind(url) === "practice_list" ? (
                  <>
                    Using LiveRC driver:{" "}
                    <span className="text-foreground/90 font-medium">{liveRcDriverName.trim() || "—"}</span>
                  </>
                ) : (
                  <>Targeting: none</>
                )}
              </div>
            )}
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
                      {s.targetMode === "class" && s.targetClass ? `Class: ${s.targetClass} · ` : ""}
                      {s.targetMode === "driver" ? `Practice (uses LiveRC identity) · ` : ""}
                      {s.driverName ? `Legacy driver: ${s.driverName} · ` : ""}
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

