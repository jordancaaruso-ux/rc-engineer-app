"use client";

/**
 * Computed geometry on a chassis that fills in on a picture of its own sheet.
 *
 * ============================== WHY THIS EXISTS SEPARATELY ==============================
 *
 * The geometry block was never a sheet feature — it was a `SetupSheetView` feature, rendered at the
 * top of the form. When the sheet became the setup view (founder ruling 2026-08-11) those surfaces
 * stopped rendering `SetupSheetView` at all, and the block went with the form. That took geometry
 * coverage to zero rather than reducing it: the only pack that exists is the Awesomatix A800R/RR,
 * and the A800RR is the chassis that draws its own sheet.
 *
 * ============================== WHY IT IS A STRIP, NOT A BLOCK ==============================
 *
 * The sheet is a stage, not a document: a zoom-and-pan viewport sized to the page picture. Two rules
 * follow. The readout has to be chrome ABOVE the paper, never ink ON it — the whole promise of sheet
 * mode is that this is the driver's own sheet with their own values in its boxes, and a computed
 * number drawn onto the page breaks that. And it has to be cheap in height, because everything it
 * takes comes off the sheet.
 *
 * ============================== WHY IT MOVES ==============================
 *
 * Three of the surfaces this lands on are editable — filling a new setup, editing one, filling a
 * run's. That is new since the form era, and it is the point. In the form the block sat above two
 * hundred fields and recomputed out of sight; here the box being typed into and the readout are an
 * inch apart. Type 0.5 into `under_hub_shims_front` and the front roll centre climbs ~1.1mm before
 * the value is committed. The fill surface reports per box rather than per keystroke, so the solve
 * runs at the rate the driver fills boxes and needs no debounce of its own.
 *
 * The delta is against the values as LOADED, so the arrow reads "what I have changed this session"
 * — the number a driver wants at a pit table. Read-only surfaces pass whatever baseline they hold.
 *
 * ============================== WHY AN EDITION SHEET GETS NO STRIP ==============================
 *
 * The calculator reads canonical keys (`camber_front`); a rebuilt EDITION of a sheet speaks its own
 * (`front_camber`). Every lookup misses, so every input defaults, and the missing-data doctrine
 * collapses: defaults stand in for boxes the driver LEFT EMPTY, but here the numbers are written on
 * the paper an inch below — the strip would print the kit car's geometry over a sheet that visibly
 * disagrees with it. A found-a-value gate is no gate either: one coincidentally-canonical key would
 * show one real value dressed in seventeen defaults. So an edition hides the strip outright.
 * FLIP THIS when the aliasing build maps edition keys onto canonical ones — once the calc reads the
 * sheet's real values, the strip is honest again and the gate must go with the gap it covered.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  computeRollCenterFromSnapshot,
  solveRollCenterDiagram,
} from "@/lib/rollCenter/computeFromSnapshot";
import { resolvePackForTemplateKey } from "@/lib/rollCenter/packs";
import type { LabSource } from "@/lib/rollCenter/labState";
import { RollCenterDetail, fmtMm } from "@/components/rollCenter/RollCenterDetail";

export function SheetGeometryStrip({
  value,
  baselineValue,
  templateKey,
  editionBlankId,
  labLabels,
  labOrigin,
  className,
}: {
  /** The setup in STORED shapes. Fill surfaces bridge their strings before handing them over. */
  value: Record<string, unknown>;
  /** What the deltas count from — the values as loaded, on a surface being edited. */
  baselineValue?: Record<string, unknown> | null;
  /**
   * Chassis-type key (`SetupSheetTemplate.templateKey`). Geometry belongs to the car, so the strip
   * renders only when this resolves to a pack whose hardpoints were measured on it. No key, no
   * strip, and no empty state — a chassis without a pack looks exactly as it does today.
   */
  templateKey?: string | null;
  /**
   * The EDITION blank these values are written on, when not the primary. Set, the strip does not
   * render at all — see "WHY AN EDITION SHEET GETS NO STRIP" above.
   */
  editionBlankId?: string | null;
  labLabels?: { s?: string; g?: string };
  /**
   * Which chassis this sheet belongs to and which stored row it is, when the host knows.
   *
   * `templateKey` above answers "does this car have a geometry pack" — it is a chassis *type*. This
   * answers "which sheet, which row", which is what the Lab needs to draw the paper and to know
   * whether it may write back. A host that has neither passes nothing and the Lab behaves as before.
   */
  labOrigin?: { setupSheetModelId?: string | null; source?: LabSource | null };
  className?: string;
}) {
  const pack = useMemo(() => resolvePackForTemplateKey(templateKey), [templateKey]);
  const computed = useMemo(
    () => (pack ? computeRollCenterFromSnapshot(value, pack) : null),
    [pack, value]
  );
  const baseline = useMemo(
    () => (pack && baselineValue ? computeRollCenterFromSnapshot(baselineValue, pack) : null),
    [pack, baselineValue]
  );

  /*
   * Always closed when a sheet opens (founder call 2026-08-14, reversing the remembered-per-device
   * behaviour this shipped with).
   *
   * The drawer used to write its state to localStorage and re-open on every sheet after. What a
   * driver actually opens a sheet to see is the sheet — a schematic that unfolds itself above the
   * paper pushes the boxes down the screen on a phone, every single time, for a reading they asked
   * for once. Opening it is one tap; having to close it is one tap on every sheet forever.
   */
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    setExpanded((v) => !v);
  }

  // The diagram solve only runs once the drawer is open — it is the expensive half of the engine.
  const solves = useMemo(
    () => (expanded && pack ? solveRollCenterDiagram(value, pack) : null),
    [expanded, pack, value]
  );
  const bodyId = useId();
  if (editionBlankId || !computed) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface-runna",
        className
      )}
      data-testid="sheet-geometry-strip"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className={cn(
          "tap-active flex w-full items-center gap-2 bg-surface-runna-inset px-2.5 py-1.5 text-left",
          expanded && "border-b border-border"
        )}
      >
        <span className="eyebrow-label shrink-0">RC</span>
        <span className="min-w-0 flex-1 text-[11px] font-semibold tabular-nums text-foreground">
          {fmtMm(computed.front.rcHeightMm)} / {fmtMm(computed.rear.rcHeightMm)}
          <span className="font-normal text-muted-foreground"> mm · rake </span>
          {fmtMm(computed.rakeMm)}
        </span>
        <span className="sr-only">
          {expanded ? "Hide" : "Show"} the computed geometry for this setup
        </span>
        <svg
          viewBox="0 0 12 12"
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded ? "-rotate-90" : "rotate-90"
          )}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div id={bodyId}>
          <RollCenterDetail
            computed={computed}
            solves={solves}
            value={value}
            baselineValue={baselineValue}
            baseline={baseline}
            labLabels={labLabels}
            labOrigin={labOrigin}
          />
        </div>
      )}
    </div>
  );
}
