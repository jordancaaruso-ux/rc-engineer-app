"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { HubRowTitle } from "@/components/ui/panel";
import { Collapse } from "@/components/ui/Collapse";

/**
 * The "Add …" affordance for the assets one-card idiom: a hairline row with a
 * dashed `+` well that expands its form in place (via `Collapse`), instead of an
 * always-open form card above the list. Sits as the first `<li>` inside a single
 * `SurfaceCard` + `divide-y` list.
 *
 * Controlled or uncontrolled: pass `open`/`onOpenChange` to drive it (e.g. to
 * auto-close after a successful create), or let it manage its own state.
 */
export function CollapsibleAddRow({
  label,
  children,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setOpenState(next);
  };

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen(!open);
        }}
        aria-expanded={open}
        className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/50 sm:px-4"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-secondary text-muted-foreground">
          <Plus className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <HubRowTitle as="span" className="block">
            {label}
          </HubRowTitle>
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
          aria-hidden
        />
      </button>
      <Collapse open={open}>
        <div className="px-3 pb-4 pt-1 sm:px-4">{children}</div>
      </Collapse>
    </li>
  );
}
