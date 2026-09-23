"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { MyRcmPdfImportCard } from "@/components/runs/MyRcmPdfImportCard";
import { ActionToast } from "@/components/ui/ActionToast";
import { SessionDeletedUndo } from "@/components/laps/SessionDeletedUndo";
import { deletedSessionsMessage, setImportedSessionsHidden } from "@/components/laps/sessionDeletion";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { importedSessionTitle } from "@/lib/lapImport/sessionTitle";
import { groupNamedSessions, type SessionName } from "@/lib/lapImport/sessionNaming";
import { MYRCM_PDF_SOURCE_PREFIX } from "@/lib/lapUrlParsers/myRcmPdfSource";
import { sameLocalCalendarDay } from "@/lib/lapCompareScope";
import { parseSpeedhivePracticeActivityRef } from "@/lib/speedhive/speedhivePracticeUrl";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import type { ImportedSessionFieldStatsPreviewV1 } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { calendarYmdInTimeZone, formatRunDateTime } from "@/lib/formatDate";
import { cn } from "@/lib/utils";

type SessionRow = {
  id: string;
  createdAt: string;
  sessionCompletedAt?: string | null;
  sourceUrl: string;
  parserId: string;
  linkedRunId: string | null;
  parsedPayload?: unknown;
  fieldStatsPreview?: ImportedSessionFieldStatsPreviewV1 | null;
  trackName?: string | null;
  eventDetectionSource?: string | null;
  eventDetectionSessionLabel?: string | null;
  eventRaceClass?: string | null;
  /** Whose, which run, where and when — named on the server with the rest of its day. */
  name?: SessionName | null;
};

/** Rows drawn before the "show more" line. Twenty is about a phone screen of scrolling. */
const PAGE_SIZE = 20;

function normalizeDriverName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Was the viewer on this timing sheet?
 *
 * The honest answer to "why is there a session here I never chose to upload": pasting ONE
 * LiveRC event page imports every race on it — thirty classes, most of them strangers'. That
 * is the right behaviour (it is what makes a rival's heat available at all) and it is also
 * why a list of 200 reads as a list of somebody else's racing.
 *
 * There is no "how did this get here" column on the row, and adding one would only describe
 * new imports. Whether YOUR name is on the sheet is the question actually being asked, it is
 * answerable from data already loaded, and it stays true for rows imported before today.
 */
function sessionHasDriver(parsedPayload: unknown, viewerNorms: Set<string>): boolean {
  if (viewerNorms.size === 0) return false;
  if (!parsedPayload || typeof parsedPayload !== "object") return false;
  const drivers = (parsedPayload as { sessionDrivers?: unknown }).sessionDrivers;
  if (!Array.isArray(drivers)) return false;
  for (const raw of drivers) {
    if (!raw || typeof raw !== "object") continue;
    const name = (raw as { driverName?: unknown }).driverName;
    if (typeof name === "string" && viewerNorms.has(normalizeDriverName(name))) return true;
  }
  return false;
}

type ImportResultRow =
  | { url: string; success: true; importedSessionId: string }
  | { url: string; success: false; error: string };

/**
 * Where timing sheets come in, and the list they become.
 *
 * This replaces a workbench. The old `/laps/import` could pull a URL in and then showed
 * you the parse as raw JSON in a `<pre>` — fine for me, useless for reading a race. The
 * pipe was never the missing piece: importing a meeting you had no part in has worked for
 * as long as imports have, because every parser stores the whole field, not just the row
 * that matched your name. What was missing was somewhere to READ one.
 *
 * So every row here opens the lap sheet on that session, and a row is written to be worth
 * tapping — who, when, how many were out, what the middle of the field ran.
 */
export function LapAnalysisLibrary({
  eventId,
  viewerNames = [],
  importSlot = null,
}: {
  eventId?: string | null;
  /** Every spelling timing prints the viewer under — see `sessionHasDriver`. */
  viewerNames?: string[];
  /**
   * Rendered in the import column, under the two upload doors. It is another way to bring a
   * session in, so it belongs beside them — below the sessions list a driver with a hundred
   * rows never scrolls to it (founder call, 2026-09-16).
   */
  importSlot?: ReactNode;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const viewerNorms = useMemo(
    () => new Set(viewerNames.map(normalizeDriverName).filter(Boolean)),
    [viewerNames]
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<ImportResultRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  /** How many imports the account holds — the API sends the newest 200, and says so. */
  const [total, setTotal] = useState<number | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  /**
   * Row text computed once per session, not once per render of a filtered list — the
   * driver name comes out of `parsedPayload`, which is the whole parse, and doing that
   * inside the map meant re-walking every payload on every keystroke of the search box.
   */
  const rows = useMemo(
    () =>
      sessions.map((s) => {
        const name = s.name ?? null;
        const parsed = primaryLapRowsFromImportedPayload(s.parsedPayload);
        const whenIso = resolveImportedSessionDisplayTimeIso({
          sessionCompletedAt: s.sessionCompletedAt ?? null,
          parsedPayload: s.parsedPayload,
          createdAt: s.createdAt,
        });
        const drivers = s.fieldStatsPreview?.driverCount ?? 0;
        // Named on the server (founder call, 2026-09-23: whose, which run, where, when). The old
        // namer stays only as the fallback for a row that came back without a name.
        const title =
          name?.title ??
          importedSessionTitle({
            ...s,
            driverName: parsed?.driverName ?? null,
            driverCount: drivers,
            sessionNumber: parseSpeedhivePracticeActivityRef(s.sourceUrl)?.trainingSessionId ?? null,
          });
        /*
         * The day, track and time live on the group heading and the row's right edge now (the
         * track's clock, as the 2026-09-18 ruling wants). What's left for the second line is a
         * race's class and field size, and why an old race sits up here: it came in later. Only
         * when the two days differ — "added" on the day it was raced says nothing.
         */
        // Upload day on the phone's calendar against the session's day on the track's.
        const addedLater = name
          ? calendarYmdInTimeZone(s.createdAt, Intl.DateTimeFormat().resolvedOptions().timeZone) !== name.dayKey
          : !sameLocalCalendarDay(s.createdAt, whenIso);
        const detail = [
          name?.detail ?? null,
          addedLater ? `added ${formatRunDateTime(s.createdAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          id: s.id,
          name,
          title,
          time: name?.timeLabel ?? null,
          detail,
          // On a run, its laps are that run's: Select mode leaves it alone.
          onRun: s.linkedRunId != null,
          /*
           * A PDF you uploaded by hand is yours whether or not your name is on it. The
           * "mine" scope exists because one pasted LiveRC event page imports thirty
           * strangers' races; a MyRCM result is one race, chosen one file at a time —
           * and the default scope was hiding every one of them (2026-08-27: "I've
           * imported a bunch of MyRCM sessions, but they're not in the list").
           */
          isMine:
            s.linkedRunId != null ||
            s.sourceUrl.startsWith(MYRCM_PDF_SOURCE_PREFIX) ||
            sessionHasDriver(s.parsedPayload, viewerNorms),
          // The URL is in the haystack on purpose: a LiveRC race URL carries the club and
          // the class, which is often the only place the class name appears at all.
          haystack: [title, name?.autoTitle, name?.groupLabel, detail, s.sourceUrl]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      }),
    [sessions, viewerNorms]
  );

  const mineCount = useMemo(() => rows.filter((r) => r.isMine).length, [rows]);

  const filtered = useMemo(() => {
    // No configured name = no way to tell whose sheet is whose, and the toggle is hidden.
    // Without this guard the default scope would silently filter the whole list to nothing
    // on exactly the accounts that can't see why.
    const canScope = viewerNorms.size > 0;
    const base = canScope && scope === "mine" ? rows.filter((r) => r.isMine) : rows;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    const terms = q.split(/\s+/);
    return base.filter((r) => terms.every((t) => r.haystack.includes(t)));
  }, [rows, query, scope, viewerNorms]);

  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  /** Under "Tue 22 Sept · Chargers RC" headings, in upload order, each day newest first. */
  const visibleGroups = useMemo(
    () => groupNamedSessions(visible, (row) => row.name ?? undefined),
    [visible]
  );

  /*
   * Select mode: tick many, delete them at once (founder pick, 2026-09-23). What "Select all"
   * reaches is everything the scope and search show, not just the twenty drawn — clearing an
   * event page's thirty races is the job it exists for. Sessions on a run are never ticked.
   */
  const [selecting, setSelecting] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [selectErr, setSelectErr] = useState<string | null>(null);
  const [undoIds, setUndoIds] = useState<string[] | null>(null);
  const tickable = useMemo(() => filtered.filter((r) => !r.onRun), [filtered]);
  const tickedIds = useMemo(() => tickable.filter((r) => ticked.has(r.id)).map((r) => r.id), [tickable, ticked]);
  const allTicked = tickable.length > 0 && tickedIds.length === tickable.length;
  /*
   * The Select bar is portaled to <body>: a `fixed` element inside the page body's transformed
   * wrapper is fixed to THAT box, not the screen, and landed at the foot of a long list instead of
   * over the dock (same trap as the run form's save bar). Gated until mount for the portal.
   */
  const [barMounted, setBarMounted] = useState(false);
  useEffect(() => setBarMounted(true), []);

  const loadSessions = useCallback(async () => {
    setListErr(null);
    try {
      const res = await fetch("/api/lap-time-sessions", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setListErr((data as { error?: string })?.error ?? "Could not load sessions.");
        return;
      }
      const loaded = (data as { sessions?: SessionRow[]; total?: number })?.sessions;
      setSessions(Array.isArray(loaded) ? loaded : []);
      const total = (data as { total?: number })?.total;
      setTotal(typeof total === "number" ? total : null);
    } catch {
      setListErr("Could not load sessions.");
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  function toggleTick(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelecting(false);
    setTicked(new Set());
    setSelectErr(null);
  }

  async function deleteTicked() {
    if (tickedIds.length === 0) return;
    setDeleting(true);
    setSelectErr(null);
    const res = await setImportedSessionsHidden(tickedIds, true);
    setDeleting(false);
    if (!res.ok) {
      setSelectErr(res.error);
      return;
    }
    const gone = new Set(res.ids);
    setSessions((prev) => prev.filter((s) => !gone.has(s.id)));
    setTotal((t) => (t == null ? t : Math.max(0, t - res.ids.length)));
    exitSelect();
    if (res.ids.length > 0) setUndoIds(res.ids);
  }

  async function undoDelete(ids: string[]) {
    await setImportedSessionsHidden(ids, false);
    await loadSessions();
  }

  const runImport = useCallback(
    async (urls: string[]) => {
      setBusy(true);
      setHint(null);
      setLastResults([]);
      try {
        const res = await fetch("/api/lap-time-sessions/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls, ...(eventId ? { eventId } : {}) }),
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
        const ok = mapped.filter((m) => m.success);
        const fail = mapped.length - ok.length;
        setHint(
          mapped.length === 0
            ? "No results returned."
            : `Imported ${ok.length} session${ok.length === 1 ? "" : "s"}${fail > 0 ? ` · ${fail} failed` : ""}.`
        );
        setText("");
        await loadSessions();
        /*
         * One link in, one sheet open. Pasting a single session URL is someone asking to
         * look at that session — making them find the row they just created underneath the
         * import box is the same "tool with no door" problem this page exists to fix. Two
         * or more is a filing job, and the list is the right answer to it.
         */
        if (ok.length === 1 && mapped.length === 1) {
          router.push(`/laps/analysis?session=${encodeURIComponent(ok[0]!.importedSessionId)}`);
        }
      } catch {
        setHint("Import request failed.");
      } finally {
        setBusy(false);
      }
    },
    [eventId, loadSessions, router]
  );

  async function onImport() {
    const urls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setHint("Paste one or more links (one per line).");
      return;
    }
    await runImport(urls);
  }

  return (
    /*
     * Two columns from `lg`: bringing a session in is a one-off act, and the list of
     * sessions is the thing you came for. Stacked, the import box and its MyRCM sibling
     * filled a desktop screen on their own and the list — the actual content — started
     * below the fold (founder call, 2026-08-27). Narrow stays stacked, import first,
     * because on a phone there is no such thing as beside.
     */
    <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-5">
      <div className="space-y-3">
        <CardPanel contentClassName="space-y-2.5">
          <Eyebrow>Upload a timing link</Eyebrow>
          {/* One row. It grows as you paste — a 3-row box that is empty 95% of the time
              was most of what made this card fill a screen. */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder={"Paste a LiveRC or Speedhive link…"}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none tabular-nums"
            disabled={busy}
            aria-label="Timing links, one per line"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onImport()}
              className="rounded-lg primary-face bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
            {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
          </div>
          {lastResults.some((r) => !r.success) ? (
            <ul className="space-y-1 border-t border-border pt-2.5 text-[11px]">
              {lastResults
                .filter((r): r is Extract<ImportResultRow, { success: false }> => !r.success)
                .map((r) => (
                  <li key={r.url + r.error} className="flex flex-wrap gap-x-2">
                    <span className="shrink-0 font-medium text-destructive">Failed</span>
                    <span className="min-w-0 break-all text-muted-foreground">{r.url}</span>
                    <span className="text-destructive">{r.error}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </CardPanel>

        {/*
         * MyRCM has no link we may fetch, so its results arrive as the PDF the driver
         * downloads. That door used to exist only inside the log-run wizard, which meant
         * reading a MyRCM race you watched required pretending you had driven a run — the
         * exact backwards-ness this page exists to undo.
         */}
        <MyRcmPdfImportCard
          pastedUrl={null}
          openUrl={null}
          hasImported={false}
          onImported={(res) => {
            void loadSessions();
            router.push(`/laps/analysis?session=${encodeURIComponent(res.importedSessionId)}`);
          }}
        />

        {importSlot}
      </div>

      <div className="mt-4 space-y-2.5 lg:mt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Imported sessions</Eyebrow>
          {/*
           * Defaults to "I was in it". Pasting one LiveRC event page imports every race on
           * that page, so a driver who has pasted a handful of event links owns hundreds of
           * sessions they never chose one by one — the list read as somebody else's racing.
           * Everything is still there under "Everything"; it just isn't the first thing.
           */}
          {viewerNorms.size > 0 && rows.length > mineCount ? (
            <div className="flex shrink-0 items-center gap-1 text-[11px]">
              {(
                [
                  // "My runs": you were in it, or you uploaded it yourself.
                  ["mine", `My runs (${mineCount})`],
                  // "200 of 648": the list is the newest imports, not all of them.
                  [
                    "all",
                    total != null && total > rows.length
                      ? `Everything (${rows.length} of ${total})`
                      : `Everything (${rows.length})`,
                  ],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setScope(key);
                    setShown(PAGE_SIZE);
                  }}
                  className={cn(
                    "tap-active rounded-full px-2.5 py-1 font-medium transition",
                    scope === key
                      ? "bg-primary/15 text-primary-ink"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {scope === "all" && rows.length > mineCount ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Most of these came in with a LiveRC event page — pasting one brings in every race on
            it, which is what makes a rival&apos;s heat readable here.
          </p>
        ) : null}
        {listErr ? <p className="text-[11px] text-destructive">{listErr}</p> : null}
        {!listErr && sessions.length === 0 ? (
          <CardPanel contentClassName="text-[12px] text-muted-foreground">
            Nothing imported yet. Paste a link above and it lands here.
          </CardPanel>
        ) : null}

        {/*
         * A search box and a page size, because this list is not the handful it sounds like.
         * Measured on a real account: 200 rows, ~12,000px of scroll, because expanding ONE
         * LiveRC event hub stores every race on it — 30 classes you have never driven, filed
         * under names you have never heard of. The same measurement that gave the Tools band
         * its fortnight window (see UNLINKED_LAP_WINDOW_DAYS); this page can't use a window,
         * because "the race in Thailand from March" is exactly what someone comes here for.
         * So: newest first, twenty at a time, and a box to find a name in.
         */}
        {sessions.length > 0 ? (
          <div className="flex items-center gap-2">
            {sessions.length > PAGE_SIZE ? (
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE_SIZE);
                }}
                placeholder="Find a driver, track or class…"
                aria-label="Search imported sessions"
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-primary-ink/50"
              />
            ) : (
              <span className="flex-1" />
            )}
            <button
              type="button"
              onClick={() => (selecting ? exitSelect() : setSelecting(true))}
              className="tap-active shrink-0 rounded-md border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-foreground transition hover:bg-muted"
            >
              {selecting ? "Cancel" : "Select"}
            </button>
          </div>
        ) : null}

        {sessions.length > 0 ? (
          <CardPanel contentClassName="p-0">
            {visibleGroups.map((group) => (
              <section key={group.key} aria-label={group.label || undefined}>
                {group.label ? (
                  <h3 className="px-4 pb-0.5 pt-2.5 text-[11.5px] font-semibold leading-4 text-foreground/75">
                    {group.label}
                  </h3>
                ) : null}
                <ul>
                  {group.items.map((row) => {
                    const text = (
                      <span className="min-w-0 flex-1">
                        <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                          {row.title}
                        </span>
                        {row.detail ? (
                          <span className="ui-caption mt-0.5 block truncate">{row.detail}</span>
                        ) : null}
                      </span>
                    );
                    return (
                      <li key={row.id} className="border-b border-border/60 last:border-b-0">
                        {!selecting ? (
                          <Link
                            href={`/laps/analysis?session=${encodeURIComponent(row.id)}`}
                            className="tap-active flex items-center gap-3 px-4 py-2.5 transition hover:bg-muted/40"
                          >
                            {text}
                            {row.time ? <span className="type-timestamp shrink-0">{row.time}</span> : null}
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          </Link>
                        ) : row.onRun ? (
                          <div className="flex items-center gap-3 px-4 py-2.5">
                            <span className="size-[18px] shrink-0" aria-hidden />
                            {text}
                            <span className="type-timestamp shrink-0">On a run</span>
                          </div>
                        ) : (
                          <label className="tap-active flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-muted/40">
                            <input
                              type="checkbox"
                              className="size-[18px] shrink-0 accent-primary"
                              checked={ticked.has(row.id)}
                              onChange={() => toggleTick(row.id)}
                            />
                            {text}
                            {row.time ? <span className="type-timestamp shrink-0">{row.time}</span> : null}
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {visible.length < filtered.length ? (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="tap-active flex w-full items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-left transition hover:bg-muted/40"
              >
                <span className="type-timestamp">
                  {filtered.length - visible.length} more
                  {query.trim() ? " matching" : ""}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ) : null}
          </CardPanel>
        ) : null}
        {sessions.length > 0 && filtered.length === 0 ? (
          <CardPanel contentClassName="text-[12px] text-muted-foreground">
            Nothing here matches “{query.trim()}”.
          </CardPanel>
        ) : null}
        {selecting ? <div className="h-20" aria-hidden /> : null}
      </div>

      {selecting && barMounted ? createPortal(
        /* Clears the bottom dock the way the run form's save bar does; floats on desktop. */
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-40 px-4 md:bottom-8">
          <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-2 shadow-[0_12px_30px_-10px_rgba(60,52,32,0.5)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setTicked(allTicked ? new Set() : new Set(tickable.map((r) => r.id)))}
              disabled={tickable.length === 0}
              className="tap-active rounded-lg px-3 py-2 text-[13px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {allTicked ? "Select none" : "Select all"}
            </button>
            {selectErr ? (
              <span className="min-w-0 flex-1 truncate text-[11px] text-destructive" role="alert">
                {selectErr}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void deleteTicked()}
              disabled={tickedIds.length === 0 || deleting}
              aria-busy={deleting}
              className="tap-active h-10 shrink-0 rounded-full bg-destructive px-5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:bg-muted disabled:text-muted-foreground"
            >
              {deleting ? "Deleting…" : tickedIds.length > 0 ? `Delete ${tickedIds.length}` : "Delete"}
            </button>
          </div>
        </div>,
        document.body
      ) : null}

      <ActionToast
        message={undoIds ? deletedSessionsMessage(undoIds.length) : null}
        action={undoIds ? { label: "Undo", onClick: () => void undoDelete(undoIds) } : null}
        onDismiss={() => setUndoIds(null)}
      />
      {/* A session deleted on its own page lands the driver back here, with its Undo. */}
      <SessionDeletedUndo onChanged={loadSessions} />
    </div>
  );
}
