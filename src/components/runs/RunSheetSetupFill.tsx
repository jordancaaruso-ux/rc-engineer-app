"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { haptic } from "@/lib/haptics";

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
 * ============================== WHY IT IS BEHIND A BUTTON ==============================
 *
 * Opening the sheet costs a picture of a page, and the run form is long. Most runs are logged from
 * a setup the driver already chose above — a past run, a saved setup — and they never need to look
 * at the paper at all. So the sheet loads when it is asked for, not when the section opens.
 *
 * ============================== ON RE-SEEDING ==============================
 *
 * The surface reads `initialValues` once, at mount. Choosing a different setup source above
 * replaces the run's whole setup, so `seedKey` changes and this closes — and the next open seeds
 * from the setup that is now current. Without that, the sheet would keep showing values from a
 * setup the driver had already moved off, and hand them back as if they were still chosen.
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
  onValues: (values: Record<string, string>) => void;
}) {
  /** Which setup this sheet was opened against — so a new one closes it, with no effect needed. */
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = openedFor !== null && openedFor === seedKey;

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
  const handleChange = useCallback((next: Record<string, string>) => {
    onValuesRef.current(next);
  }, []);

  if (!open) {
    return (
      <div className="max-w-2xl space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{chassisName}</p>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            This car&rsquo;s setup lives on its own sheet. Open it to record what the car is on for
            this run.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setOpenedFor(seedKey);
            }}
            className={buttonLinkClassName("outline")}
          >
            Open the sheet
          </button>
          <span className="text-[11px] text-muted-foreground">
            {filled > 0
              ? `${filled} ${filled === 1 ? "box" : "boxes"} filled`
              : "Nothing filled in yet"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {filled} {filled === 1 ? "box" : "boxes"} filled on {chassisName}
        </span>
        <button
          type="button"
          onClick={() => setOpenedFor(null)}
          className="btn-surface px-2 py-1 text-[11px]"
        >
          Close the sheet
        </button>
      </div>
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={seedValues}
        onChange={handleChange}
      />
    </div>
  );
}
