"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { LightbulbFilament, ListChecks, Notepad } from "@phosphor-icons/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";
import { useEnterExit } from "@/components/ui/Collapse";
import { useReducedMotion } from "@/components/ui/motion";
import {
  hasOpenedIdeasPanel,
  markIdeasPanelOpened,
  onIdeasItemAdded,
} from "@/lib/ideasTab";

const ActionItemListPanel = dynamic(
  () =>
    import("@/components/dashboard/ActionItemListPanel").then((m) => ({
      default: m.ActionItemListPanel,
    })),
  { loading: () => <p className="px-1 py-2 text-[12px] text-muted-foreground">Loading…</p> }
);

type Lists = {
  try: DashboardActionItemRow[];
  do: DashboardActionItemRow[];
};

/**
 * How the desktop rail's Ideas button reaches this panel.
 *
 * A window event rather than a context provider, for the same reason `DemoBanner`
 * talks to the tour this way: the panel is mounted once at the shell root and the
 * button lives several levels down inside `TopRail`, so a provider would have to
 * wrap the whole shell to serve one button. There is exactly one listener.
 */
const IDEAS_OPEN_EVENT = "jrc:ideas-open";

export function openIdeasPanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IDEAS_OPEN_EVENT));
}

/** The dashboard. The only route the idle nudge runs on. */
const DASHBOARD_PATH = "/";

/**
 * The idle nudge's timing (founder call 2026-08-18).
 *
 * The first one waits for the dashboard's own card entrance to finish rather than
 * firing on mount — a tab twitching underneath cards that are still sliding in reads
 * as a rendering fault, not as a hint. After that it is a flat 5s.
 *
 * These only ever run on the dashboard, and only until the driver has opened the
 * panel once — ever, across sessions. See the effect below for why that ceiling is
 * the load-bearing part.
 */
const FIRST_NUDGE_MS = 1800;
const NUDGE_EVERY_MS = 5000;

/**
 * "Ideas & reminders" — a small tab on the phone's left edge at 42% of the screen
 * height, and on desktop the Ideas button in the top rail's utility cluster. Both
 * open the same panel, which docks to the edge its trigger lives on: left on the
 * phone, right on desktop (nav restructure 2026-08-12).
 *
 * Both triggers are a NOTEPAD, and the two lists inside are a filament bulb (try)
 * and a tick list (do) — founder, 2026-08-16. It was a filled lightbulb, which at
 * 16px on the yellow chip lost every line inside the glass and left a dome over two
 * tapering bars: a hot air balloon. The notepad is deliberately a level up from its
 * own contents, so neither list icon is a shrunken copy of the control you pressed.
 * Anything that goes here has to read at 16px inside a 20px-wide sliver, so prefer
 * marks whose OUTLINE carries the meaning over ones that hide it in interior detail.
 *
 * Same three rules it has always had (founder lock 2026-07-14): a utility and
 * never a destination, never an active state, available app-wide. Only the
 * position changed. It was the mobile dock's left cap, divided from the
 * destinations by a hairline — and that cap was spending 52px of a 390px row,
 * which is a third of where the five 60px cells and their labels came from. On the
 * edge it costs nothing horizontal, and it finally has a desktop home, which as a
 * dock cap it could never have had.
 *
 * The LEFT edge rather than the right (founder, 2026-08-12), and 42% down rather
 * than in the bottom corner (founder, 2026-08-18). The right-edge version floated in
 * the middle of the reading column, over whatever you were looking at — and the fix
 * for that turned out to be the WIDTH, not the height. It is exactly one page-gutter
 * wide, so its inner edge lands on the line the cards start from and it sits beside
 * the text rather than over it, which is true at every height. That freed height to
 * answer a different question, and 42% is the answer: away from the two yellow
 * objects that book-end the dashboard, and high enough to be found on a page you
 * read downwards. Reasoning in full on `.ideas-edge-tab` in globals.css, where the
 * height is the single `--ideas-tab-y` knob. The tab rides out with the panel rather
 * than being buried under it, so the control you pressed to open stays the control
 * you press to close.
 *
 * Lists load on EVERY open via GET /api/action-items — which is why the tab shows
 * no count. A badge could only be truthful after you had already opened the panel
 * once, and making it truthful on arrival would cost that fetch on every page load
 * for every user. The panel header carries the total instead, where it is known.
 *
 * It fetched only on the first open until 2026-08-15, and the panel is unmounted on
 * close, so reopening re-seeded it from that first snapshot: adds disappeared, removed
 * items came back, and only a reload agreed with the database. The rows had been saved
 * the whole time. Two changes fixed it and both are load-bearing — the fetch here, and
 * `onItemsChange` on the panel keeping `lists` current so the reopen is right before the
 * refetch lands. Drop either and the old list flashes back for a beat.
 */
export function IdeasEdgeTab() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"try" | "do">("try");
  const [lists, setLists] = useState<Lists | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Keeps the panel mounted through its slide-out close so the exit animates.
  const panel = useEnterExit(open, 260);

  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const tabRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Starts TRUE so the tab can never nudge in the gap before storage has been read.
   * The wrong default here is a nudge at someone who already earned their way out of
   * it, which is the one thing this whole ceiling exists to prevent.
   */
  const [everOpened, setEverOpened] = useState(true);

  // Portals need a DOM; rendering the tab during SSR and again on the client is a
  // hydration mismatch, so nothing renders until we are definitely on the client.
  // localStorage is read in the same pass for the same reason — it does not exist
  // during SSR, so the nudge ceiling can only be known once we are on the client.
  useEffect(() => {
    setMounted(true);
    setEverOpened(hasOpenedIdeasPanel());
  }, []);

  /**
   * Fire the "open me" nudge once.
   *
   * Imperative rather than through state, because re-firing a CSS animation needs the
   * class gone, a reflow forced, and the class back. React would happily batch a
   * false/true pair into no DOM change at all, and every nudge after the first would
   * silently never play. Reading `offsetWidth` is what makes the browser commit the
   * removal before the re-add.
   */
  const nudge = useCallback(() => {
    if (reducedMotion) return;
    const el = tabRef.current;
    if (!el) return;
    el.classList.remove("is-nudging");
    void el.offsetWidth;
    el.classList.add("is-nudging");
  }, [reducedMotion]);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tryRes, doRes] = await Promise.all([
        fetch("/api/action-items?list=try"),
        fetch("/api/action-items?list=do"),
      ]);
      if (!tryRes.ok || !doRes.ok) throw new Error("bad status");
      const tryJson = (await tryRes.json()) as { items?: DashboardActionItemRow[] };
      const doJson = (await doRes.json()) as { items?: DashboardActionItemRow[] };
      setLists({ try: tryJson.items ?? [], do: doJson.items ?? [] });
    } catch {
      setLoadError("Couldn't load your lists.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Both lists follow every edit (`onItemsChange`), so the panel is correct on reopen without
   * touching the network. The fetch on every open is for the edits this component cannot see:
   * the dashboard's own copy of the same list, another tab, another device.
   */
  const handleTryChange = useCallback((items: DashboardActionItemRow[]) => {
    setLists((prev) => (prev ? { ...prev, try: items } : prev));
  }, []);
  const handleDoChange = useCallback((items: DashboardActionItemRow[]) => {
    setLists((prev) => (prev ? { ...prev, do: items } : prev));
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    /*
     * Opening it ONCE retires the idle nudge permanently — they have found the thing,
     * so the hint has done its job and has nothing left to say. This runs for the
     * desktop rail's button too (it routes through here), which is right: they found
     * the panel, and which trigger they used is not the point.
     */
    markIdeasPanelOpened();
    setEverOpened(true);
    /*
     * A nudge caught mid-flight would hold its own transform for up to 640ms and
     * override `.is-out`, pinning the tab at the edge while the panel slides away
     * from it.
     */
    tabRef.current?.classList.remove("is-nudging");
    if (!loading) void loadLists();
  }, [loading, loadLists]);

  /**
   * The idle nudge: dashboard only, every 5s, until they have opened the panel once.
   *
   * Every one of those conditions is load-bearing. DASHBOARD ONLY because a repeating
   * movement is only tolerable on a surface you land on and move through — on a run
   * page, which you sit and read, the same loop is the sheen problem again wearing a
   * different hat. UNTIL OPENED because a hint that keeps firing after it has been
   * understood is a nag, and this is the only stopping condition a driver cannot
   * reach by simply waiting it out. NOT WHILE OPEN because the panel is covering the
   * tab, so there is nothing left to point at.
   *
   * A chained timeout rather than setInterval, so the gap after the first (shorter)
   * nudge is a real 5s instead of the remainder of an interval already running. The
   * visibility check stops it firing into a backgrounded tab — without it, phones
   * that throttle timers flush the backlog as a burst when the driver comes back.
   */
  useEffect(() => {
    if (!mounted || reducedMotion || everOpened || open) return;
    if (pathname !== DASHBOARD_PATH) return;

    let timer = 0;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") nudge();
        schedule(NUDGE_EVERY_MS);
      }, delay);
    };
    schedule(FIRST_NUDGE_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, reducedMotion, everOpened, open, pathname, nudge]);

  /**
   * The one nudge that outlives the ceiling: something new landed in a list.
   *
   * Deliberately NOT gated on `everOpened` or on the route. This one is not a hint
   * that the tab exists, it is the answer to "where did that go?", and it is worth
   * showing to someone who uses the panel every day. It IS gated on the panel being
   * shut, because an add made from inside the open panel is already visible where it
   * happened, and the tab is slid out of position anyway.
   */
  useEffect(
    () =>
      onIdeasItemAdded(() => {
        if (open) return;
        nudge();
      }),
    [open, nudge]
  );

  useEffect(() => {
    const onOpen = () => openPanel();
    window.addEventListener(IDEAS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(IDEAS_OPEN_EVENT, onOpen);
  }, [openPanel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!mounted) return null;

  const count = lists ? lists.try.length + lists.do.length : null;

  /*
   * Portalled to <body>. The dock's `backdrop-filter` makes it a containing block
   * for fixed descendants, which would trap anything fixed rendered inside it — and
   * both the tab and the panel are fixed. Same trap the sheet had before it, and
   * the same escape.
   */
  return createPortal(
    <>
      {/* Mobile trigger. Desktop's is the rail's Ideas button, via `openIdeasPanel`. */}
      <button
        ref={tabRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label="Ideas and reminders"
        aria-expanded={open}
        /* Breakpoint is in the CSS, not a `md:hidden` here — see the note on
           `.ideas-edge-tab` in globals.css for why the utility loses. */
        className={cn("ideas-edge-tab", open && "is-out")}
      >
        <Notepad size={16} weight="regular" aria-hidden />
      </button>

      {panel.mounted ? (
        <div
          className={cn(
            // pointer-events-auto: the dock nav wrapper is pointer-events-none.
            "ideas-scrim pointer-events-auto",
            panel.entered ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      {panel.mounted ? (
        <aside
          className={cn("ideas-panel", panel.entered && "is-open")}
          role="dialog"
          aria-modal="true"
          aria-label="Ideas and reminders"
        >
          <div className="flex items-center justify-between gap-3 pb-3">
            <h2 className="text-[15px] font-bold tracking-tight text-foreground">
              Ideas &amp; reminders
              {count !== null ? (
                <span className="ml-2 tabular-nums text-[11px] font-semibold text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 pb-3">
            <TabButton active={tab === "try"} onClick={() => setTab("try")} icon={LightbulbFilament}>
              Ideas
            </TabButton>
            <TabButton active={tab === "do"} onClick={() => setTab("do")} icon={ListChecks}>
              Things to do
            </TabButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* A refresh that fails must never take the list off the screen: once we have
                lists they are shown regardless, and the failure is a line above them. Only a
                cold open with nothing to show gets the full banner. */}
            {!lists ? (
              loadError ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <p className="text-[12px] text-muted-foreground">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadLists()}
                    className="tap-active rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">Loading…</p>
              )
            ) : (
              <>
                {loadError ? (
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">
                      Couldn&apos;t refresh — showing your last known list.
                    </p>
                    <button
                      type="button"
                      onClick={() => void loadLists()}
                      className="tap-active shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                <div className={cn(tab === "try" ? "block" : "hidden")}>
                  <ActionItemListPanel
                    list="try"
                    title="Ideas"
                    addPlaceholder="Add an idea…"
                    addLabel="Add an idea"
                    initialItems={lists.try}
                    embedded
                    onItemsChange={handleTryChange}
                  />
                </div>
                <div className={cn(tab === "do" ? "block" : "hidden")}>
                  <ActionItemListPanel
                    list="do"
                    title="Things to do"
                    addPlaceholder="Add a reminder…"
                    initialItems={lists.do}
                    embedded
                    onItemsChange={handleDoChange}
                  />
                </div>
              </>
            )}
          </div>
        </aside>
      ) : null}
    </>,
    document.body
  );
}

/**
 * The icon is the second cue for which tab you are on: heavier strokes when active,
 * lighter when it isn't.
 *
 * BOLD on active, never FILL. Filling was tried first and reproduced the bug this whole
 * change exists to fix — a filled bulb at 14px has no filament and no glass, just a dome,
 * and a filled tick list is a solid square. Fill throws away interior detail, which is the
 * only thing distinguishing either mark at this size. Bold thickens the strokes and keeps it.
 */
function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "bold"; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-active flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold tracking-tight transition",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <Icon size={14} weight={active ? "bold" : "regular"} aria-hidden />
      {children}
    </button>
  );
}
