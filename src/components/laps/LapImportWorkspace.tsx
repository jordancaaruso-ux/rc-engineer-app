"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { formatDriverSessionLabel, resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import type { ImportedSessionFieldStatsPreviewV1 } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { formatLap } from "@/lib/runLaps";

type SessionRow = {
  id: string;
  createdAt: string;
  sessionCompletedAt?: string | null;
  sourceUrl: string;
  parserId: string;
  sourceType: string;
  linkedRunId: string | null;
  linkedEventId: string | null;
  parsedPayload?: unknown;
  fieldStatsPreview?: ImportedSessionFieldStatsPreviewV1 | null;
};

type ImportResultRow =
  | { url: string; success: true; importedSessionId: string }
  | { url: string; success: false; error: string };

type DiscoveredSession = { url: string; label: string; group: string };

/** A MyRCM class (report) URL without a `reportKey` — pasting it lists sessions to pick from. */
function isMyRcmCategoryLine(line: string): boolean {
  return (
    /^https?:\/\/(www\.)?myrcm\.ch\/myrcm\/report\/[a-z]{2}\/\d+\/\d+(?:[/?#]|$)/i.test(line) &&
    !/[?&]reportKey=\d+/i.test(line)
  );
}

export function LapImportWorkspace() {
  const searchParams = useSearchParams();
  const sessionIdFromQuery = searchParams.get("sessionId");
  const eventIdFromQuery = searchParams.get("eventId");
  const deepLinkedRef = useRef<string | null>(null);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<ImportResultRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailJson, setDetailJson] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [myRcmSessions, setMyRcmSessions] = useState<DiscoveredSession[] | null>(null);
  const [myRcmSelected, setMyRcmSelected] = useState<Set<string>>(new Set());

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

  const loadSessionDetail = useCallback(async (id: string) => {
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
  }, []);

  const expandSession = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setDetailJson(null);
        return;
      }
      await loadSessionDetail(id);
    },
    [expandedId, loadSessionDetail]
  );

  /** Open the session detail when linked from dashboard (?sessionId=). */
  useEffect(() => {
    if (!sessionIdFromQuery) return;
    if (deepLinkedRef.current === sessionIdFromQuery) return;
    if (!sessions.some((s) => s.id === sessionIdFromQuery)) return;
    deepLinkedRef.current = sessionIdFromQuery;
    void loadSessionDetail(sessionIdFromQuery);
  }, [sessionIdFromQuery, sessions, loadSessionDetail]);

  const runImport = useCallback(
    async (urls: string[]) => {
      setBusy(true);
      setHint(null);
      setLastResults([]);
      try {
        const res = await fetch("/api/lap-time-sessions/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urls,
            ...(eventIdFromQuery ? { eventId: eventIdFromQuery } : {}),
          }),
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
    },
    [eventIdFromQuery, loadSessions]
  );

  /** MyRCM class page: fetch its sessions so the user can pick the one they raced. */
  const previewMyRcmCategory = useCallback(async (categoryUrl: string) => {
    setBusy(true);
    setHint("Finding sessions…");
    setLastResults([]);
    setMyRcmSessions(null);
    setMyRcmSelected(new Set());
    try {
      const res = await fetch("/api/laps/parse-url-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: categoryUrl }),
      });
      const data = (await res.json().catch(() => null)) as
        | { discoveredSessions?: DiscoveredSession[] | null; message?: string | null; error?: string }
        | null;
      if (!res.ok) {
        setHint(data?.error ?? "Could not read this MyRCM page.");
        return;
      }
      const found = Array.isArray(data?.discoveredSessions) ? data!.discoveredSessions! : [];
      if (found.length === 0) {
        setHint(data?.message ?? "No result sessions found on this MyRCM page.");
        return;
      }
      setMyRcmSessions(found);
      setHint(data?.message ?? `Found ${found.length} sessions — pick the one you raced.`);
    } catch {
      setHint("Request failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function onImport() {
    const urls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setHint("Paste one or more URLs (one per line).");
      return;
    }
    // A single MyRCM class URL → show a session picker instead of importing the whole class.
    if (urls.length === 1 && isMyRcmCategoryLine(urls[0]!)) {
      await previewMyRcmCategory(urls[0]!);
      return;
    }
    await runImport(urls);
  }

  function toggleMyRcmSession(url: string) {
    setMyRcmSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function importSelectedMyRcm() {
    const urls = [...myRcmSelected];
    if (urls.length === 0) {
      setHint("Select at least one session to import.");
      return;
    }
    setMyRcmSessions(null);
    setMyRcmSelected(new Set());
    await runImport(urls);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <CardPanel className="max-w-3xl" contentClassName="space-y-3">
        <Eyebrow>Import from URLs</Eyebrow>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Paste LiveRC, Speedhive, or MyRCM timing links — one per line. LiveRC event hub URLs expand to each race result;
          a MyRCM class URL (<code className="text-[10px]">myrcm.ch/myrcm/report/…</code>) lists its sessions to pick from.
          Use <code className="text-[10px]">?eventId=…</code> on this page to filter by that event&apos;s race classes. Failed lines do not cancel the rest.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={"https://…\nhttps://…"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none font-mono"
          disabled={busy}
          aria-label="Timing URLs, one per line"
        />
        <div className="flex flex-wrap items-center gap-2">
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
          <ul className="space-y-1 border-t border-border pt-3 text-[11px]">
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

        {myRcmSessions ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>MyRCM sessions</Eyebrow>
              <button
                type="button"
                onClick={() => {
                  setMyRcmSessions(null);
                  setMyRcmSelected(new Set());
                  setHint(null);
                }}
                className="text-[10px] text-muted-foreground underline"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Pick the session(s) you raced. Each becomes an importable session with the full field.
            </p>
            <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
              {myRcmSessions.map((s) => (
                <li key={s.url}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={myRcmSelected.has(s.url)}
                      onChange={() => toggleMyRcmSession(s.url)}
                      className="accent-primary"
                    />
                    <span className="text-foreground">{s.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy || myRcmSelected.size === 0}
              onClick={() => void importSelectedMyRcm()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${myRcmSelected.size || ""} selected`.trim()}
            </button>
          </div>
        ) : null}
      </CardPanel>

      <div className="space-y-2.5">
        <Eyebrow>Imported sessions</Eyebrow>
        {listErr ? <p className="text-[11px] text-destructive">{listErr}</p> : null}
        {!listErr && sessions.length === 0 ? (
          <CardPanel contentClassName="text-[11px] text-muted-foreground">
            None yet — import URLs above.
          </CardPanel>
        ) : null}
        <ul className="flex flex-col gap-2.5">
          {sessions.map((s) => (
            <li key={s.id}>
              <CardPanel contentClassName="p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => void expandSession(s.id)}
                  className="flex w-full flex-col gap-0.5 px-2.5 py-2 text-left text-[11px]"
                >
                  <span className="text-xs font-medium text-foreground">
                    {(() => {
                      const p = primaryLapRowsFromImportedPayload(s.parsedPayload);
                      const name = p?.driverName ?? "Session";
                      const whenIso = resolveImportedSessionDisplayTimeIso({
                        sessionCompletedAt: s.sessionCompletedAt ?? null,
                        parsedPayload: s.parsedPayload,
                        createdAt: s.createdAt,
                      });
                      return formatDriverSessionLabel(name, whenIso);
                    })()}
                  </span>
                  <span className="break-all text-[11px] text-muted-foreground">{s.sourceUrl}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.parserId} · {s.sourceType}
                    {s.linkedRunId ? ` · linked run` : ""}
                    {s.fieldStatsPreview && s.fieldStatsPreview.driverCount > 0
                      ? ` · ${s.fieldStatsPreview.driverCount} driver${s.fieldStatsPreview.driverCount === 1 ? "" : "s"} · median best ${formatLap(s.fieldStatsPreview.medianBestSeconds)}`
                      : ""}
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
              </CardPanel>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
