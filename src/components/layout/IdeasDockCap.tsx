"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lightbulb } from "@phosphor-icons/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { useEnterExit } from "@/components/ui/Collapse";

type Lists = {
  try: DashboardActionItemRow[];
  do: DashboardActionItemRow[];
};

/**
 * "Ideas & reminders" as the mobile dock's left cap (founder-locked 2026-07-14):
 * a lightbulb utility button divided from the five destinations by a hairline —
 * it opens a bottom sheet, never navigates, and never shows an active state.
 * App-wide (previously a dashboard-only floating pill), so quick capture works
 * from any screen; lists load on first open via GET /api/action-items.
 */
export function IdeasDockCap() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"try" | "do">("try");
  const [lists, setLists] = useState<Lists | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Keeps the sheet mounted through its slide-down close so the exit animates.
  const sheet = useEnterExit(open, 300);

  async function loadLists() {
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
  }

  function openSheet() {
    setOpen(true);
    if (!lists && !loading) void loadLists();
  }

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

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="Ideas and reminders"
        className="tap-active flex h-full w-[52px] shrink-0 items-center justify-center border-r border-white/[0.08] text-muted-foreground transition-colors duration-150 touch-manipulation"
      >
        <Lightbulb size={22} weight="regular" aria-hidden />
      </button>

      {/* Portaled to <body>: the dock bar's backdrop-blur makes it the
          containing block for fixed descendants, which would trap the
          full-screen overlay inside the bar (same trap as the NewRunForm
          save bar). Client-only by construction — never mounted during SSR. */}
      {sheet.mounted
        ? createPortal(
        <div
          className={cn(
            // pointer-events-auto: the dock nav wrapper is pointer-events-none.
            "pointer-events-auto fixed inset-0 z-[60] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none md:hidden",
            sheet.entered ? "opacity-100" : "opacity-0"
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Ideas and reminders"
          onClick={() => setOpen(false)}
        >
          <div
            className={cn(
              "w-full max-w-md rounded-t-2xl border border-white/10 bg-card/95 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none",
              sheet.entered ? "translate-y-0" : "translate-y-full"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
            </div>
            <div className="flex items-center justify-between px-4 pb-2 pt-2.5">
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Ideas &amp; reminders
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="tap-active -mr-1 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-5" strokeWidth={2} aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 px-4">
              <TabButton active={tab === "try"} onClick={() => setTab("try")}>
                Things to try
              </TabButton>
              <TabButton active={tab === "do"} onClick={() => setTab("do")}>
                Things to do
              </TabButton>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-4 pb-4 pt-3">
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
                      addPlaceholder="Add an idea…"
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
          </div>
        </div>,
        document.body
      )
        : null}
    </>
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
