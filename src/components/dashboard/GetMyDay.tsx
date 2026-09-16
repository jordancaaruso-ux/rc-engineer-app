"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SHEET_CARD_CLASS,
  SHEET_PILL_OUTLINE,
  SHEET_PILL_PRIMARY,
  SHEET_SCRIM_CLASS,
} from "@/components/ui/ExitPromptSheet";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { recentDayChoices, type DayChoice } from "@/lib/sweep/getMyDayDays";

type TrackOption = { id: string; name: string };
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
 * track and a day; the app reads LiveRC and Speedhive once, files every session as a run, and
 * opens the day in Sessions. No background scanning: one look per tap. The car is asked only when the app
 * cannot tell (never a guess). Server side: `/api/sweep/day`, `src/lib/sweep/getMyDay.ts`.
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

function dayWord(choice: DayChoice | undefined): string {
  if (!choice) return "";
  if (choice.label === "Today") return "today";
  if (choice.label === "Yesterday") return "yesterday";
  return `on ${choice.label}`;
}

function sourcesWord(sources: readonly TimingSource[]): string {
  return sources.map((s) => (s === "liverc" ? "LiveRC" : "Speedhive")).join(" or ");
}

const ROW_CLASS =
  "tap-active flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-[13px] font-semibold text-foreground transition disabled:opacity-60";
const LABEL_CLASS = "px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

function GetMyDaySheet({
  onClose,
  carQuestion = null,
}: {
  onClose: () => void;
  /** Opened straight on "Which car?" for a day the 8 pm pass already imported. */
  carQuestion?: { trackId: string; ymd: string } | null;
}) {
  const router = useRouter();
  const days = useMemo(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return recentDayChoices(new Date(), zone);
  }, []);
  const [tracks, setTracks] = useState<TrackOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(carQuestion?.trackId ?? null);
  const [ymd, setYmd] = useState<string>(carQuestion?.ymd ?? days[0]!.ymd);
  /** Null when idle; "day" while the day is read; a car id while that car's runs are filed. */
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cars, setCars] = useState<CarOption[] | null>(null);
  const [dayHref, setDayHref] = useState<string | null>(null);
  // Set on EVERY mount, not only at creation: React mounts twice in development (and may again
  // around a hidden subtree), and a flag cleared by the first unmount and never set back made the
  // sheet drop the server's answer and spin on "Looking" forever. Found driving it, 2026-09-15.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const land = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const submit = async (carId?: string) => {
    if (!trackId || busy !== null) return;
    setBusy(carId ?? "day");
    setStatus(null);
    try {
      const r = await fetch("/api/sweep/day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId, ymd, ...(carId ? { carId } : {}) }),
      });
      const j = (await r.json().catch(() => null)) as DayResponse | { error?: string } | null;
      if (!alive.current) return;
      if (!r.ok || !j || !("ok" in j)) {
        setStatus((j && "error" in j && j.error) || "Couldn't get your day");
        return;
      }
      if (!carId && j.needsCar > 0 && j.cars.length > 0) {
        setCars(j.cars);
        setDayHref(j.dayHref);
        return;
      }
      if (j.dayHref) {
        land(j.dayHref);
        return;
      }
      if (j.failedSources.length > 0) {
        setStatus(`Couldn't reach ${sourcesWord(j.failedSources)}`);
        return;
      }
      if (j.found > 0) {
        setStatus("Couldn't add those runs");
        return;
      }
      const trackName = tracks?.find((t) => t.id === trackId)?.name ?? "that track";
      setStatus(`Nothing at ${trackName} ${dayWord(days.find((d) => d.ymd === ymd))}`);
    } catch {
      if (alive.current) setStatus("Couldn't reach the timing sites");
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const idle = busy === null;

  return createPortal(
    <>
      <div className={SHEET_SCRIM_CLASS} onClick={idle ? onClose : undefined} aria-hidden />
      <div
        className={SHEET_CARD_CLASS}
        role="dialog"
        aria-modal="true"
        aria-label={cars || carQuestion ? "Which car?" : "Import your last runs"}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" aria-hidden />
        <div className="pb-3 text-center font-sans text-[14px] font-bold tracking-tight text-foreground">
          {cars || carQuestion ? "Which car?" : "Import your last runs"}
        </div>

        {!cars && carQuestion ? (
          <div className="mb-3 h-[44px] animate-pulse rounded-md bg-card/70" aria-hidden />
        ) : cars ? (
          <ul className="mb-3 max-h-[42vh] space-y-1 overflow-y-auto overscroll-contain">
            {cars.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!idle}
                  onClick={() => void submit(c.id)}
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
        ) : (
          <>
            <div className={LABEL_CLASS}>Track</div>
            {tracks === null ? (
              loadFailed ? (
                <p className="px-1 pb-3 text-[12px] text-muted-foreground">Couldn&apos;t load your tracks</p>
              ) : (
                <div className="mb-3 h-[88px] animate-pulse rounded-md bg-card/70" aria-hidden />
              )
            ) : tracks.length === 0 ? (
              <p className="px-1 pb-3 text-[12px] text-muted-foreground">No tracks with a LiveRC or Speedhive link</p>
            ) : (
              <ul className="mb-3 max-h-[30vh] space-y-1 overflow-y-auto overscroll-contain">
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

            <div className={LABEL_CLASS}>Day</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {days.map((d) => {
                const on = d.ymd === ymd;
                return (
                  <button
                    key={d.ymd}
                    type="button"
                    aria-pressed={on}
                    disabled={!idle}
                    onClick={() => {
                      setYmd(d.ymd);
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
          </>
        )}

        {status ? (
          <p role="status" className="pb-2.5 text-center text-[12px] font-medium text-muted-foreground">
            {status}
          </p>
        ) : null}

        <div className="grid gap-2">
          {cars || carQuestion ? (
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
              onClick={() => void submit()}
            >
              {busy === "day" ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Looking
                </>
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
