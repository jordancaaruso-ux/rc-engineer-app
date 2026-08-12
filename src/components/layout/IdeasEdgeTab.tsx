"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Lightbulb } from "@phosphor-icons/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";
import { useEnterExit } from "@/components/ui/Collapse";

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
 * How the desktop rail's lightbulb reaches this panel.
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

/**
 * "Ideas & reminders" — a small tab on the phone's bottom-left edge, just above
 * the dock, and on desktop the lightbulb in the top rail's utility cluster. Both
 * open the same right-docked panel (nav restructure 2026-08-12).
 *
 * Same three rules it has always had (founder lock 2026-07-14): a utility and
 * never a destination, never an active state, available app-wide. Only the
 * position changed. It was the mobile dock's left cap, divided from the
 * destinations by a hairline — and that cap was spending 52px of a 390px row,
 * which is a third of where the five 60px cells and their labels came from. On the
 * edge it costs nothing horizontal, and it finally has a desktop home, which as a
 * dock cap it could never have had.
 *
 * Bottom-left rather than centred on the right edge (founder, 2026-08-12): the
 * centred version floated in the middle of the reading column, over whatever you
 * were looking at. Down here it is clear of the text and beside the bar it belongs
 * with — and the right-docked panel never reaches it, so the control you pressed
 * to open stays the control you press to close, with the count still readable.
 *
 * Lists load on first open via GET /api/action-items. The badge shows what those
 * two lists total once loaded, and is simply absent before that rather than
 * showing a zero it has not verified.
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

  // Portals need a DOM; rendering the tab during SSR and again on the client is a
  // hydration mismatch, so nothing renders until we are definitely on the client.
  useEffect(() => setMounted(true), []);

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

  const openPanel = useCallback(() => {
    setOpen(true);
    if (!lists && !loading) void loadLists();
  }, [lists, loading, loadLists]);

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
      {/* Mobile trigger. Desktop's is the rail lightbulb, via `openIdeasPanel`. */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={count === null ? "Ideas and reminders" : `Ideas and reminders — ${count} open`}
        aria-expanded={open}
        /* Breakpoint is in the CSS, not a `md:hidden` here — see the note on
           `.ideas-edge-tab` in globals.css for why the utility loses. */
        className="ideas-edge-tab"
      >
        <Lightbulb size={16} weight="fill" aria-hidden />
        {count !== null && count > 0 ? <span className="ideas-edge-count">{count}</span> : null}
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
                <span className="ml-2 font-mono text-[11px] font-semibold text-muted-foreground">
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
            <TabButton active={tab === "try"} onClick={() => setTab("try")}>
              Things to try
            </TabButton>
            <TabButton active={tab === "do"} onClick={() => setTab("do")}>
              Things to do
            </TabButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadError ? (
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
            ) : !lists ? (
              <p className="px-1 py-2 text-[12px] text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className={cn(tab === "try" ? "block" : "hidden")}>
                  <ActionItemListPanel
                    list="try"
                    title="Things to try"
                    addPlaceholder="Jot an idea…"
                    initialItems={lists.try}
                    embedded
                  />
                </div>
                <div className={cn(tab === "do" ? "block" : "hidden")}>
                  <ActionItemListPanel
                    list="do"
                    title="Things to do"
                    addPlaceholder="Add a reminder…"
                    initialItems={lists.do}
                    embedded
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-active rounded-lg px-3 py-2 text-[13px] font-semibold tracking-tight transition",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
