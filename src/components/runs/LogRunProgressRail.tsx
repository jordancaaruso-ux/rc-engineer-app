"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * Floating progress rail for the Log-run form (mobile).
 *
 * As the driver scrolls past each form card it "docks" into a pinned chip at the
 * top of the screen; scrolling back up un-docks it. Every section is always in
 * the rail once the first one docks — sections not yet reached show as faint
 * dashed **ghosts** (a full map you can tap to jump ahead), passed ones carry a
 * status mark:
 *   • red count badge  = required fields still missing (the "Run complete" bar)
 *   • green dot        = required done
 *   • outline count    = recommended fields still empty
 * When every required field across the form is satisfied the rail settles green
 * and a passive `🏁 ready` mark appears — the save pills stay the only action
 * (yellow is reserved for actions, never status).
 *
 * Rendered through a portal to <body> so `position: fixed` resolves to the
 * viewport regardless of the `.page-body` entrance transform (which briefly
 * establishes a containing block during hydration — see globals.css note).
 *
 * Cards are located by a marker class (`.run-section--<id>`) rather than refs so
 * this stays fully decoupled from the giant form component.
 */

export type RunProgressSection = {
  id: string;
  label: string;
  /** Required (Run-complete-bar) fields still missing in this section. */
  requiredMissing: number;
  /** Recommended-but-empty fields (softer nudge, never blocks). */
  recommendedMissing: number;
};

/** A card counts as docked once its bottom clears this line below the viewport top. */
const DOCK_LINE_PX = 96;
/** Extra breathing room above a card when we scroll back to it, clearing the rail. */
const JUMP_OFFSET_PX = 84;

function sectionEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.run-section--${id}`);
}

const SECTION_CLASS_RE = /run-section--([a-z]+)/;

export function LogRunProgressRail({ sections }: { sections: RunProgressSection[] }) {
  const [mounted, setMounted] = useState(false);
  const [passed, setPassed] = useState<Set<string>>(new Set());
  const passedRef = useRef<Set<string>>(new Set());
  const firstRunRef = useRef(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    let raf = 0;

    const compute = () => {
      raf = 0;
      const next = new Set<string>();
      let dockedNew = false;
      // Detect docked cards straight from their DOM markers so this stays
      // independent of the (frequently re-created) sections prop.
      document.querySelectorAll<HTMLElement>("[class*='run-section--']").forEach((el) => {
        const id = el.className.match(SECTION_CLASS_RE)?.[1];
        if (!id) return;
        if (el.getBoundingClientRect().bottom < DOCK_LINE_PX) {
          next.add(id);
          if (!passedRef.current.has(id)) dockedNew = true;
        }
      });
      const changed =
        next.size !== passedRef.current.size ||
        [...next].some((id) => !passedRef.current.has(id));
      if (!changed) return;
      passedRef.current = next;
      setPassed(next);
      // Light tick each time a card files itself away — but never for the sections
      // already scrolled past on first paint (resumed drafts / restored scroll).
      if (dockedNew && !firstRunRef.current) haptic("light");
      firstRunRef.current = false;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    firstRunRef.current = false;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mounted]);

  if (!mounted || passed.size === 0) return null;

  const jumpTo = (id: string) => {
    const el = sectionEl(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = el.getBoundingClientRect().top + window.scrollY - JUMP_OFFSET_PX;
    window.scrollTo({ top: Math.max(top, 0), behavior: reduce ? "auto" : "smooth" });
    el.classList.add("run-section-flash");
    window.setTimeout(() => el.classList.remove("run-section-flash"), 1300);
    haptic("light");
  };

  // Some cards are conditionally rendered (e.g. the Event card only exists on a
  // Event session). A section is shown only once it has docked or its card
  // is actually present in the DOM — never as a ghost that can never resolve.
  const visibleSections = sections.filter((s) => passed.has(s.id) || sectionEl(s.id));
  const allRequiredDone = visibleSections.every((s) => s.requiredMissing === 0);

  const chipBase =
    "pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 " +
    "text-[11px] font-semibold font-sans leading-none whitespace-nowrap tap-active touch-manipulation " +
    "transition-transform duration-150 active:scale-95 focus-visible:outline focus-visible:outline-2 " +
    "focus-visible:outline-offset-2 focus-visible:outline-primary-ink";

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-start px-4 md:hidden"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.6rem)" }}
      aria-label="Log run progress"
    >
      <div className="run-rail-scroll flex w-max max-w-full items-center gap-1.5 overflow-x-auto pr-14">
        {visibleSections.map((s) => {
          const isPassed = passed.has(s.id);
          const req = s.requiredMissing;
          const rec = s.recommendedMissing;
          const status =
            req > 0
              ? `${req} required field${req === 1 ? "" : "s"} missing`
              : rec > 0
                ? `required done, ${rec} suggested still empty`
                : "complete";
          return (
            <button
              key={`${s.id}-${isPassed ? "p" : "g"}`}
              type="button"
              onClick={() => jumpTo(s.id)}
              aria-label={`${s.label}: ${isPassed ? status : "not reached yet — jump to it"}`}
              className={cn(
                chipBase,
                isPassed
                  ? "run-rail-pop border-white/[0.12] bg-card/[0.72] text-foreground " +
                      "shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.10)] " +
                      "backdrop-blur-[18px] backdrop-saturate-[1.4]"
                  : "border-dashed border-white/[0.10] bg-card/[0.35] text-muted-foreground backdrop-blur-[10px]"
              )}
            >
              {isPassed ? (
                req > 0 ? (
                  <span
                    aria-hidden
                    className="flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-destructive px-1 tabular-nums text-[9px] font-medium text-[#2a0e09]"
                  >
                    {req}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-gain shadow-[0_0_6px_rgba(79,208,137,0.5)]"
                  />
                )
              ) : null}
              <span className="tracking-[-0.01em]">{s.label}</span>
              {isPassed && req === 0 && rec > 0 ? (
                <span
                  aria-hidden
                  className="flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full border border-faint px-1 tabular-nums text-[9px] font-medium text-muted-foreground"
                >
                  {rec}
                </span>
              ) : null}
            </button>
          );
        })}

        {allRequiredDone ? (
          <span
            className="run-rail-pop pointer-events-none flex shrink-0 items-center gap-1 rounded-full border border-gain/35 bg-gain/[0.08] px-2.5 py-1.5 tabular-nums text-[10px] font-medium leading-none text-gain"
            role="status"
          >
            <span aria-hidden>🏁</span> ready
          </span>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
