"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { haptic } from "@/lib/haptics";
import { surfaceValuesToStoredMerge } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * The setup part of "Log your run", for a car whose chassis came from somebody's own PDF.
 *
 * ============================== WHY THE ORDINARY FORM CANNOT DO THIS ==============================
 *
 * The log-run form shows the fields flagged `showInLogRun`, and every box nobody has named yet has
 * that flag off — deliberately, because a form of two hundred rows called "Box 47" would be worse
 * than useless. On a chassis derived from a PDF that is most of the sheet, so the section rendered
 * empty: the driver had a car they could log runs on and no way to say what the car was on.
 *
 * ============================== WHY IT OPENS BY ITSELF ==============================
 *
 * It used to sit behind an "Open the sheet" button, on the reasoning that the page image costs a
 * download and most runs are logged from a setup chosen further up the form. But the card that
 * asked said nothing the driver did not already know — it repeated the car they had just picked and
 * explained that its setup lives on a sheet — in front of the only control on this section that
 * does anything. A door with nothing behind it but the thing you came for is not a choice, it is a
 * step (founder, 2026-08-12).
 *
 * So it opens on arrival. The cost is real and accepted: the sheet page image now loads whenever
 * this section renders, for every run on a sheet-drawn chassis.
 *
 * It can still be collapsed, and that state is remembered per setup — but collapsing is now
 * something the driver asks for, not something they have to undo first.
 *
 * ============================== ON RE-SEEDING ==============================
 *
 * The surface reads `initialValues` once, at mount. Choosing a different setup source above
 * replaces the run's whole setup, so `seedKey` changes — and because the surface is keyed on it,
 * React remounts it and it seeds from the setup that is now current. That remount used to come for
 * free from the sheet closing; with the sheet always open the key is what does it. Without either,
 * the sheet would keep showing values from a setup the driver had already moved off, and hand them
 * back as if they were still chosen.
 */
export function RunSheetSetupFill({
  setupSheetModelId,
  chassisName,
  seedValues,
  seedKey,
  onValues,
}: {
  setupSheetModelId: string;
  chassisName: string;
  /** The run's current setup, as sheet values. Read when the sheet is opened, not while it is up. */
  seedValues: Record<string, string>;
  /** Changes when the setup itself is replaced from outside the sheet. See above. */
  seedKey: string;
  /**
   * The sheet's state in STORED shapes — grouped rows as arrays, preset rows as objects, cleared
   * boxes as `""` deletion markers — ready for `mergeSheetValuesIntoSnapshot`.
   */
  onValues: (values: Record<string, unknown>) => void;
}) {
  /**
   * Which setup the driver COLLAPSED this against, rather than which one they opened it for.
   *
   * Inverted so that open is the default and stays the default: choosing a different setup source
   * above changes `seedKey`, which no longer matches what was collapsed, and the sheet comes back
   * up for the setup that is now current. No effect needed either way.
   */
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const open = collapsedFor !== seedKey;

  const filled = Object.values(seedValues).filter((v) => v.trim() !== "").length;

  /*
   * A permanently stable `onChange`, because the surface reports through an effect that depends on
   * it. A callback rebuilt on every render would make that effect fire, update the run's setup,
   * re-render, rebuild the callback, and fire again — forever. Read through a ref instead, which
   * keeps the identity fixed for the life of the component.
   */
  const onValuesRef = useRef(onValues);
  useEffect(() => {
    onValuesRef.current = onValues;
  });
  const planRef = useRef<SheetFillPlan | null>(null);
  const handleChange = useCallback((next: Record<string, string>) => {
    // Through the bridge before it leaves this component: the run's setup snapshot must hold the
    // same shapes a form edit writes, or "what changed since your last run" would report every
    // grouped row as changed after every sheet-logged run.
    const plan = planRef.current;
    onValuesRef.current(plan ? surfaceValuesToStoredMerge(next, plan.fields) : next);
  }, []);

  /*
   * One row either way — the count on the left, the collapse control on the right. Collapsed is
   * the SAME row with a different verb, not an explanatory card: by the time a driver is here they
   * have chosen this car, and telling them its setup lives on a sheet in front of the sheet is the
   * redundancy that got the old panel removed.
   */
  const countLabel = `${filled} ${filled === 1 ? "box" : "boxes"} filled on ${chassisName}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{countLabel}</span>
        {open ? (
          <button
            type="button"
            onClick={() => setCollapsedFor(seedKey)}
            className="btn-surface px-2 py-1 text-[11px]"
          >
            Collapse the sheet
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setCollapsedFor(null);
            }}
            className={buttonLinkClassName("outline")}
          >
            Open the sheet
          </button>
        )}
      </div>
      {open ? (
        <SheetFillSurface
          /*
           * Keyed on the setup, so replacing the setup source above remounts the surface and it
           * re-reads `initialValues`. See "ON RE-SEEDING" — the close/open cycle used to do this.
           */
          key={seedKey}
          planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
          pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
          initialValues={seedValues}
          onChange={handleChange}
          onPlanLoaded={(p) => {
            planRef.current = p;
          }}
        />
      ) : null}
    </div>
  );
}
