"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Download, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
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
type DayResponse = {
  ok: true;
  found: number;
  alreadyOnRuns: number;
  added: number;
  attached: number;
  joined: number;
  skipped: number;
  needsCar: number;
  failedSources: TimingSource[];
  dayHref: string | null;
  cars: CarOption[];
};

/**
 * "Import your last runs" — a quiet row under the Start-run bar (founder call 2026-09-15; it read
 * "Get my day" until 2026-09-16, which is why the server files are still named for it). Pick a
 * track and a day — or a stretch of days on the calendar — and the app reads LiveRC and Speedhive
 * once per day, files every session as a run, and lands on what came in. No background scanning:
 * one look per tap. The car is asked only when the app cannot tell (never a guess). Server side:
 * `/api/sweep/day`, `src/lib/sweep/getMyDay.ts`.
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
 * The 8 pm notification's landing: sessions are imported and waiting on a car, so the sheet opens
 * straight on "Which car?" over whatever page carries the `?whichCar=<trackId>&ymd=<ymd>` flag —
 * the day itself when the pass filed something, the dashboard when it could not (founder,
 * 2026-09-16: the notification announces the day, the app asks the question). Answering it files
 * the runs and lands on the day, which is what `GetMyDaySheet` already does.
 */
export function WhichCarSheet({ trackId, ymd }: { trackId: string; ymd: string }) {
  const [open, setOpen] = useState(true);
  // The sheet is a portal into document.body, and this one is rendered by the page rather than by
  // a tap — so it must wait for the client or the server render throws "document is not defined".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const carQuestion = useMemo(() => ({ trackId, ymd }), [trackId, ymd]);
  const close = useCallback(() => {
    setOpen(false);
    // Drop the flag so a refresh, or the trip back from the day, does not ask again.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("whichCar");
      url.searchParams.delete("ymd");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  if (!open || !mounted) return null;
  return <GetMyDaySheet onClose={close} carQuestion={carQuestion} />;
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
  filed: number;
  /** Sessions waiting on a car across the whole stretch — what the one answer will reach. */
  needsCar: number;
  /** Days that still hold sessions with no car — asked once, then answered for each. */
  carDays: string[];
  cars: CarOption[];
  failedSources: TimingSource[];
  /** The newest day that ended with runs on it — where a one-day import lands. */
  dayHref: string | null;
};

function GetMyDaySheet({
  onClose,
  carQuestion = null,
}: {
  onClose: () => void;
  /** Opened straight on "Which car?" for a day the 8 pm pass already imported. */
  carQuestion?: { trackId: string; ymd: string } | null;
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
  const [trackId, setTrackId] = useState<string | null>(carQuestion?.trackId ?? null);
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
    const only = carQuestion?.ymd ?? pills[0]!.ymd;
    return { startYmd: only, endYmd: only };
  });
  /** Null when idle; "day" while the days are read; a car id while that car's runs are filed. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Which day of how many, and what has landed so far — the honest progress line. */
  const [progress, setProgress] = useState<{ index: number; total: number; filed: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cars, setCars] = useState<CarOption[] | null>(null);
  const [carScope, setCarScope] = useState<string | null>(null);
  const [dayHref, setDayHref] = useState<string | null>(null);
  const carDays = useRef<string[]>([]);
  // Set on EVERY mount, not only at creation: React mounts twice in development (and may again
  // around a hidden subtree), and a flag cleared by the first unmount and never set back made the
  // sheet drop the server's answer and spin on "Looking" forever. Found driving it, 2026-09-15.
  const alive = useRef(false);
  /**
   * Closing the sheet mid-range stops it: the day in flight finishes and is kept — it is a write
   * the driver asked for — and no further day is read. Pressing again later is safe, because a
   * session already on a run is skipped.
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

  useEffect(() => {
    let cancelled = false;
    // Arriving from the notification: the sessions are already imported, so read who is waiting
    // and which cars to offer — never another timing-site crawl.
    if (carQuestion) {
      const q = new URLSearchParams({ trackId: carQuestion.trackId, ymd: carQuestion.ymd });
      fetch(`/api/sweep/day?${q}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return (await r.json()) as { needsCar: number; dayHref: string | null; cars: CarOption[] };
        })
        .then((j) => {
          if (cancelled) return;
          setDayHref(j.dayHref);
          carDays.current = [carQuestion.ymd];
          // Nothing left to ask (a second device already answered) — get out of the way.
          if (j.needsCar === 0 || j.cars.length === 0) onClose();
          else setCars(j.cars);
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
  }, [carQuestion, onClose]);

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

  /** One day, one look. The route reads the timing sites and files what it finds. */
  const readDay = async (ymd: string, carId?: string): Promise<DayResponse | { error: string }> => {
    const r = await fetch("/api/sweep/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, ymd, ...(carId ? { carId } : {}) }),
    });
    const j = (await r.json().catch(() => null)) as DayResponse | { error?: string } | null;
    if (!r.ok || !j || !("ok" in j)) {
      return { error: (j && "error" in j && j.error) || "Couldn't get your day" };
    }
    return j;
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
    setProgress({ index: 0, total: days.length, filed: 0 });
    const tally: RangeTally = { found: 0, filed: 0, needsCar: 0, carDays: [], cars: [], failedSources: [], dayHref: null };
    let failure: string | null = null;

    for (let i = 0; i < days.length; i += 1) {
      if (stopped.current) break;
      const ymd = days[i]!;
      setProgress({ index: i, total: days.length, filed: tally.filed });
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
      tally.filed += day.added + day.attached + day.joined;
      if (day.needsCar > 0) {
        tally.needsCar += day.needsCar;
        tally.carDays.push(ymd);
        if (day.cars.length > tally.cars.length) tally.cars = day.cars;
      }
      for (const s of day.failedSources) {
        if (!tally.failedSources.includes(s)) tally.failedSources.push(s);
      }
      if (!tally.dayHref && day.dayHref) tally.dayHref = day.dayHref;
    }

    if (!alive.current) return;
    setProgress(null);
    setBusy(null);

    if (failure) {
      setStatus(failure);
      return;
    }
    // The app could not work out which car for some of it. Asked once, for the whole stretch
    // (founder 2026-09-16) — with the scope on the question, so a wide answer looks wide.
    if (tally.carDays.length > 0 && tally.cars.length > 0) {
      carDays.current = tally.carDays;
      setCars(tally.cars);
      setDayHref(tally.dayHref);
      setCarScope(
        tally.carDays.length > 1
          ? `${plural(tally.needsCar, "run")} across ${plural(tally.carDays.length, "day")}`
          : null,
      );
      return;
    }
    // A site read short is said, even with runs in (founder 2026-09-17: every run in the dates).
    // Landing would pass a short list off as the whole day; pressing again is safe and reads again.
    if (tally.failedSources.length > 0) {
      setStatus(
        tally.filed > 0
          ? `${plural(tally.filed, "run")} in · couldn't read all of ${sourcesWord(tally.failedSources, "and")}`
          : `Couldn't reach ${sourcesWord(tally.failedSources)}`,
      );
      return;
    }
    if (tally.filed > 0) {
      land(landingHref(tally.dayHref));
      return;
    }
    if (tally.found > 0) {
      // Everything the sites hold for those days is already on a run: there is nothing to add,
      // and the runs are where the driver would be sent anyway.
      land(landingHref(tally.dayHref));
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

  /** "Which car?" answered: every day still holding loose sessions is filed with that car. */
  const answerCar = async (carId: string) => {
    if (!trackId || busy !== null) return;
    setBusy(carId);
    setStatus(null);
    let landed: string | null = dayHref;
    try {
      for (const ymd of carDays.current) {
        if (stopped.current) break;
        const day = await readDay(ymd, carId);
        if (!("ok" in day)) {
          if (alive.current) setStatus(day.error);
          return;
        }
        if (day.dayHref) landed = landed ?? day.dayHref;
      }
    } catch {
      if (alive.current) setStatus("Couldn't reach the timing sites");
      return;
    } finally {
      if (alive.current) setBusy(null);
    }
    if (!alive.current) return;
    if (carQuestion) {
      // From the notification: one day, and the day is where the driver was headed.
      if (landed) land(landed);
      else onClose();
      return;
    }
    land(landingHref(landed));
  };

  const idle = busy === null;
  const askingCar = Boolean(cars || carQuestion);
  const pickedPill = range.startYmd === range.endYmd ? range.startYmd : null;

  return createPortal(
    <>
      <div className={SHEET_SCRIM_CLASS} onClick={onClose} aria-hidden />
      <div
        className={cn(SHEET_CARD_CLASS, "max-h-[92vh] overflow-y-auto overscroll-contain")}
        role="dialog"
        aria-modal="true"
        aria-label={askingCar ? "Which car?" : "Import your last runs"}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-3 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          {askingCar ? "Which car?" : "Import your last runs"}
        </div>

        {!cars && carQuestion ? (
          <div className="mb-3 h-[44px] animate-pulse rounded-md bg-card/70" aria-hidden />
        ) : cars ? (
          <>
            {carScope ? (
              <div className="pb-2 text-center text-[12px] font-semibold text-muted-foreground">{carScope}</div>
            ) : null}
            <ul className="mb-3 max-h-[42vh] space-y-1 overflow-y-auto overscroll-contain">
              {cars.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={!idle}
                    onClick={() => void answerCar(c.id)}
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
          {askingCar ? (
            <button
              type="button"
              className={SHEET_PILL_OUTLINE}
              disabled={!idle}
              onClick={() => (dayHref && !carQuestion ? land(dayHref) : onClose())}
            >
              Not now
            </button>
          ) : (
            <button
              type="button"
              className={cn(SHEET_PILL_PRIMARY, (!trackId || !idle) && "pointer-events-none opacity-60")}
              disabled={!trackId || !idle}
              onClick={() => void importDays()}
            >
              {progress ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {progress.total > 1
                    ? `Day ${progress.index + 1} of ${progress.total}${progress.filed > 0 ? ` · ${plural(progress.filed, "run")}` : ""}`
                    : "Looking"}
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
