"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { MyRcmPdfImportCard } from "@/components/runs/MyRcmPdfImportCard";
import { ActionToast } from "@/components/ui/ActionToast";
import { SessionDeletedUndo } from "@/components/laps/SessionDeletedUndo";
import { deletedSessionsMessage, setImportedSessionsHidden } from "@/components/laps/sessionDeletion";
import { groupNamedSessions, type SessionName } from "@/lib/lapImport/sessionNaming";

/** One row of `/api/lap-time-sessions/library` — named on the server, newest race first. */
type SessionRow = {
  id: string;
  sourceUrl: string;
  /** Its laps are one of your runs': Select mode leaves it alone. */
  onRun: boolean;
  /** On one of your runs, or you're on the sheet — your name, your chip. */
  mine: boolean;
  name: SessionName;
};

/**
 * Yours, or everyone else's (founder call, 2026-09-24). Pasting one LiveRC event page imports
 * every race on it — thirty classes, most of them strangers' — so a driver who has pasted a few
 * owns hundreds of sessions they never chose one by one. The two never share a list.
 */
type Scope = "mine" | "others";

const SCOPE_LABEL: Record<Scope, string> = { mine: "My runs", others: "Other drivers" };

/** Rows drawn before the "show more" line. Twenty is about a phone screen of scrolling. */
const PAGE_SIZE = 20;

/**
 * The page's one Import button, on the link box and on the MyRCM row alike (founder call,
 * 2026-09-24: the two should look identical). As tall as the link box beside it.
 */
const IMPORT_BUTTON =
  "tap-active shrink-0 rounded-md border border-transparent primary-face bg-primary px-3.5 py-2 text-[13px] font-semibold leading-5 text-primary-foreground transition hover:brightness-105 disabled:opacity-50";

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
  importSlot = null,
}: {
  eventId?: string | null;
  /**
   * Rendered in the import column, under the two upload doors. It is another way to bring a
   * session in, so it belongs beside them — below the sessions list a driver with a hundred
   * rows never scrolls to it (founder call, 2026-09-16).
   */
  importSlot?: ReactNode;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("mine");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<ImportResultRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  /** How many imports the account holds — only more than the list when it hit its ceiling. */
  const [total, setTotal] = useState<number | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  /*
   * Named on the server (founder call, 2026-09-23: whose, which run, where, when). The day, track
   * and time live on the group heading and the row's right edge; the second line is a race's class
   * and field size.
   */
  const rows = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        name: s.name,
        title: s.name.title,
        time: s.name.timeLabel,
        detail: s.name.detail,
        onRun: s.onRun,
        mine: s.mine,
        // The URL is in the haystack on purpose: a LiveRC race URL carries the club and
        // the class, which is often the only place the class name appears at all.
        haystack: [s.name.title, s.name.autoTitle, s.name.groupLabel, s.name.detail, s.sourceUrl]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [sessions]
  );

  // A search reaches both lists: each count is what it holds for the search, so a rival's name
  // typed under My runs shows where their sessions are.
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const terms = q.split(/\s+/);
    return rows.filter((r) => terms.every((t) => r.haystack.includes(t)));
  }, [rows, query]);
  const mineCount = useMemo(() => matching.filter((r) => r.mine).length, [matching]);
  const othersCount = matching.length - mineCount;

  // One list with nothing in it isn't a choice: the switch shows only when both hold sessions.
  const holdsMine = useMemo(() => rows.some((r) => r.mine), [rows]);
  const holdsOthers = useMemo(() => rows.some((r) => !r.mine), [rows]);
  const showScope = holdsMine && holdsOthers;
  const activeScope: Scope = !holdsMine ? "others" : !holdsOthers ? "mine" : scope;

  const filtered = useMemo(
    () => matching.filter((r) => (activeScope === "mine" ? r.mine : !r.mine)),
    [matching, activeScope]
  );

  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  /** Under "Tue 22 Sept · Chargers RC" headings, newest race first, each day newest first. */
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
      const res = await fetch("/api/lap-time-sessions/library", { cache: "no-store" });
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
          {/* One row, Import beside the box. It grows as you paste — a 3-row box that is empty
              95% of the time was most of what made this card fill a screen. */}
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={1}
              placeholder="LiveRC or Speedhive link"
              className="min-w-0 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-foreground outline-none tabular-nums"
              disabled={busy}
              aria-label="Timing links, one per line"
            />
            <button type="button" disabled={busy} onClick={() => void onImport()} className={IMPORT_BUTTON}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
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
          closedImportClassName={IMPORT_BUTTON}
          onImported={(res) => {
            void loadSessions();
            router.push(`/laps/analysis?session=${encodeURIComponent(res.importedSessionId)}`);
          }}
        />

        {importSlot}
      </div>

      <div className="mt-4 lg:mt-0">
        {/*
         * One card, headed like the upload card beside it — the same band at the same height
         * (founder call, 2026-09-24) — with the switch, the search and the list all under it.
         */}
        <CardPanel contentClassName="space-y-2.5">
          <Eyebrow>Imported sessions</Eyebrow>
          {/*
           * The first thing on the list, full width and in the app's own switch — it was two 11px
           * words in a corner, and the founder couldn't tell which list he was reading (2026-09-24).
           */}
          {showScope ? (
            <SegmentedControl<Scope>
              ariaLabel="Whose sessions"
              value={activeScope}
              onChange={(next) => {
                setScope(next);
                setShown(PAGE_SIZE);
              }}
              // One line at phone width: "Other drivers" and its count broke onto two at 15px.
              segmentClassName="whitespace-nowrap px-1.5 py-2.5 text-[14px]"
              options={(["mine", "others"] as const).map((key) => {
                const count = key === "mine" ? mineCount : othersCount;
                return {
                  value: key,
                  ariaLabel: `${SCOPE_LABEL[key]}, ${count}`,
                  label: (
                    <>
                      <span>{SCOPE_LABEL[key]}</span>
                      <span className="text-[12px] font-normal tabular-nums opacity-60">{count}</span>
                    </>
                  ),
                };
              })}
            />
          ) : null}
          {listErr ? <p className="text-[11px] text-destructive">{listErr}</p> : null}
          {!listErr && sessions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing imported yet. Paste a link above and it lands here.
            </p>
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
          {sessions.length > 0 && filtered.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing in {SCOPE_LABEL[activeScope]} matches “{query.trim()}”.
            </p>
          ) : null}

          {visible.length > 0 ? (
            // The rows run edge to edge, down to the card's foot.
            <div className="-mx-3 -mb-3 border-t border-border/60">
              {visibleGroups.map((group) => (
                <section key={group.key} aria-label={group.label || undefined}>
                  {group.label ? (
                    <h3 className="px-3 pb-0.5 pt-2.5 text-[11.5px] font-semibold leading-4 text-foreground/75">
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
                              className="tap-active flex items-center gap-3 px-3 py-2.5 transition hover:bg-muted/40"
                            >
                              {text}
                              {row.time ? <span className="type-timestamp shrink-0">{row.time}</span> : null}
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            </Link>
                          ) : row.onRun ? (
                            <div className="flex items-center gap-3 px-3 py-2.5">
                              <span className="size-[18px] shrink-0" aria-hidden />
                              {text}
                              <span className="type-timestamp shrink-0">On a run</span>
                            </div>
                          ) : (
                            <label className="tap-active flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-muted/40">
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
                  className="tap-active flex w-full items-center justify-between gap-3 border-t border-border/60 px-3 py-2.5 text-left transition hover:bg-muted/40"
                >
                  <span className="type-timestamp">
                    {filtered.length - visible.length} more
                    {query.trim() ? " matching" : ""}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
        </CardPanel>
        {/* Only an account past the list's ceiling: say it's cut rather than look complete. */}
        {total != null && total > sessions.length ? (
          <p className="type-timestamp mt-2 px-1">
            Newest {sessions.length} of {total} imports
          </p>
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
