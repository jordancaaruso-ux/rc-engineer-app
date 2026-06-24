"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLine } from "@/lib/runPickerFormat";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import type { PatternDigestRunRow, PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import { cn } from "@/lib/utils";
import { EngineerRunPairVisualCompare } from "@/components/engineer/EngineerRunPairVisualCompare";
import { formatLap } from "@/lib/runLaps";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

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
  onDigestLoaded = () => {},
  embedded = false,
}: {
  onDigestLoaded?: (d: PatternDigestV1 | null) => void;
  /** Omit outer card chrome when nested (e.g. collapsible section). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<RunPickerRun[]>([]);
  const [cars, setCars] = useState<CarOpt[]>([]);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [carFilter, setCarFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestErr, setDigestErr] = useState<string | null>(null);
  const [digest, setDigest] = useState<PatternDigestV1 | null>(null);
  const [digestCarId, setDigestCarId] = useState("");
  const [digestSelectedRunIds, setDigestSelectedRunIds] = useState<string[]>([]);
  const [digestPairRunIdA, setDigestPairRunIdA] = useState("");
  const [digestPairRunIdB, setDigestPairRunIdB] = useState("");
  const defaultedRunId = useRef(false);

  const [compareMode, setCompareMode] = useState<"mine" | "teammate">("mine");
  const compareModeRef = useRef(compareMode);
  const [sameTrackOnly, setSameTrackOnly] = useState(false);
  const [compareCarId, setCompareCarId] = useState("");
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
    }, 0);

    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [carFilter, eventFilter, dateFrom, dateTo]);

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
    if (compareCarId.trim()) {
      list = list.filter((r) => r.carId === compareCarId.trim());
    }
    return list;
  }, [runs, runIdUrl, sameTrackOnly, primaryTrackId, compareCarId]);

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
    if (compareCarId) return;
    if (!primaryCarId) return;
    setCompareCarId(primaryCarId);
  }, [primaryCarId, compareCarId]);

  useEffect(() => {
    if (digestCarId || !primaryCarId) return;
    setDigestCarId(primaryCarId);
  }, [primaryCarId, digestCarId]);

  const digestPickerCarId = useMemo(() => digestCarId.trim() || primaryCarId, [digestCarId, primaryCarId]);

  const digestPickerRuns = useMemo(() => {
    if (!digestPickerCarId) return [];
    return runs.filter((r) => r.carId === digestPickerCarId).slice(0, 120);
  }, [runs, digestPickerCarId]);

  useEffect(() => {
    setDigestSelectedRunIds((prev) => prev.filter((id) => digestPickerRuns.some((r) => r.id === id)));
  }, [digestPickerRuns]);

  useEffect(() => {
    if (!digest?.runs?.length) {
      setDigestPairRunIdA("");
      setDigestPairRunIdB("");
      return;
    }
    const rs = digest.runs;
    if (rs.length >= 2) {
      setDigestPairRunIdA(rs[0]!.runId);
      setDigestPairRunIdB(rs[rs.length - 1]!.runId);
    } else {
      setDigestPairRunIdA(rs[0]!.runId);
      setDigestPairRunIdB("");
    }
  }, [digest]);

  function digestRunLabel(r: PatternDigestRunRow): string {
    const best =
      r.lapSummary.bestLapSeconds != null && Number.isFinite(r.lapSummary.bestLapSeconds)
        ? formatLap(r.lapSummary.bestLapSeconds)
        : "—";
    const ev = r.eventName?.trim();
    return [r.trackName, ev || null, best].filter(Boolean).join(" · ");
  }

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

  function toggleDigestRunSelected(runId: string) {
    setDigestSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    );
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
      const picks = digestSelectedRunIds.filter((id) => digestPickerRuns.some((r) => r.id === id));
      if (picks.length >= 2) {
        sp.set("runIds", picks.slice(0, 40).join(","));
      }
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

  const urlPairLabelA = useMemo(() => {
    const r = runs.find((x) => x.id === runIdUrl);
    return r ? formatRunPickerLine(r) : runIdUrl ? `Run ${runIdUrl.slice(0, 8)}…` : "";
  }, [runs, runIdUrl]);

  const urlPairLabelB = useMemo(() => {
    const r = runs.find((x) => x.id === compareRunIdUrl);
    return r ? formatRunPickerLine(r) : compareRunIdUrl ? `Run ${compareRunIdUrl.slice(0, 8)}…` : "";
  }, [runs, compareRunIdUrl]);

  const digestPairLabelA = useMemo(() => {
    const r = digest?.runs?.find((x) => x.runId === digestPairRunIdA);
    return r ? digestRunLabel(r) : digestPairRunIdA ? `Run ${digestPairRunIdA.slice(0, 8)}…` : "";
  }, [digest, digestPairRunIdA]);

  const digestPairLabelB = useMemo(() => {
    const r = digest?.runs?.find((x) => x.runId === digestPairRunIdB);
    return r ? digestRunLabel(r) : digestPairRunIdB ? `Run ${digestPairRunIdB.slice(0, 8)}…` : "";
  }, [digest, digestPairRunIdB]);

  const inner = (
    <>
      <div className="flex flex-wrap gap-3 items-end">
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
          <CardPanel overflowHidden={false} contentClassName="space-y-2">
            <Eyebrow>Target</Eyebrow>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Select car</label>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
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
            <RunPickerSelect
              label="Select session"
              runs={primaryOptions}
              value={runIdUrl}
              onChange={(id) => {
                setQuery({
                  runId: id,
                  compareRunId: id === compareRunIdUrl ? null : compareRunIdUrl || null,
                });
              }}
              placeholder="Select…"
              formatLine={formatRunPickerLine}
            />
          </CardPanel>

          <CardPanel overflowHidden={false} contentClassName="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>Comparison</Eyebrow>
              <div className="flex rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium",
                    compareMode === "mine" ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                  onClick={() => setCompareMode("mine")}
                >
                  Mine
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
              <>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Select car</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
                    value={compareCarId}
                    onChange={(e) => setCompareCarId(e.target.value)}
                  >
                    <option value="">(Same as target)</option>
                    {cars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameTrackOnly}
                    onChange={(e) => setSameTrackOnly(e.target.checked)}
                    disabled={!primaryTrackId}
                  />
                  Same track
                </label>
              </>
            ) : (
              <CardPanel overflowHidden={false} contentClassName="space-y-2">
                <div className="flex flex-wrap gap-1">
                  <input
                    className="flex-1 min-w-[140px] rounded border border-border bg-background px-2 py-1 text-[11px] outline-none"
                    value={teammateEmail}
                    onChange={(e) => setTeammateEmail(e.target.value)}
                    placeholder="Add teammate email…"
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
                  <label className="text-[10px] text-muted-foreground">Select car</label>
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
              </CardPanel>
            )}

            <div className="pt-1">
              {compareMode === "teammate" && loadingTeammateRuns ? (
                <p className="text-[11px] text-muted-foreground">Loading teammate runs…</p>
              ) : (
                <RunPickerSelect
                  label="Select session"
                  runs={compareFiltered}
                  value={compareRunIdUrl}
                  onChange={(id) => setQuery({ compareRunId: id || null })}
                  placeholder={
                    compareMode === "teammate" && !teammateCompareReady
                      ? "Select driver, car, and target with a track…"
                      : "None"
                  }
                  formatLine={formatRunPickerLine}
                  disabled={compareMode === "teammate" && !teammateCompareReady}
                />
              )}
            </div>
          </CardPanel>
        </div>
      )}

      {runIdUrl && compareRunIdUrl ? (
        <div className="border-t border-border pt-3 space-y-2">
          <Eyebrow>URL selection · setup &amp; laps</Eyebrow>
          <p className="text-[11px] text-muted-foreground">
            Target session (<span className="font-mono">runId</span>) vs comparison session (
            <span className="font-mono">compareRunId</span>).
          </p>
          <EngineerRunPairVisualCompare
            runIdA={runIdUrl}
            runIdB={compareRunIdUrl}
            labelA={urlPairLabelA}
            labelB={urlPairLabelB}
          />
        </div>
      ) : null}

      <div className="border-t border-border pt-3 space-y-2">
        <Eyebrow>Pattern digest (one car)</Eyebrow>
        <p className="text-[11px] text-muted-foreground">
          Chronological series with lap metrics and setup keys changed vs the previous run in the list. Uses session time
          when known. Highlight shows best single lap in the series.
        </p>
        {digestPickerRuns.length > 0 ? (
          <CardPanel overflowHidden={false} contentClassName="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground">Runs to include (optional)</div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Check two or more runs, then load digest — only those sessions are used. Leave unchecked to use the
              filtered time window (newest slice) as before.
            </p>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {digestPickerRuns.map((r) => (
                <CardPanel key={r.id} contentClassName="py-1.5 px-2">
                  <label className="flex items-start gap-2 cursor-pointer text-[10px] text-muted-foreground leading-snug">
                    <input
                      type="checkbox"
                      className="h-3 w-3 accent-primary shrink-0 mt-0.5"
                      checked={digestSelectedRunIds.includes(r.id)}
                      onChange={() => toggleDigestRunSelected(r.id)}
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-foreground/90">{r.id.slice(0, 8)}…</span>
                      {" · "}
                      {formatRunPickerLine(r)}
                    </span>
                  </label>
                </CardPanel>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center text-[10px]">
              <button
                type="button"
                className="rounded border border-border bg-background px-2 py-1 hover:bg-muted"
                onClick={() => setDigestSelectedRunIds(digestPickerRuns.map((x) => x.id))}
              >
                Select all listed
              </button>
              <button
                type="button"
                className="rounded border border-border bg-background px-2 py-1 hover:bg-muted"
                onClick={() => setDigestSelectedRunIds([])}
              >
                Clear selection
              </button>
              <span className="text-muted-foreground">{digestSelectedRunIds.length} selected</span>
            </div>
          </CardPanel>
        ) : null}
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
              Clear digest
            </button>
          ) : null}
        </div>
        {digestErr ? <p className="text-[11px] text-destructive">{digestErr}</p> : null}
        {digest ? (
          <div className="space-y-3">
            <CardPanel contentClassName="space-y-2">
              <div className="text-[10px] text-muted-foreground">
                Best lap in series:{" "}
                {digest.highlight.bestLapSeconds != null ? `${digest.highlight.bestLapSeconds.toFixed(3)}s` : "—"}
                {digest.highlight.bestLapRunId ? ` · run ${digest.highlight.bestLapRunId.slice(0, 8)}…` : ""}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-[10px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-left">
                      <th className="table-col-header px-1.5 py-1">When</th>
                      <th className="table-col-header px-1.5 py-1">Track</th>
                      <th className="table-col-header px-1.5 py-1">Best</th>
                      <th className="table-col-header px-1.5 py-1">Avg 5</th>
                      <th className="table-col-header px-1.5 py-1">Avg 10</th>
                      <th className="table-col-header px-1.5 py-1">Setup Δ keys</th>
                    </tr>
                  </thead>
                  <tbody>
                    {digest.runs.map((r) => (
                      <tr key={r.runId} className="border-b border-border/60 align-top">
                        <td className="px-1.5 py-1 font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                          {r.sortIso.slice(0, 16)}
                        </td>
                        <td className="px-1.5 py-1">{r.trackName}</td>
                        <td className="px-1.5 py-1 font-mono tabular-nums">
                          {r.lapSummary.bestLapSeconds != null && Number.isFinite(r.lapSummary.bestLapSeconds)
                            ? formatLap(r.lapSummary.bestLapSeconds)
                            : "—"}
                        </td>
                        <td className="px-1.5 py-1 font-mono tabular-nums">
                          {r.lapSummary.avgTop5Seconds != null && Number.isFinite(r.lapSummary.avgTop5Seconds)
                            ? formatLap(r.lapSummary.avgTop5Seconds)
                            : "—"}
                        </td>
                        <td className="px-1.5 py-1 font-mono tabular-nums">
                          {r.lapSummary.avgTop10Seconds != null && Number.isFinite(r.lapSummary.avgTop10Seconds)
                            ? formatLap(r.lapSummary.avgTop10Seconds)
                            : "—"}
                        </td>
                        <td className="px-1.5 py-1 text-muted-foreground break-words max-w-[12rem]">
                          {r.setupKeysChangedFromPrevious?.length
                            ? r.setupKeysChangedFromPrevious.slice(0, 8).join(", ") +
                              (r.setupKeysChangedFromPrevious.length > 8 ? "…" : "")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardPanel>

            {digest.runs.length >= 2 &&
            digestPairRunIdA &&
            digestPairRunIdB &&
            digestPairRunIdA !== digestPairRunIdB ? (
              <CardPanel overflowHidden={false} contentClassName="space-y-2">
                <div className="text-[10px] font-medium text-muted-foreground">Pair compare (setup + laps)</div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <label className="text-[10px] text-muted-foreground" htmlFor="digest-pair-a">
                      Run A
                    </label>
                    <select
                      id="digest-pair-a"
                      className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
                      value={digestPairRunIdA}
                      onChange={(e) => setDigestPairRunIdA(e.target.value)}
                    >
                      {digest.runs.map((r) => (
                        <option key={r.runId} value={r.runId}>
                          {digestRunLabel(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <label className="text-[10px] text-muted-foreground" htmlFor="digest-pair-b">
                      Run B
                    </label>
                    <select
                      id="digest-pair-b"
                      className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
                      value={digestPairRunIdB}
                      onChange={(e) => setDigestPairRunIdB(e.target.value)}
                    >
                      {digest.runs.map((r) => (
                        <option key={`b-${r.runId}`} value={r.runId}>
                          {digestRunLabel(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <EngineerRunPairVisualCompare
                  runIdA={digestPairRunIdA}
                  runIdB={digestPairRunIdB}
                  labelA={digestPairLabelA}
                  labelB={digestPairLabelB}
                />
              </CardPanel>
            ) : digest.runs.length < 2 ? (
              <p className="text-[11px] text-muted-foreground">
                Digest needs at least two runs in the series to open side-by-side setup and laps.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{inner}</div>;
  }

  return <CardPanel overflowHidden={false} contentClassName="space-y-4">{inner}</CardPanel>;
}
