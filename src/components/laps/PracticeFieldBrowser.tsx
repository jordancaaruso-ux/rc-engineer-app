"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { importedSessionTimeForDisplay } from "@/lib/lapImport/labels";
import { formatLap } from "@/lib/runLaps";
import { formatRunDateTime, formatRunDateWeekday } from "@/lib/formatDate";
import {
  MAX_KNOWN_COMPETITORS,
  serializeKnownCompetitorsSetting,
  type KnownCompetitor,
} from "@/lib/speedhive/knownCompetitors";
import {
  PRACTICE_FIELD_SOURCE_LABEL,
  filterPracticeField,
  practiceDriverDisplayName,
  practiceDriverIsSaved,
  practiceQueryAsTransponder,
  type PracticeFieldDriver,
  type PracticeFieldSession,
  type PracticeFieldSource,
} from "@/lib/practiceField/practiceField";

/**
 * Everyone who practised at a track: a search box, your saved drivers as one-tap filters, and
 * the list — quickest first, a driver's sessions folded under them.
 *
 * One piece, two hosts. On the lap analysis page a session is imported and opened on its own
 * (`mode="open"`); in the lap sheet's Practice tab a session is ticked and becomes a column
 * (`mode="tick"`). Everything else — the search, the buttons, Save, the timing-site switch — is
 * the same on purpose, so it is learned once.
 *
 * Nothing is fetched until asked. "Asked" is the Find button on the page, and opening the tab
 * in the lap sheet (`autoLook`); after that the search narrows a list already in hand and
 * touches nothing. A track on both timing sites shows ONE site's list at a time, never a merge
 * (founder call 2026-09-21): the same driver is named differently on each.
 */

export type PracticeFieldPick = {
  importedSessionId: string;
  displayName: string;
};

type LoadedLook = {
  kind: "loaded";
  source: PracticeFieldSource;
  dayYmd: string | null;
  drivers: PracticeFieldDriver[];
};

type LookState = { kind: "idle" } | { kind: "looking" } | LoadedLook | { kind: "failed"; message: string };

/**
 * Looks already made, kept by the host across this component's mounts. The lap sheet's phone
 * sheet unmounts its contents every time it closes; without this, reopening it would ask the
 * timing site the same question again. Keyed by track, site and day.
 */
export type PracticeLookCache = Map<string, LoadedLook>;

const inputClass =
  "min-w-0 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary-ink/50";

/** "19 Jul, 3:30 PM" — on the track's clock where the timing site printed one. */
function sessionWhen(iso: string, source: PracticeFieldSource, sourceUrl: string): string {
  const shown = importedSessionTimeForDisplay(iso, {
    timingSource: source === "liverc" ? "liverc" : "speedhive",
    sourceUrl,
  });
  return formatRunDateTime(shown.iso, shown.timeZone);
}

function dayLabel(ymd: string): string {
  // Noon, so no zone can tip the date over either edge.
  return formatRunDateWeekday(`${ymd}T12:00:00Z`, "UTC");
}

export function PracticeFieldBrowser({
  trackId,
  trackName,
  sources,
  preferredSource = null,
  initialDayYmd,
  maxDayYmd,
  mode,
  autoLook = false,
  competitors,
  tickedImportIds,
  onTick,
  onOpenSession,
  lookCache,
  onSavedChange,
}: {
  trackId: string;
  trackName: string;
  /** The timing sites this track can be read from. Two means a switch; never a merged list. */
  sources: PracticeFieldSource[];
  /** Which site to open on when there are two — the one the run's own laps came from. */
  preferredSource?: PracticeFieldSource | null;
  /** YYYY-MM-DD, the track's own date. LiveRC only; MYLAPS reads recent activity across days. */
  initialDayYmd: string;
  maxDayYmd?: string;
  mode: "open" | "tick";
  /** Find as soon as this mounts. The lap sheet's tab is the press; the page has a button. */
  autoLook?: boolean;
  /** The saved drivers, when the host already holds them; fetched here otherwise. */
  competitors?: KnownCompetitor[];
  /** `tick` mode: the library ids currently on the sheet. */
  tickedImportIds?: readonly string[];
  /** `tick` mode: a session went on or came off the sheet. */
  onTick?: (pick: PracticeFieldPick, on: boolean) => void;
  /** `open` mode: a brought-in session was asked for. */
  onOpenSession?: (importedSessionId: string) => void;
  /** See {@link PracticeLookCache}. Omitted on the page, where Find is a button and means "ask". */
  lookCache?: PracticeLookCache;
  /** The saved drivers changed here (Save) — the lap sheet names columns from the same list. */
  onSavedChange?: (saved: KnownCompetitor[]) => void;
}) {
  const [source, setSource] = useState<PracticeFieldSource>(
    preferredSource && sources.includes(preferredSource) ? preferredSource : sources[0] ?? "liverc"
  );
  const [dayYmd, setDayYmd] = useState(initialDayYmd);
  const [look, setLook] = useState<LookState>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [onlyTransponder, setOnlyTransponder] = useState<string | null>(null);
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<KnownCompetitor[]>(competitors ?? []);
  /** MYLAPS sessions, fetched per driver when opened: chip → sessions, "loading", or a reason. */
  const [chipSessions, setChipSessions] = useState<
    Record<string, PracticeFieldSession[] | "loading" | { hint: string }>
  >({});
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  /** Sessions brought in since the look: url -> library id. The look's own answer is never edited. */
  const [broughtIn, setBroughtIn] = useState<Record<string, string>>({});
  const importedIdOf = (s: PracticeFieldSession): string | null =>
    s.importedSessionId ?? broughtIn[s.sessionUrl] ?? null;
  const [note, setNote] = useState<string | null>(null);
  const [namingKey, setNamingKey] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const lookSeq = useRef(0);

  useEffect(() => {
    if (competitors) return;
    let alive = true;
    fetch("/api/settings/known-competitors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { competitors?: KnownCompetitor[] } | null) => {
        if (alive && data?.competitors) setSaved(data.competitors);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [competitors]);

  const runLook = useCallback(
    async (nextSource: PracticeFieldSource, nextDay: string) => {
      const seq = ++lookSeq.current;
      setNote(null);
      setOpenKeys({});
      setChipSessions({});
      const cacheKey = `${trackId}|${nextSource}|${nextSource === "liverc" ? nextDay : ""}`;
      const held = lookCache?.get(cacheKey);
      if (held) {
        setLook(held);
        return;
      }
      setLook({ kind: "looking" });
      try {
        const res = await fetch("/api/laps/practice-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId, source: nextSource, day: nextDay }),
        });
        const data = (await res.json().catch(() => null)) as {
          source?: PracticeFieldSource;
          dayYmd?: string | null;
          drivers?: PracticeFieldDriver[];
          hint?: string | null;
          error?: string;
        } | null;
        if (seq !== lookSeq.current) return;
        if (!res.ok || !data?.drivers) {
          setLook({ kind: "failed", message: data?.error ?? data?.hint ?? "That didn't work." });
          return;
        }
        if (data.hint && data.drivers.length === 0) {
          setLook({ kind: "failed", message: data.hint });
          return;
        }
        const loaded: LoadedLook = {
          kind: "loaded",
          source: data.source ?? nextSource,
          dayYmd: data.dayYmd ?? null,
          drivers: data.drivers,
        };
        lookCache?.set(cacheKey, loaded);
        setLook(loaded);
      } catch {
        if (seq === lookSeq.current) setLook({ kind: "failed", message: "That didn't work." });
      }
    },
    [trackId, lookCache]
  );

  // The lap sheet's tab is the press. Once, on mount — a later change of day or site asks again
  // from its own control.
  const autoLooked = useRef(false);
  useEffect(() => {
    if (!autoLook || autoLooked.current || sources.length === 0) return;
    autoLooked.current = true;
    void runLook(source, dayYmd);
  }, [autoLook, sources.length, runLook, source, dayYmd]);

  const drivers = look.kind === "loaded" ? look.drivers : null;
  const visible = useMemo(
    () => (drivers ? filterPracticeField(drivers, { query, onlyTransponder, saved }) : []),
    [drivers, query, onlyTransponder, saved]
  );

  const loadChipSessions = useCallback(
    async (transponder: string) => {
      setChipSessions((m) => ({ ...m, [transponder]: "loading" }));
      try {
        const res = await fetch("/api/laps/competitor-practice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transponder, trackId }),
        });
        const data = (await res.json().catch(() => null)) as {
          sessions?: PracticeFieldSession[];
          hint?: string | null;
          error?: string;
        } | null;
        const sessions = res.ok ? data?.sessions ?? [] : [];
        setChipSessions((m) => ({
          ...m,
          [transponder]:
            sessions.length > 0
              ? sessions
              : { hint: data?.error ?? data?.hint ?? "No laps found for that transponder." },
        }));
        return sessions;
      } catch {
        setChipSessions((m) => ({ ...m, [transponder]: { hint: "Couldn't reach MYLAPS just now." } }));
        return [];
      }
    },
    [trackId]
  );

  function toggleDriver(d: PracticeFieldDriver, expanded: boolean) {
    setOpenKeys((m) => ({ ...m, [d.key]: !expanded }));
    if (!expanded && d.sessions == null && d.transponder && chipSessions[d.transponder] == null) {
      void loadChipSessions(d.transponder);
    }
  }

  /** MYLAPS only: a number that isn't in the recent list, asked for by itself. */
  async function lookUpTransponder(transponder: string) {
    if (look.kind !== "loaded") return;
    setNote(null);
    const sessions = await loadChipSessions(transponder);
    if (sessions.length === 0) return;
    const added: PracticeFieldDriver = {
      key: `chip:${transponder}`,
      siteName: null,
      transponder,
      className: null,
      sessions: null,
      sessionCount: sessions.length,
      latestIso: sessions[0]?.sessionCompletedAtIso ?? null,
      bestLapSeconds: null,
      isViewer: false,
    };
    setLook({ ...look, drivers: [...look.drivers.filter((d) => d.key !== added.key), added] });
    setOpenKeys((m) => ({ ...m, [added.key]: true }));
  }

  async function bringIn(session: PracticeFieldSession): Promise<string | null> {
    const already = importedIdOf(session);
    if (already) return already;
    setBusyUrl(session.sessionUrl);
    setNote(null);
    try {
      const res = await fetch("/api/lap-time-sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [session.sessionUrl] }),
      });
      const data = (await res.json().catch(() => null)) as {
        results?: Array<{ success?: boolean; importedSessionId?: string; error?: string }>;
        error?: string;
      } | null;
      const first = data?.results?.[0];
      if (first?.success && first.importedSessionId) {
        const id = first.importedSessionId;
        setBroughtIn((m) => ({ ...m, [session.sessionUrl]: id }));
        return id;
      }
      setNote(first?.error ?? data?.error ?? "Couldn't import that session.");
      return null;
    } catch {
      setNote("Couldn't import that session.");
      return null;
    } finally {
      setBusyUrl(null);
    }
  }

  async function onSessionPress(d: PracticeFieldDriver, session: PracticeFieldSession) {
    if (busyUrl) return;
    const heldId = importedIdOf(session);
    if (mode === "tick" && heldId != null && tickedImportIds?.includes(heldId)) {
      onTick?.({ importedSessionId: heldId, displayName: practiceDriverDisplayName(d, saved) }, false);
      return;
    }
    const wasImported = heldId != null;
    const id = await bringIn(session);
    if (!id) return;
    // Beside the laps, write down whose they are and where — the import cannot tell, and the
    // lap sheet needs both: the name to head the column, the track to keep it in scope. Awaited,
    // because the host re-reads the library the moment it hears of the tick.
    if (d.transponder) {
      await fetch(`/api/lap-time-sessions/${encodeURIComponent(id)}/practice-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transponder: d.transponder, siteName: d.siteName, trackId }),
      }).catch(() => {});
    }
    if (mode === "tick") {
      onTick?.({ importedSessionId: id, displayName: practiceDriverDisplayName(d, saved) }, true);
    } else if (wasImported) {
      onOpenSession?.(id);
    }
  }

  async function saveDriver(d: PracticeFieldDriver, name: string) {
    if (!d.transponder) return;
    if (saved.length >= MAX_KNOWN_COMPETITORS) {
      setNote(`That's the ${MAX_KNOWN_COMPETITORS} the list holds.`);
      return;
    }
    const next = [...saved.filter((s) => s.transponder !== d.transponder), { name, transponder: d.transponder }];
    setSaved(next);
    onSavedChange?.(next);
    setNamingKey(null);
    setNameDraft("");
    try {
      const res = await fetch("/api/settings/known-competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knownCompetitors: serializeKnownCompetitorsSetting(next) }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSaved(saved);
      onSavedChange?.(saved);
      setNote("Couldn't save that driver.");
    }
  }

  function sessionsOf(d: PracticeFieldDriver): PracticeFieldSession[] | "loading" | { hint: string } {
    if (d.sessions) return d.sessions;
    return (d.transponder ? chipSessions[d.transponder] : null) ?? "loading";
  }

  if (sources.length === 0) return null;

  const loadedSource = look.kind === "loaded" ? look.source : source;
  const where =
    look.kind === "loaded" && look.source === "liverc" && look.dayYmd ? dayLabel(look.dayYmd) : "recent practice";
  const onlySaved = onlyTransponder ? saved.find((s) => s.transponder === onlyTransponder) ?? null : null;
  const askedTransponder = onlySaved?.transponder ?? practiceQueryAsTransponder(query);
  const totalSessions = drivers?.reduce((n, d) => n + d.sessionCount, 0) ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {sources.length > 1 ? (
          <div role="tablist" aria-label="Timing site" className="inline-flex rounded-md bg-muted p-0.5">
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => {
                  if (source === s) return;
                  setSource(s);
                  setQuery("");
                  setOnlyTransponder(null);
                  if (mode === "tick" || look.kind !== "idle") void runLook(s, dayYmd);
                }}
                className={cn(
                  "tap-active rounded px-3 py-1.5 text-[12px] font-medium transition",
                  source === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {PRACTICE_FIELD_SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}
        {source === "liverc" ? (
          <input
            type="date"
            value={dayYmd}
            max={maxDayYmd}
            aria-label="Day"
            onChange={(e) => {
              const next = e.target.value;
              if (!next) return;
              setDayYmd(next);
              if (mode === "tick") void runLook(source, next);
              else setLook({ kind: "idle" });
            }}
            className={cn(inputClass, "flex-1 tabular-nums")}
          />
        ) : null}
        {mode === "open" ? (
          <button
            type="button"
            disabled={look.kind === "looking"}
            onClick={() => void runLook(source, dayYmd)}
            className="btn-surface shrink-0 px-3 py-2 text-[13px] font-medium disabled:opacity-60"
          >
            {look.kind === "looking" ? "Finding…" : "Find"}
          </button>
        ) : null}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOnlyTransponder(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && look.kind === "idle") void runLook(source, dayYmd);
        }}
        placeholder="Name or transponder"
        aria-label="Search by name or transponder"
        autoComplete="off"
        className={cn(inputClass, "w-full")}
      />

      {saved.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Drivers you know">
          {saved.map((s) => {
            const on = onlyTransponder === s.transponder;
            return (
              <button
                key={s.transponder}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setOnlyTransponder(on ? null : s.transponder);
                  setQuery("");
                  if (look.kind === "idle") void runLook(source, dayYmd);
                }}
                className={cn(
                  "tap-active rounded-full border px-3 py-1 text-[12px] font-medium transition",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:bg-muted/60"
                )}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {look.kind === "looking" ? <p className="ui-caption">Finding…</p> : null}
      {look.kind === "failed" ? <p className="ui-caption">{look.message}</p> : null}

      {drivers && drivers.length > 0 ? (
        <p className="ui-caption tabular-nums">
          {drivers.length} driver{drivers.length === 1 ? "" : "s"} · {totalSessions}{" "}
          {loadedSource === "liverc" ? "session" : "visit"}
          {totalSessions === 1 ? "" : "s"} · {where}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border bg-card">
          {visible.map((d) => {
            const expanded = openKeys[d.key] ?? visible.length === 1;
            const name = practiceDriverDisplayName(d, saved);
            const isSaved = practiceDriverIsSaved(d, saved);
            const theirs = loadedSource === "mylaps" && d.siteName && d.siteName !== name ? d.siteName : null;
            const sessions = expanded ? sessionsOf(d) : null;
            return (
              <li key={d.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleDriver(d, expanded)}
                  className="tap-active flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-foreground [overflow-wrap:anywhere]">
                      {name}
                      {d.isViewer ? (
                        <span className="ml-1.5 rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">
                          You
                        </span>
                      ) : isSaved ? (
                        <span className="ml-1.5 rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">
                          Yours
                        </span>
                      ) : null}
                    </span>
                    <span className="ui-caption mt-0.5 block tabular-nums">
                      {[
                        d.className,
                        d.transponder,
                        theirs ? `MYLAPS “${theirs}”` : null,
                        `${d.sessionCount} ${loadedSource === "liverc" ? "session" : "visit"}${d.sessionCount === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-foreground">
                    {d.bestLapSeconds != null ? formatLap(d.bestLapSeconds) : null}
                    <ChevronRight
                      className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")}
                      aria-hidden
                    />
                  </span>
                </button>

                {expanded ? (
                  <div className="space-y-2 border-t border-border/60 bg-muted/40 px-2.5 pb-2.5 pt-2">
                    {sessions === "loading" ? <p className="ui-caption px-1">Finding…</p> : null}
                    {sessions && sessions !== "loading" && !Array.isArray(sessions) ? (
                      <p className="ui-caption px-1">{sessions.hint}</p>
                    ) : null}
                    {Array.isArray(sessions) && sessions.length > 0 ? (
                      <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border bg-card">
                        {sessions.map((s) => {
                          const importedId = importedIdOf(s);
                          const ticked = importedId != null && (tickedImportIds?.includes(importedId) ?? false);
                          const busy = busyUrl === s.sessionUrl;
                          return (
                            <li key={s.sessionUrl}>
                              <button
                                type="button"
                                role={mode === "tick" ? "checkbox" : undefined}
                                aria-checked={mode === "tick" ? ticked : undefined}
                                disabled={busyUrl != null}
                                onClick={() => void onSessionPress(d, s)}
                                className="tap-active flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition hover:bg-muted/40 disabled:opacity-60"
                              >
                                {mode === "tick" ? (
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "grid size-[18px] shrink-0 place-items-center rounded border",
                                      ticked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                                    )}
                                  >
                                    {ticked ? <Check className="size-3" /> : null}
                                  </span>
                                ) : null}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] text-foreground">
                                    {s.sessionCompletedAtIso
                                      ? sessionWhen(s.sessionCompletedAtIso, loadedSource, s.sessionUrl)
                                      : "Practice"}
                                  </span>
                                  <span className="ui-caption mt-0.5 block truncate tabular-nums">
                                    {[
                                      s.lapCount != null ? `${s.lapCount} lap${s.lapCount === 1 ? "" : "s"}` : null,
                                      s.bestLapSeconds != null ? `best ${formatLap(s.bestLapSeconds)}` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </span>
                                <span className="type-timestamp shrink-0">
                                  {busy
                                    ? "Importing…"
                                    : mode === "open"
                                      ? importedId
                                        ? "Open"
                                        : "Import"
                                      : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}

                    {!isSaved && !d.isViewer && d.transponder ? (
                      namingKey === d.key ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (nameDraft.trim()) void saveDriver(d, nameDraft.trim());
                          }}
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            placeholder="Their name"
                            aria-label="Their name"
                            className={cn(inputClass, "flex-1 py-1.5 text-[13px]")}
                          />
                          <button type="submit" className="btn-surface shrink-0 px-2.5 py-1.5 text-[12px] font-medium">
                            Save
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            // The site's name is good enough to save under. With none, ask — a row
                            // saved as a bare number is unreadable a week later.
                            if (d.siteName) void saveDriver(d, d.siteName);
                            else {
                              setNamingKey(d.key);
                              setNameDraft("");
                            }
                          }}
                          className="btn-surface px-2.5 py-1.5 text-[12px] font-medium"
                        >
                          Save
                        </button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {drivers && visible.length === 0 ? (
        <p className="ui-caption">
          {drivers.length === 0
            ? `Nobody on ${trackName}’s ${PRACTICE_FIELD_SOURCE_LABEL[loadedSource]} ${
                loadedSource === "liverc" ? `practice list for ${where}` : "recent practice"
              }.`
            : onlySaved
              ? `${onlySaved.name} (${onlySaved.transponder}) isn’t in ${
                  loadedSource === "liverc" ? `${where}’s practice` : "recent practice"
                }.`
              : `No one matching “${query.trim()}”.`}
        </p>
      ) : null}

      {drivers && visible.length === 0 && loadedSource === "mylaps" && askedTransponder ? (
        <button
          type="button"
          disabled={chipSessions[askedTransponder] === "loading"}
          onClick={() => void lookUpTransponder(askedTransponder)}
          className="btn-surface px-3 py-2 text-[13px] font-medium disabled:opacity-60"
        >
          {chipSessions[askedTransponder] === "loading" ? "Finding…" : `Find ${askedTransponder}`}
        </button>
      ) : null}
      {drivers && visible.length === 0 && askedTransponder && typeof chipSessions[askedTransponder] === "object" && !Array.isArray(chipSessions[askedTransponder]) ? (
        <p className="ui-caption">{(chipSessions[askedTransponder] as { hint: string }).hint}</p>
      ) : null}

      {note ? <p className="ui-caption">{note}</p> : null}
    </div>
  );
}
