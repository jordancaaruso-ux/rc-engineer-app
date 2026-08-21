"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Collapse } from "@/components/ui/Collapse";

/**
 * A phone dashboard list, folded down to one row.
 *
 * Founder call 2026-08-20: on a 390px off day the page WAS the two lists — Ideas and Things
 * to do together ran ~640px of a 844px screen, each with its own add box, so the dashboard
 * read as a to-do app with a run button on top. The lists are the driver's own text and they
 * belong here, but they are not what the page is for: they answer "what will I try", which is
 * a question you open on purpose, not one the page has to shout.
 *
 * So the card keeps its label and its count as a single tappable row and hands the body back
 * to the page. Nothing is hidden from anyone who wants it — one tap opens it, and the yellow
 * Ideas tab on the screen edge still reaches the same list from anywhere in the app.
 *
 * **Default state is the whole point and it is per-mode** (see docs/DASHBOARD_NORTH_STAR.md):
 * Ideas opens itself on a TRACK DAY, because during a session the list is live and the driver
 * is working through it. Off day, both start closed. No persistence — a remembered fold would
 * have to be read after hydration, which means the card jumps open a beat after the page
 * paints, on every load, for the sake of a state one tap restores.
 *
 * The header hairline lives INSIDE the fold, so a closed card is one clean row rather than a
 * label with a rule hanging off nothing.
 */
export function DashboardListFold({
  label,
  count,
  defaultOpen = false,
  dataTour,
  children,
}: {
  label: string;
  /** Shown beside the chevron when there is anything in the list. Zero prints nothing. */
  count: number;
  defaultOpen?: boolean;
  dataTour?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <CardPanel contentClassName="p-0" dataTour={dataTour}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="tap-active flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        {/* The raw `.eyebrow-label`, not the `Eyebrow` wrapper — same reasoning as `BandHeader`:
            the wrapper carries its own bottom rule and margin, which is the floating-in-the-gutter
            spacing this row replaces. */}
        <span className="eyebrow-label min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {count > 0 ? (
            <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
          ) : null}
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </span>
      </button>

      <Collapse open={open} id={bodyId}>
        <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>
      </Collapse>
    </CardPanel>
  );
}
