"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLine } from "@/lib/runPickerFormat";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import { EngineerRunSummaryPanel } from "@/components/engineer/EngineerRunSummaryPanel";
import { cn } from "@/lib/utils";

type CarOpt = { id: string; name: string };
type EventOpt = { id: string; name: string };
type TeammateOpt = {
  id: string;
  peerUserId: string;
  name: string | null;
  email: string | null;
  source?: "link" | "team";
};

function toPickerRuns(raw: unknown[]): RunPickerRun[] {
  return raw.map((r) => {
    const x = r as RunPickerRun;
    return {
      ...x,
      createdAt: typeof x.createdAt === "string" ? x.createdAt : String(x.createdAt),
      sessionType: x.sessionType ?? "TESTING",
    };
  });
}

export function EngineerCompareAndPattern({
  onDigestLoaded,
  embedded = false,
  showRunSummaryPanel = false,
  onQueueEngineerChatPrompt,
}: {
  onDigestLoaded: (d: PatternDigestV1 | null) => void;
  /** Omit outer card chrome when nested (e.g. collapsible section). */
  embedded?: boolean;
  /** Show lap/setup summary for URL primary + compare (Engineer page). */
  showRunSummaryPanel?: boolean;
  /** Quick prompts from run summary → Ask the Engineer. */
  onQueueEngineerChatPrompt?: (text: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<RunPickerRun[]>([]);
  const [cars, setCars] = useState<CarOpt[]>([]);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [carFilter, setCarFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestErr, setDigestErr] = useState<string | null>(null);
  const [digest, setDigest] = useState<PatternDigestV1 | null>(null);
  const [digestCarId, setDigestCarId] = useState("");
  const defaultedRunId = useRef(false);

  const [compareMode, setCompareMode] = useState<"mine" | "teammate">("mine");
  const compareModeRef = useRef(compareMode);
  const [sameTrackOnly, setSameTrackOnly] = useState(false);
  const [teammates, setTeammates] = useState<TeammateOpt[]>([]);
  const [teammateEmail, setTeammateEmail] = useState("");
  const [teammateAddBusy, setTeammateAddBusy] = useState(false);
  const [teammateAddErr, setTeammateAddErr] = useState<string | null>(null);
  const [teammatePeerId, setTeammatePeerId] = useState("");
  const [teammateCars, setTeammateCars] = useState<CarOpt[]>([]);
  const [teammateCarId, setTeammateCarId] = useState("");
  const [teammateRuns, setTeammateRuns] = useState<RunPickerRun[]>([]);
  const [loadingTeammateRuns, setLoadingTeammateRuns] = useState(false);

  const runIdUrl = searchParams.get("runId")?.trim() || "";
  const compareRunIdUrl = searchParams.get("compareRunId")?.trim() || "";

  const primaryTrackId = useMemo(
    () => runs.find((r) => r.id === runIdUrl)?.trackId ?? null,
    [runs, runIdUrl]
  );

  const setQuery = useCallback(
    (next: { runId?: string; compareRunId?: string | null }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.runId !== undefined) {
        if (next.runId) p.set("runId", next.runId);
        else p.delete("runId");
      }
      if (next.compareRunId !== undefined) {
        if (next.compareRunId) p.set("compareRunId", next.compareRunId);
        else p.delete("compareRunId");
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (compareModeRef.current !== compareMode) {
      setQuery({ compareRunId: null });
      compareModeRef.current = compareMode;
    }
  }, [compareMode, setQuery]);

  useEffect(() => {
    let alive = true;
    fetch("/api/cars", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { cars?: CarOpt[] }) => {
        if (!alive) return;
        setCars(Array.isArray(data.cars) ? data.cars : []);
      })
      .catch(() => {
        if (alive) setCars([]);
      });
    fetch("/api/events", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { events?: Array<{ id: string; name: string }> }) => {
        if (!alive) return;
        setEvents(Array.isArray(data.events) ? data.events.map((e) => ({ id: e.id, name: e.name })) : []);
      })
      .catch(() => {
        if (alive) setEvents([]);
      });
    fetch("/api/teammates", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { teammates?: TeammateOpt[] }) => {
        if (!alive) return;
        setTeammates(Array.isArray(data.teammates) ? data.teammates : []);
      })
      .catch(() => {
        if (alive) setTeammates([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!teammatePeerId) {
      setTeammateCars([]);
      setTeammateCarId("");
      return;
    }
    let alive = true;
    fetch(`/api/cars?forUserId=${encodeURIComponent(teammatePeerId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { cars?: CarOpt[] }) => {
        if (!alive) return;
        setTeammateCars(Array.isArray(data.cars) ? data.cars : []);
      })
      .catch(() => {
        if (alive) setTeammateCars([]);
      });
    return () => {
      alive = false;
    };
  }, [teammatePeerId]);

  useEffect(() => {
    if (compareMode !== "teammate") {
      setTeammateRuns([]);
      setLoadingTeammateRuns(false);
      return;
    }
    if (!teammatePeerId || !teammateCarId || !primaryTrackId) {
      setTeammateRuns([]);
      setLoadingTeammateRuns(false);
      return;
    }
    let alive = true;
    setLoadingTeammateRuns(true);
    const sp = new URLSearchParams();
    sp.set("take", "200");
    sp.set("forUserId", teammatePeerId);
    sp.set("carId", teammateCarId);
    sp.set("trackId", primaryTrackId);
    fetch(`/api/runs/search?${sp.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { runs?: unknown[] }) => {
        if (!alive) return;
        setTeammateRuns(toPickerRuns(Array.isArray(data.runs) ? data.runs : []));
      })
      .catch(() => {
        if (alive) setTeammateRuns([]);
      })
      .finally(() => {
        if (alive) setLoadingTeammateRuns(false);
      });
    return () => {
      alive = false;
    };
  }, [compareMode, teammatePeerId, teammateCarId, primaryTrackId]);

  useEffect(() => {
    let alive = true;
    setLoadingRuns(true);
    const sp = new URLSearchParams();
    sp.set("take", "200");
    if (carFilter.trim()) sp.set("carId", carFilter.trim());
    if (eventFilter.trim()) sp.set("eventId", eventFilter.trim());
    if (q.trim()) sp.set("q", q.trim());
    if (dateFrom.trim()) sp.set("dateFrom", dateFrom.trim());
    if (dateTo.trim()) sp.set("dateTo", dateTo.trim());

    const t = window.setTimeout(() => {
      fetch(`/api/runs/search?${sp.toString()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { runs?: unknown[] }) => {
          if (!alive) return;
          setRuns(toPickerRuns(Array.isArray(data.runs) ? data.runs : []));
        })
        .catch(() => {
          if (alive) setRuns([]);
        })
        .finally(() => {
          if (alive) setLoadingRuns(false);
        });
    }, q.trim() ? 300 : 0);

    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [carFilter, eventFilter, q, dateFrom, dateTo]);

  useEffect(() => {
    if (runIdUrl) return;
    if (defaultedRunId.current) return;
    defaultedRunId.current = true;
    let alive = true;
    fetch("/api/engineer/summary", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { runId?: string | null }) => {
        if (!alive || !data.runId) return;
        setQuery({ runId: data.runId, compareRunId: compareRunIdUrl || null });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [compareRunIdUrl, runIdUrl, setQuery]);

  const primaryOptions = runs;
  const compareOptionsMine = useMemo(() => {
    let list = runs.filter((r) => r.id !== runIdUrl);
    if (sameTrackOnly && primaryTrackId) {
      list = list.filter((r) => r.trackId === primaryTrackId);
    }
    return list;
  }, [runs, runIdUrl, sameTrackOnly, primaryTrackId]);

  const compareRunsList = compareMode === "teammate" ? teammateRuns : compareOptionsMine;
  const compareFiltered = useMemo(
    () => compareRunsList.filter((r) => r.id !== runIdUrl),
    [compareRunsList, runIdUrl]
  );

  const primaryCarId = useMemo(() => {
    const p = runs.find((r) => r.id === runIdUrl);
    return p?.carId?.trim() || "";
  }, [runs, runIdUrl]);

  useEffect(() => {
    if (digestCarId || !primaryCarId) return;
    setDigestCarId(primaryCarId);
  }, [primaryCarId, digestCarId]);

  async function addTeammateByEmail() {
    setTeammateAddErr(null);
    const email = teammateEmail.trim();
    if (!email) {
      setTeammateAddErr("Enter an email");
      return;
    }
    setTeammateAddBusy(true);
    try {
      const res = await fetch("/api/teammates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTeammateAddErr((data as { error?: string }).error ?? "Could not add teammate");
        return;
      }
      setTeammateEmail("");
      const listRes = await fetch("/api/teammates", { cache: "no-store" });
      const listData = await listRes.json().catch(() => ({}));
      setTeammates(Array.isArray((listData as { teammates?: TeammateOpt[] }).teammates) ? (listData as { teammates: TeammateOpt[] }).teammates : []);
    } finally {
      setTeammateAddBusy(false);
    }
  }

  async function loadDigest() {
    const cid = digestCarId.trim() || primaryCarId;
    if (!cid) {
      setDigestErr("Select a primary run (or pick a car for digest).");
      return;
    }
    setDigestErr(null);
    setDigestLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("carId", cid);
      if (eventFilter.trim()) sp.set("eventId", eventFilter.trim());
      if (dateFrom.trim()) sp.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) sp.set("dateTo", dateTo.trim());
      sp.set("limit", "40");
      const res = await fetch(`/api/runs/pattern-digest?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDigest(null);
        onDigestLoaded(null);
        setDigestErr((data as { error?: string }).error ?? "Could not load digest.");
        return;
      }
      const d = (data as { digest?: PatternDigestV1 }).digest;
      if (d && d.version === 1) {
        setDigest(d);
        onDigestLoaded(d);
      } else {
        setDigest(null);
        onDigestLoaded(null);
      }
    } finally {
      setDigestLoading(false);
    }
  }

  function clearDigest() {
    setDigest(null);
    onDigestLoaded(null);
    setDigestErr(null);
  }

  const teammateCompareReady =
    compareMode === "teammate" && Boolean(teammatePeerId && teammateCarId && primaryTrackId);

  return (
    <div
      className={cn(
        embedded ? "space-y-4" : "rounded-lg border border-border bg-card p-3 space-y-4"
      )}
    >
      {!embedded ? (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Compare runs</div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Pick a primary run, then compare with another run (lap + setup diff when same car). For others&apos; runs: add a
            teammate by email or pick someone who appears from a pilot team; choose their car — only runs at the same
            track as your primary run are listed. Selection is stored in the URL.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Filters scope the lists below. Primary and compare runs update the URL (<span className="font-mono">runId</span>{" "}
          / <span className="font-mono">compareRunId</span>) for chat and for links from Analysis.
        </p>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 min-w-[140px]">
          <label className="text-[10px] text-muted-foreground">Car filter</label>
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none max-w-[220px]"
            value={carFilter}
            onChange={(e) => setCarFilter(e.target.value)}
          >
            <option value="">All cars</option>
            {cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 min-w-[140px]">
          <label className="text-[10px] text-muted-foreground">Event filter</label>
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none max-w-[240px]"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 flex-1 min-w-[160px]">
          <label className="text-[10px] text-muted-foreground">Search notes / labels</label>
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Track, event, notes…"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">From</label>
          <input
            type="date"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">To</label>
          <input
            type="date"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {loadingRuns ? (
        <p className="text-[11px] text-muted-foreground">Loading runs…</p>
      ) : primaryOptions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No runs match filters.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <RunPickerSelect
            label="Primary run (focus)"
            runs={primaryOptions}
            value={runIdUrl}
            onChange={(id) => {
              setQuery({
                runId: id,
                compareRunId: id === compareRunIdUrl ? null : compareRunIdUrl || null,
              });
            }}
            placeholder="Select primary run…"
            formatLine={formatRunPickerLine}
          />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] text-muted-foreground">Compare source</span>
              <div className="flex rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium",
                    compareMode === "mine" ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                  onClick={() => setCompareMode("mine")}
                >
                  My runs
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium",
                    compareMode === "teammate" ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                  onClick={() => setCompareMode("teammate")}
                >
                  Teammate
                </button>
              </div>
            </div>

            {compareMode === "mine" ? (
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameTrackOnly}
                  onChange={(e) => setSameTrackOnly(e.target.checked)}
                  disabled={!primaryTrackId}
                />
                Same track as primary
              </label>
            ) : (
              <div className="space-y-2 rounded-md border border-border/80 bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">Add teammate (their account email)</div>
                <div className="flex flex-wrap gap-1">
                  <input
                    className="flex-1 min-w-[140px] rounded border border-border bg-background px-2 py-1 text-[11px] outline-none"
                    value={teammateEmail}
                    onChange={(e) => setTeammateEmail(e.target.value)}
                    placeholder="email@example.com"
                  />
                  <button
                    type="button"
                    disabled={teammateAddBusy}
                    onClick={() => void addTeammateByEmail()}
                    className="rounded border border-border bg-background px-2 py-1 text-[10px] font-medium hover:bg-muted"
                  >
                    {teammateAddBusy ? "…" : "Add"}
                  </button>
                </div>
                {teammateAddErr ? <p className="text-[10px] text-destructive">{teammateAddErr}</p> : null}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Driver</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
                    value={teammatePeerId}
                    onChange={(e) => {
                      setTeammatePeerId(e.target.value);
                      setQuery({ compareRunId: null });
                    }}
                  >
                    <option value="">Select teammate…</option>
                    {teammates.map((t) => (
                      <option key={t.id} value={t.peerUserId}>
                        {t.name?.trim() || t.email || t.peerUserId.slice(0, 8)}
                        {t.source === "team" ? " (team)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Their car</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
                    value={teammateCarId}
                    onChange={(e) => {
                      setTeammateCarId(e.target.value);
                      setQuery({ compareRunId: null });
                    }}
                    disabled={!teammatePeerId}
                  >
                    <option value="">Select car…</option>
                    {teammateCars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                {!primaryTrackId && runIdUrl ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-500">
                    Primary run needs a track to match your teammate at the same venue.
                  </p>
                ) : null}
              </div>
            )}

            {compareMode === "teammate" && loadingTeammateRuns ? (
              <p className="text-[11px] text-muted-foreground">Loading teammate runs…</p>
            ) : (
              <RunPickerSelect
                label="Compare run (optional)"
                runs={compareFiltered}
                value={compareRunIdUrl}
                onChange={(id) => setQuery({ compareRunId: id || null })}
                placeholder={
                  compareMode === "teammate" && !teammateCompareReady
                    ? "Select driver, car, and primary with a track…"
                    : "None — single-run context"
                }
                formatLine={formatRunPickerLine}
                disabled={compareMode === "teammate" && !teammateCompareReady}
              />
            )}
          </div>
        </div>
      )}

      {showRunSummaryPanel && runIdUrl ? (
        <div className="border-t border-border pt-4 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Run summary</div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Lap and setup deltas for the primary run vs comparison (or previous on same car when compare is not set). Use
            the buttons inside the summary to send a focused question to the Engineer.
          </p>
          <EngineerRunSummaryPanel
            runId={runIdUrl}
            compareRunId={compareRunIdUrl || null}
            defaultExpanded
            onQueueEngineerChatPrompt={onQueueEngineerChatPrompt}
          />
        </div>
      ) : null}

      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pattern digest (one car)</div>
        <p className="text-[11px] text-muted-foreground">
          Chronological series with lap metrics and setup keys changed vs the previous run in the list. Uses session time
          when known. Highlight shows best single lap in the series.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Car for digest</label>
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none min-w-[180px]"
              value={digestCarId}
              onChange={(e) => setDigestCarId(e.target.value)}
            >
              <option value="">(Use primary run&apos;s car)</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void loadDigest()}
            disabled={digestLoading}
            className={cn(
              "rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-glow-sm hover:brightness-105",
              digestLoading && "opacity-60 pointer-events-none"
            )}
          >
            {digestLoading ? "Loading…" : "Load trend digest"}
          </button>
          {digest ? (
            <button type="button" onClick={clearDigest} className="text-[11px] text-muted-foreground underline">
              Clear digest from chat
            </button>
          ) : null}
        </div>
        {digestErr ? <p className="text-[11px] text-destructive">{digestErr}</p> : null}
        {digest ? (
          <div className="rounded-md border border-border bg-muted/40 p-2 max-h-48 overflow-auto text-[10px] font-mono leading-snug">
            <div className="text-[10px] text-muted-foreground mb-1">
              Best lap in series:{" "}
              {digest.highlight.bestLapSeconds != null ? `${digest.highlight.bestLapSeconds.toFixed(3)}s` : "—"}
              {digest.highlight.bestLapRunId ? ` · run ${digest.highlight.bestLapRunId.slice(0, 8)}…` : ""}
            </div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(digest.runs, null, 0).slice(0, 4000)}</pre>
            {JSON.stringify(digest.runs).length > 4000 ? (
              <div className="text-muted-foreground mt-1">…truncated in preview; full payload sent to chat.</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
