"use client";

import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";

/**
 * Mobile-only "Ideas & reminders" access — a subdued glass pill pinned
 * bottom-LEFT, mirroring the Log-run FAB's position but visually subordinate
 * (never yellow: the visual spec reserves yellow for the one primary action).
 * Tapping opens a bottom sheet with Try / Do tabs so quick capture + review is
 * one thumb-tap away instead of buried at the bottom of the page.
 *
 * On desktop the inline Try/Do card in DashboardHome carries this — the pill is
 * `md:hidden`.
 */
export function IdeasSheetFab({
  thingsToTry,
  thingsToDo,
}: {
  thingsToTry: DashboardActionItemRow[];
  thingsToDo: DashboardActionItemRow[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"try" | "do">("try");

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

  const openCount = thingsToTry.length + thingsToDo.length;

  return (
    <>
      {/* Bottom-left pill — offset matches LogRunFab so both float above the dock. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-40 px-4 md:hidden"
        style={{ bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.25rem)" }}
      >
        <div className="mx-auto flex max-w-md justify-start">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ideas and reminders"
            className="pointer-events-auto tap-active relative inline-flex h-12 items-center gap-1.5 rounded-full border border-white/10 bg-card/70 pl-3.5 pr-4 font-sans text-sm font-semibold text-foreground shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-xl transition-transform duration-150 active:scale-95 touch-manipulation"
          >
            <Lightbulb size={18} strokeWidth={2} aria-hidden />
            <span>Ideas</span>
            {openCount > 0 ? (
              <span className="ml-0.5 min-w-5 rounded-full bg-muted px-1.5 text-center font-mono text-[11px] leading-5 text-muted-foreground">
                {openCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Ideas and reminders"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-white/10 bg-card/95 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl"
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
              <div className={cn(tab === "try" ? "block" : "hidden")}>
                <ActionItemListPanel
                  list="try"
                  title="Things to try"
                  addPlaceholder="Add an idea…"
                  initialItems={thingsToTry}
                  embedded
                />
              </div>
              <div className={cn(tab === "do" ? "block" : "hidden")}>
                <ActionItemListPanel
                  list="do"
                  title="Things to do"
                  addPlaceholder="Add a reminder…"
                  initialItems={thingsToDo}
                  embedded
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
