"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Collapse } from "@/components/ui/Collapse";

/**
 * A card that folds to its band on a phone and stands open on a computer.
 *
 * Below `lg` a page stacks, so its doors sit ABOVE the thing you came for and every open card
 * pushes that thing further down. Founder call 2026-09-26, on the lap time analysis page: the
 * timing-link, MyRCM and practice cards filled the whole first screen and not one imported
 * session showed. Folded, a card is only its band — the label, an optional peek under it and a
 * chevron, as tall as a thumb needs — and one tap opens it in place.
 *
 * From `lg` the same card sits beside the list and pushes nothing down, so it is drawn exactly as
 * a plain `CardPanel` headed by its band: no chevron, no peek, never folded.
 *
 * The switch is CSS, not a media-query hook: a hook only learns the width after hydration, so one
 * of the two layouts would paint and then jump on every load. For the same reason nothing is
 * remembered between visits — the band and the fold are `DashboardListFold`'s, and so is that rule.
 */
export function PhoneFoldCard({
  label,
  peek,
  defaultOpen = false,
  bodyClassName,
  children,
}: {
  label: string;
  /** Under the label on the phone's band — what is inside, at a glance. */
  peek?: ReactNode;
  /** Phone only: a computer always shows the body. */
  defaultOpen?: boolean;
  /** Spacing for the body's children, where the card's own `contentClassName` would have gone. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <CardPanel contentClassName="p-0">
      {/* The raw `.eyebrow-label`, not `Eyebrow`: its `mb-2` spaces a heading above content, and
          this band IS the row (see `DashboardListFold`). The band draws no rule while shut. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="tap-active eyebrow-band flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left lg:hidden"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="eyebrow-label">{label}</span>
          {peek}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {/* The computer's heading: the same 29px band any card opens with, standing still. */}
      <div className="eyebrow-band hidden items-center px-3 lg:flex">
        <span className="eyebrow-label">{label}</span>
      </div>

      {/* Held open from `lg` whatever the phone's fold says, so a window widened with the fold
          shut never hides the doors beside the list. The padding lives inside the collapsing box,
          or a shut fold would keep it as a strip of empty card. */}
      <Collapse open={open} id={bodyId} className="lg:visible lg:grid-rows-[1fr] lg:opacity-100">
        <div className={cn("px-3 pb-3 pt-2", bodyClassName)}>{children}</div>
      </Collapse>
    </CardPanel>
  );
}
