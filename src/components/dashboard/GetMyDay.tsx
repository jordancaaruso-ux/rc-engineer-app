"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Download, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import {
  InlineNewTrackRow,
  type InlineCreatedTrack,
  type InlineNewTrackRowHandle,
} from "@/components/runs/InlineNewTrackRow";
import {
  SHEET_CARD_CLASS,
  SHEET_PILL_OUTLINE,
  SHEET_PILL_PRIMARY,
  SHEET_SCRIM_CLASS,
} from "@/components/ui/ExitPromptSheet";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { DayRangeCalendar, fmtYmd } from "@/components/ui/DayRangeCalendar";
import {
  daysInRange,
  earliestReachableYmd,
  recentDayChoices,
  type DayChoice,
} from "@/lib/sweep/getMyDayDays";

type TrackOption = { id: string; name: string; location?: string | null };
/** Fewer letters than this and the box still shows the driver's own tracks. */
const SEARCH_MIN_CHARS = 2;
type CarOption = { id: string; name: string };
type TimingSource = "speedhive" | "liverc";
/** A chip seen in a different car than it is paired with (`chipMovedQuestion.ts`). */
type ChipMoved = { chip: string; carId: string; carName: string; fromCarId: string; fromCarName: string };
/** One time on track the timing sheet holds that the driver did not log (`PendingOutingView`). */
type PendingRow = {
  id: string;
  kind: "race" | "practice";
  startIso: string;
  when: string;
  lapCount: number | null;
  bestLapSeconds: number | null;
  carId: string | null;
  carName: string | null;
};
type PendingResponse = {
  ok: true;
  pending: PendingRow[];
  needsCar: number;
  dayHref: string | null;
  cars: CarOption[];
};
type DayResponse = PendingResponse & {
  found: number;
  alreadyOnRuns: number;
  attached: number;
  joined: number;
  skipped: number;
  failedSources: TimingSource[];
  chipMoved?: ChipMoved | null;
};
type LogResponse = PendingResponse & { logged: number; joined: number; skipped: number };

/**
 * "Import your last runs" — a quiet row under the Start-run bar (founder call 2026-09-15; it read
 * "Get my day" until 2026-09-16, which is why the server files are still named for it). Pick a
 * track and a day — or a stretch of days on the calendar — and the app reads LiveRC and Speedhive
 * once per day. Nothing files itself (founder ruling 2026-09-18): what the sites hold that is not
 * already on a run comes back as a list, every row ticked, and only the rows still ticked when
 * the driver says so become runs — so nothing is ever in the log that they did not choose. The
 * car is asked only when the app cannot tell (never a guess). Server side: `/api/sweep/day`,
 * `src/lib/sweep/getMyDay.ts`.
 */
export function GetMyDayRow() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {/* Same card and same inner row as the empty Next-outing card ("Book your next track day",
          DashboardNextOutingCard) — the two sit one above the other and must be one shape. */}
      <SurfaceCard variant="hero" className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tap-active -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <Download aria-hidden className="size-[15px]" strokeWidth={2.2} />
          Import your last runs
          <ChevronRight aria-hidden className="ml-auto size-4 text-faint" strokeWidth={2.2} />
        </button>
      </SurfaceCard>
      {open ? <GetMyDaySheet onClose={close} /> : null}
    </>
  );
}

/**
 * The 8 pm notification's landing (and the dashboard's "N runs you didn't log" row): the sessions
 * are already imported, so the sheet opens straight on the list over whatever page carries the
 * `?unlogged=<trackId>&ymd=<ymd>` flag — the day itself when the driver has runs there, the
 * dashboard when not. Ticking makes the runs and lands on the day, which is what `GetMyDaySheet`
 * already does.
 */
export function UnloggedRunsSheet({ trackId, ymd }: { trackId: string; ymd: string }) {
  const [open, setOpen] = useState(true);
  // The sheet is a portal into document.body, and this one is rendered by the page rather than by
  // a tap — so it must wait for the client or the server render throws "document is not defined".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dayQuestion = useMemo(() => ({ trackId, ymd }), [trackId, ymd]);
  const close = useCallback(() => {
    setOpen(false);
    // Drop the flag so a refresh, or the trip back from the day, does not open it again.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("unlogged");
      url.searchParams.delete("ymd");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  if (!open || !mounted) return null;
  return <GetMyDaySheet onClose={close} dayQuestion={dayQuestion} />;
}

/** "today", "yesterday", or "on Sat 12 Sep" — how a day reads inside a sentence. */
function dayWord(ymd: string, pills: readonly DayChoice[]): string {
  const pill = pills.find((p) => p.ymd === ymd);
  if (pill?.label === "Today") return "today";
  if (pill?.label === "Yesterday") return "yesterday";
  return `on ${fmtYmd(ymd, { weekday: "short", day: "numeric", month: "short" })}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function sourcesWord(sources: readonly TimingSource[], joiner: "or" | "and" = "or"): string {
  return sources.map((s) => (s === "liverc" ? "LiveRC" : "Speedhive")).join(` ${joiner} `);
}

const ROW_CLASS =
  "tap-active flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-[13px] font-semibold text-foreground transition disabled:opacity-60";
const LABEL_CLASS = "px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

/** What a range of days added up to, across every day the sheet read. */
type RangeTally = {
  found: number;
  /** Laps put on runs the driver had opened, and sources joined to runs they logged. */
  filed: number;
  failedSources: TimingSource[];
  /** The newest day that ended with runs on it — where a one-day import lands. */
  dayHref: string | null;
};

/** The list step: the days read, each with the runs on the sheet the driver did not log. */
type PendingList = {
  days: Array<{ ymd: string; rows: PendingRow[] }>;
  cars: CarOption[];
  dayHref: string | null;
};

function GetMyDaySheet({
  onClose,
  dayQuestion = null,
}: {
  onClose: () => void;
  /** Opened straight on the list for a day the 8 pm pass already read. */
  dayQuestion?: { trackId: string; ymd: string } | null;
}) {
  const router = useRouter();
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const pills = useMemo(() => recentDayChoices(new Date(), zone), [zone]);
  const reach = useMemo(
    () => ({ min: earliestReachableYmd(new Date(), zone), max: pills[0]!.ymd }),
    [zone, pills],
  );
  const [tracks, setTracks] = useState<TrackOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(dayQuestion?.trackId ?? null);
  /**
   * The list only knows tracks the driver has raced at, starred or added — empty on a new account.
   * The box reaches every catalog track with a timing link (founder 2026-09-16).
   */
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; tracks: TrackOption[] } | null>(null);
  /** The name carried into the add-track form; null while the form is shut. */
  const [adding, setAdding] = useState<string | null>(null);
  const newTrackRef = useRef<InlineNewTrackRowHandle>(null);
  const searchQ = query.trim();
  const searching = searchQ.length >= SEARCH_MIN_CHARS;
  const [range, setRange] = useState<{ startYmd: string; endYmd: string }>(() => {
    const only = dayQuestion?.ymd ?? pills[0]!.ymd;
    return { startYmd: only, endYmd: only };
  });
  /** Null when idle; "day" while the days are read; "log" while the ticked runs are made. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Which day of how many — the honest progress line. */
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** The runs on the sheet the driver did not log, once read; the sheet's second face. */
  const [list, setList] = useState<PendingList | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** "Which car?" — shown only when a ticked row has none, once, before the runs are made. */
  const [askingCar, setAskingCar] = useState(false);
  const readTally = useRef<RangeTally>({ found: 0, filed: 0, failedSources: [], dayHref: null });
  /** "Has this chip moved?" — seen on a day's answer, asked once the import is done, before landing. */
  const [chipQ, setChipQ] = useState<ChipMoved | null>(null);
  const chipSeen = useRef<ChipMoved | null>(null);
  const afterChip = useRef<(() => void) | null>(null);
  // Set on EVERY mount, not only at creation: React mounts twice in development (and may again
  // around a hidden subtree), and a flag cleared by the first unmount and never set back made the
  // sheet drop the server's answer and spin on "Looking" forever. Found driving it, 2026-09-15.
  const alive = useRef(false);
  /**
   * Closing the sheet mid-range stops it: the day in flight finishes and is kept — it is a read
   * the driver asked for — and no further day is read. Pressing again later is safe, because a
   * session already on a run is skipped and a row already listed is listed again.
   */
  const stopped = useRef(false);
  useEffect(() => {
    alive.current = true;
    stopped.current = false;
    return () => {
      alive.current = false;
      stopped.current = true;
    };
  }, []);

  const days = useMemo(() => daysInRange(range.startYmd, range.endYmd), [range]);

  /** Everything ticked when the list opens — the offer is "log the day", opting out is the edit. */
  const showList = (next: PendingList) => {
    setList(next);
    setSelected(new Set(next.days.flatMap((d) => d.rows.map((r) => r.id))));
    setAskingCar(false);
  };

  useEffect(() => {
    let cancelled = false;
    // Arriving from the notification: the sessions are already imported, so read the list and
    // the cars to offer — never another timing-site crawl.
    if (dayQuestion) {
      const q = new URLSearchParams({ trackId: dayQuestion.trackId, ymd: dayQuestion.ymd });
      fetch(`/api/sweep/day?${q}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return (await r.json()) as PendingResponse;
        })
        .then((j) => {
          if (cancelled) return;
          // Nothing left to list (a second device already dealt with it) — get out of the way.
          if (j.pending.length === 0) {
            onClose();
            return;
          }
          readTally.current = { found: 0, filed: 0, failedSources: [], dayHref: j.dayHref };
          showList({ days: [{ ymd: dayQuestion.ymd, rows: j.pending }], cars: j.cars, dayHref: j.dayHref });
        })
        .catch(() => {
          if (!cancelled) onClose();
        });
      return () => {
        cancelled = true;
      };
    }
    fetch("/api/sweep/day", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { tracks: TrackOption[]; defaultTrackId: string | null };
      })
      .then((j) => {
        if (cancelled) return;
        setTracks(j.tracks);
        setTrackId(j.defaultTrackId ?? j.tracks[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dayQuestion, onClose]);

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/sweep/day?${new URLSearchParams({ q: searchQ })}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return (await r.json()) as { tracks: TrackOption[] };
        })
        .then((j) => {
          if (!cancelled) setResults({ q: searchQ, tracks: j.tracks });
        })
        .catch(() => {
          // A failed search reads as no answer yet, never as "no such track" — that would offer
          // to add a track that is probably already there.
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searching, searchQ]);

  // The form mounts shut; open it before the first paint, carrying what was typed.
  useLayoutEffect(() => {
    if (adding !== null) newTrackRef.current?.openWith(adding);
  }, [adding]);

  /** A track picked from the search joins the list at the top, so it stays on screen. */
  const pickTrack = (t: TrackOption) => {
    setTracks((prev) => [t, ...(prev ?? []).filter((x) => x.id !== t.id)]);
    setTrackId(t.id);
    setQuery("");
    setStatus(null);
  };

  const trackCreated = (t: InlineCreatedTrack) => {
    setAdding(null);
    if (t.liveRcUrl?.trim() || t.speedhiveUrl?.trim()) {
      pickTrack({ id: t.id, name: t.name, location: t.location });
      return;
    }
    setQuery("");
    setStatus(`${t.name} has no LiveRC or Speedhive link`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const land = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  /** One day, one look. The route reads the timing sites and answers with what is not logged. */
  const readDay = async (ymd: string): Promise<DayResponse | { error: string }> => {
    const r = await fetch("/api/sweep/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, ymd }),
    });
    const j = (await r.json().catch(() => null)) as DayResponse | { error?: string } | null;
    if (!r.ok || !j || !("ok" in j)) {
      return { error: (j && "error" in j && j.error) || "Couldn't get your day" };
    }
    if (j.chipMoved) chipSeen.current = j.chipMoved;
    return j;
  };

  /** The sheet answered for one day: ticked rows become runs, unticked rows are put away. */
  const logDay = async (
    ymd: string,
    keep: string[],
    decline: string[],
    carId: string | null,
  ): Promise<LogResponse | { error: string }> => {
    const r = await fetch("/api/sweep/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, ymd, keep, decline, ...(carId ? { carId } : {}) }),
    });
    const j = (await r.json().catch(() => null)) as LogResponse | { error?: string } | null;
    if (!r.ok || !j || !("ok" in j)) {
      return { error: (j && "error" in j && j.error) || "Couldn't log those runs" };
    }
    return j;
  };

  /** Ask the chip question if one came back, then carry on to where the import was headed. */
  const thenAskChip = (next: () => void) => {
    const q = chipSeen.current;
    chipSeen.current = null;
    if (!q) {
      next();
      return;
    }
    afterChip.current = next;
    setChipQ(q);
  };

  const answerChip = async (moved: boolean) => {
    if (!chipQ || busy !== null) return;
    setBusy(moved ? "chip-moved" : "chip-kept");
    try {
      await fetch("/api/sweep/chip-moved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chip: chipQ.chip, carId: chipQ.carId, moved }),
      });
    } catch {
      // Unanswered stays pending and is asked again next import — never blocks the landing.
    }
    if (!alive.current) return;
    setBusy(null);
    skipChip();
  };

  const skipChip = () => {
    const next = afterChip.current;
    afterChip.current = null;
    setChipQ(null);
    if (next) next();
    else onClose();
  };

  /**
   * The range, newest day first. One request per day rather than one for the whole stretch: a
   * fortnight cannot be read inside a single request's two minutes, and a day at a time is what
   * lets the button say where it is up to — and lets the driver walk away with what it has.
   */
  const importDays = async () => {
    if (!trackId || busy !== null) return;
    setBusy("day");
    setStatus(null);
    setProgress({ index: 0, total: days.length });
    const tally: RangeTally = { found: 0, filed: 0, failedSources: [], dayHref: null };
    const pendingDays: PendingList["days"] = [];
    let cars: CarOption[] = [];
    let failure: string | null = null;

    for (let i = 0; i < days.length; i += 1) {
      if (stopped.current) break;
      const ymd = days[i]!;
      setProgress({ index: i, total: days.length });
      let day: DayResponse | { error: string };
      try {
        day = await readDay(ymd);
      } catch {
        failure = "Couldn't reach the timing sites";
        break;
      }
      if (!("ok" in day)) {
        failure = day.error;
        break;
      }
      tally.found += day.found;
      tally.filed += day.attached + day.joined;
      if (day.pending.length > 0) {
        pendingDays.push({ ymd, rows: day.pending });
        if (day.cars.length > cars.length) cars = day.cars;
      }
      for (const s of day.failedSources) {
        if (!tally.failedSources.includes(s)) tally.failedSources.push(s);
      }
      if (!tally.dayHref && day.dayHref) tally.dayHref = day.dayHref;
    }

    if (!alive.current) return;
    setProgress(null);
    setBusy(null);
    readTally.current = tally;

    if (failure) {
      setStatus(failure);
      return;
    }
    // Runs on the sheet the driver did not log: the list, every row ticked. A site read short
    // is still said under it (founder 2026-09-17: every run in the dates) — the list may be short.
    if (pendingDays.length > 0) {
      showList({ days: pendingDays, cars, dayHref: tally.dayHref });
      if (tally.failedSources.length > 0) {
        setStatus(`Couldn't read all of ${sourcesWord(tally.failedSources, "and")}`);
      }
      return;
    }
    if (tally.failedSources.length > 0) {
      setStatus(
        tally.filed > 0
          ? `${plural(tally.filed, "run")} filled in · couldn't read all of ${sourcesWord(tally.failedSources, "and")}`
          : `Couldn't reach ${sourcesWord(tally.failedSources)}`,
      );
      return;
    }
    if (tally.filed > 0 || tally.found > 0) {
      // Everything the sites hold for those days is on a run (theirs, or one just filled in):
      // there is nothing to choose, and the runs are where the driver would be sent anyway.
      thenAskChip(() => land(landingHref(tally.dayHref)));
      return;
    }
    const trackName = tracks?.find((t) => t.id === trackId)?.name ?? "that track";
    setStatus(
      days.length > 1
        ? `Nothing at ${trackName} in those ${days.length} days`
        : `Nothing at ${trackName} ${dayWord(days[0] ?? range.startYmd, pills)}`,
    );
  };

  /**
   * One day lands on the day itself, where the Debrief lives. A stretch lands on Sessions,
   * narrowed to that track and those dates — the runs that just came in, newest first.
   */
  const landingHref = (href: string | null): string => {
    if (days.length <= 1 && href) return href;
    const q = new URLSearchParams({
      trackId: trackId ?? "",
      dateFrom: range.startYmd,
      dateTo: range.endYmd,
    });
    return `/runs/history?${q}`;
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The primary button on the list: log what is ticked — after "Which car?" when a row needs one. */
  const submitList = () => {
    if (!list) return;
    const ticked = list.days.flatMap((d) => d.rows).filter((r) => selected.has(r.id));
    if (ticked.some((r) => !r.carId) && list.cars.length > 0) {
      setAskingCar(true);
      return;
    }
    void logChosen(null);
  };

  /** Every day on the list, one call each: ticked rows become runs, the rest are put away. */
  const logChosen = async (carId: string | null) => {
    if (!list || !trackId || busy !== null) return;
    setBusy(carId ?? "log");
    setStatus(null);
    let landed: string | null = list.dayHref;
    let logged = 0;
    try {
      for (const day of list.days) {
        if (stopped.current) break;
        const keep = day.rows.filter((r) => selected.has(r.id)).map((r) => r.id);
        const decline = day.rows.filter((r) => !selected.has(r.id)).map((r) => r.id);
        const res = await logDay(day.ymd, keep, decline, carId);
        if (!("ok" in res)) {
          if (alive.current) setStatus(res.error);
          return;
        }
        logged += res.logged + res.joined;
        if (res.dayHref) landed = landed ?? res.dayHref;
      }
    } catch {
      if (alive.current) setStatus("Couldn't log those runs");
      return;
    } finally {
      if (alive.current) setBusy(null);
    }
    if (!alive.current) return;
    if (dayQuestion) {
      // From the notification: one day, and the day is where the driver was headed.
      thenAskChip(() => (landed ? land(landed) : onClose()));
      return;
    }
    if (logged > 0 || readTally.current.filed > 0) {
      thenAskChip(() => land(landingHref(landed)));
      return;
    }
    thenAskChip(onClose);
  };

  /** "Not now" on the list: nothing is made, nothing is put away; the rows wait. */
  const leaveList = () => {
    if (dayQuestion) {
      onClose();
      return;
    }
    const t = readTally.current;
    if (t.filed > 0 && (t.dayHref || days.length > 1)) {
      thenAskChip(() => land(landingHref(t.dayHref)));
      return;
    }
    onClose();
  };

  const idle = busy === null;
  const listRows = list?.days.flatMap((d) => d.rows) ?? [];
  const listTotal = listRows.length;
  const tickedCount = listRows.filter((r) => selected.has(r.id)).length;
  const tickedNeedingCar = listRows.filter((r) => selected.has(r.id) && !r.carId).length;
  const listTitle = listTotal === 1 ? "1 run you didn't log" : `${listTotal} runs you didn't log`;
  const title = chipQ
    ? `Transponder ${chipQ.chip}`
    : askingCar
      ? "Which car?"
      : list
        ? listTitle
        : "Import your last runs";
  const pickedPill = range.startYmd === range.endYmd ? range.startYmd : null;
  const logLabel =
    tickedCount === 0
      ? listTotal === 1
        ? "Skip it"
        : "Skip them"
      : tickedCount === listTotal
        ? listTotal === 1
          ? "Log it as a run"
          : `Log them as ${listTotal} runs`
        : `Log ${tickedCount} of ${listTotal} as ${tickedCount === 1 ? "a run" : "runs"}`;

  return createPortal(
    <>
      <div className={SHEET_SCRIM_CLASS} onClick={onClose} aria-hidden />
      <div
        className={cn(SHEET_CARD_CLASS, "max-h-[92vh] overflow-y-auto overscroll-contain")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-3 text-center font-sans text-[14px] font-bold tracking-tight text-foreground text-balance">
          {title}
        </div>

        {chipQ ? (
          <ul className="mb-3 space-y-1">
            {(
              [
                { moved: true, label: `In ${chipQ.carName} now` },
                { moved: false, label: `Still in ${chipQ.fromCarName}` },
              ] as const
            ).map((o) => (
              <li key={String(o.moved)}>
                <button
                  type="button"
                  disabled={!idle}
                  onClick={() => void answerChip(o.moved)}
                  className={cn(ROW_CLASS, "border-border bg-surface-runna hover:border-foreground/30")}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {busy === (o.moved ? "chip-moved" : "chip-kept") ? (
                    <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : !list && dayQuestion ? (
          <div className="mb-3 h-[44px] animate-pulse rounded-md bg-card/70" aria-hidden />
        ) : askingCar && list ? (
          <>
            {tickedNeedingCar > 0 && tickedNeedingCar !== tickedCount ? (
              <div className="pb-2 text-center text-[12px] font-semibold text-muted-foreground">
                {plural(tickedNeedingCar, "run")}
              </div>
            ) : null}
            <ul className="mb-3 max-h-[42vh] space-y-1 overflow-y-auto overscroll-contain">
              {list.cars.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={!idle}
                    onClick={() => void logChosen(c.id)}
                    className={cn(ROW_CLASS, "border-border bg-surface-runna hover:border-foreground/30")}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {busy === c.id ? (
                      <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : list ? (
          /* The day in order, so a driver can tell "runs 2 and 3" from the times alone. Scrolls
             inside itself: a nine-heat club day must not push the buttons off the phone. */
          <ul className="mb-3 max-h-[46vh] space-y-1 overflow-y-auto overscroll-contain">
            {list.days.map((day) => (
              <li key={day.ymd} className="space-y-1">
                {list.days.length > 1 ? (
                  <div className={cn(LABEL_CLASS, "pt-1")}>
                    {fmtYmd(day.ymd, { weekday: "short", day: "numeric", month: "short" })}
                  </div>
                ) : null}
                <ul className="space-y-1">
                  {day.rows.map((r) => {
                    const on = selected.has(r.id);
                    const line = [
                      r.when,
                      r.kind === "race" ? "Race" : null,
                      r.lapCount != null ? `${r.lapCount} lap${r.lapCount === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={r.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer select-none items-center gap-2.5 rounded-md border border-border bg-surface-runna px-2.5 py-2 transition",
                            !on && "opacity-60",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="shrink-0 accent-primary"
                            checked={on}
                            disabled={!idle}
                            onChange={() => toggle(r.id)}
                            aria-label={line}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                            {line}
                            {r.carName ? (
                              <span className="font-medium text-muted-foreground"> · {r.carName}</span>
                            ) : null}
                          </span>
                          {r.bestLapSeconds != null ? (
                            <span className="flex shrink-0 items-baseline gap-1 leading-tight">
                              <span className="text-[9px] font-medium uppercase tracking-wide text-faint">Best</span>
                              <span className="fig-stat text-[12px] font-medium text-foreground">
                                {formatLap(r.bestLapSeconds)}
                              </span>
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className={LABEL_CLASS}>Track</div>
            {adding !== null ? (
              <InlineNewTrackRow
                ref={newTrackRef}
                onCreated={trackCreated}
                onCancel={() => setAdding(null)}
                className="mb-3"
              />
            ) : (
              <>
                <div className="search-row-composite mb-1.5 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 transition-colors focus-within:border-ring/45">
                  <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Escape clears the box first; only an empty box lets it close the sheet.
                      if (e.key === "Escape" && query) {
                        e.preventDefault();
                        e.stopPropagation();
                        setQuery("");
                      }
                    }}
                    disabled={!idle}
                    type="text"
                    inputMode="search"
                    enterKeyHint="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Search tracks"
                    aria-label="Search tracks"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                      className="tap-active -my-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                    >
                      <X className="size-4" strokeWidth={2} aria-hidden />
                    </button>
                  ) : null}
                </div>
                {searching ? (
                  results?.q !== searchQ ? (
                    <div className="mb-3 h-[44px] animate-pulse rounded-md bg-card/70" aria-hidden />
                  ) : results.tracks.length === 0 ? (
                    <div className="mb-3 px-1">
                      <button
                        type="button"
                        onClick={() => setAdding(searchQ)}
                        className="tap-active rounded-lg border border-border px-3 py-2 text-[13px] font-semibold text-primary-ink transition hover:bg-white/5"
                      >
                        Add “{searchQ}”
                      </button>
                    </div>
                  ) : (
                    <ul className="mb-3 max-h-[22vh] space-y-1 overflow-y-auto overscroll-contain">
                      {results.tracks.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            disabled={!idle}
                            onClick={() => pickTrack(t)}
                            className={cn(ROW_CLASS, "border-border bg-surface-runna hover:border-foreground/30")}
                          >
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            {t.location ? (
                              <span className="max-w-[40%] shrink-0 truncate text-[12px] font-medium text-muted-foreground">
                                {t.location}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : tracks === null ? (
                  loadFailed ? (
                    <p className="px-1 pb-3 text-[12px] text-muted-foreground">Couldn&apos;t load your tracks</p>
                  ) : (
                    <div className="mb-3 h-[88px] animate-pulse rounded-md bg-card/70" aria-hidden />
                  )
                ) : tracks.length === 0 ? (
                  <div className="mb-3" aria-hidden />
                ) : (
                  <ul className="mb-3 max-h-[22vh] space-y-1 overflow-y-auto overscroll-contain">
                    {tracks.map((t) => {
                      const on = t.id === trackId;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            disabled={!idle}
                            onClick={() => {
                              setTrackId(t.id);
                              setStatus(null);
                            }}
                            className={cn(
                              ROW_CLASS,
                              on ? "border-foreground/50 bg-card" : "border-border bg-surface-runna hover:border-foreground/30",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            {on ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.4} /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            <div className={LABEL_CLASS}>Day</div>
            {/* Last night's racing stays one tap; the calendar under it reaches back a fortnight,
                one tap a day and a second tap a range. */}
            <div className="mb-1 flex flex-wrap gap-1.5">
              {pills.map((d) => {
                const on = d.ymd === pickedPill;
                return (
                  <button
                    key={d.ymd}
                    type="button"
                    aria-pressed={on}
                    disabled={!idle}
                    onClick={() => {
                      setRange({ startYmd: d.ymd, endYmd: d.ymd });
                      setStatus(null);
                    }}
                    className={cn(
                      "tap-active h-8 rounded-full border px-3 text-[12px] font-semibold transition disabled:opacity-60",
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-foreground hover:border-foreground/30",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <DayRangeCalendar
              startYmd={range.startYmd}
              endYmd={range.endYmd}
              onChange={(next) => {
                setRange(next);
                setStatus(null);
              }}
              minYmd={reach.min}
              maxYmd={reach.max}
              disabled={!idle}
              className="mb-3 px-1"
            />
          </>
        )}

        {status ? (
          <p role="status" className="pb-2.5 text-center text-[12px] font-medium text-muted-foreground">
            {status}
          </p>
        ) : null}

        <div className="grid gap-2">
          {chipQ ? (
            <button type="button" className={SHEET_PILL_OUTLINE} disabled={!idle} onClick={skipChip}>
              Not now
            </button>
          ) : askingCar ? (
            <button
              type="button"
              className={SHEET_PILL_OUTLINE}
              disabled={!idle}
              onClick={() => setAskingCar(false)}
            >
              Back
            </button>
          ) : list ? (
            <>
              <button
                type="button"
                className={cn(SHEET_PILL_PRIMARY, !idle && "pointer-events-none opacity-60")}
                disabled={!idle}
                onClick={submitList}
              >
                {busy === "log" ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    {tickedCount === 0 ? "Skipping" : "Logging"}
                  </>
                ) : (
                  logLabel
                )}
              </button>
              <button type="button" className={SHEET_PILL_OUTLINE} disabled={!idle} onClick={leaveList}>
                Not now
              </button>
            </>
          ) : dayQuestion ? null : (
            <button
              type="button"
              className={cn(SHEET_PILL_PRIMARY, (!trackId || !idle) && "pointer-events-none opacity-60")}
              disabled={!trackId || !idle}
              onClick={() => void importDays()}
            >
              {progress ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {progress.total > 1 ? `Day ${progress.index + 1} of ${progress.total}` : "Looking"}
                </>
              ) : days.length > 1 ? (
                `Import ${days.length} days`
              ) : (
                "Import runs"
              )}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
