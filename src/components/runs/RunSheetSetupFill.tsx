"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { haptic } from "@/lib/haptics";
import {
  surfaceValuesToStored,
  surfaceValuesToStoredMerge,
} from "@/lib/setupSheetModels/sheetSurfaceValues";

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
  templateKey,
}: {
  setupSheetModelId: string;
  chassisName: string;
  /** Chassis-type key, for the computed-geometry strip. No key, no strip. */
  templateKey?: string | null;
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
  const planRef = useRef<SheetFillPlan | null>(null);
  /** The plan as state too, so the geometry strip redraws when it lands. Fires once. */
  const [planFields, setPlanFields] = useState<SheetFillPlan["fields"] | null>(null);
  /**
   * The boxes as they stand, kept here as well as pushed up.
   *
   * The parent owns the run's setup and merges into it; this is a local copy for the geometry strip
   * alone, so the roll centre can move as boxes are filled without the run form re-rendering into
   * the loop the stable `onChange` above exists to prevent.
   */
  const [liveValues, setLiveValues] = useState<Record<string, string>>(seedValues);
  /**
   * The setup this sheet opened ON, frozen.
   *
   * `seedValues` is derived from the run's setup, and the run's setup is what this sheet writes to
   * — so it moves every time a box is filled. Using it directly as the geometry baseline would make
   * the baseline chase the values and the delta read zero forever. Same hazard as the surface's
   * read-once `initialValues`, and the same answer: capture at open.
   */
  const [openedFrom, setOpenedFrom] = useState<Record<string, string>>(seedValues);
  const handleChange = useCallback((next: Record<string, string>) => {
    setLiveValues(next);
    // Through the bridge before it leaves this component: the run's setup snapshot must hold the
    // same shapes a form edit writes, or "what changed since your last run" would report every
    // grouped row as changed after every sheet-logged run.
    const plan = planRef.current;
    onValuesRef.current(plan ? surfaceValuesToStoredMerge(next, plan.fields) : next);
  }, []);

  /*
   * Geometry compares against the setup this run OPENED on — the previous run's, or whichever setup
   * was chosen above. `surfaceValuesToStored` rather than the merge variant on both sides: the
   * deletion markers the merge emits are for writing to a snapshot, not for reading a geometry from.
   */
  const geometryValue = useMemo(
    () => (planFields ? surfaceValuesToStored(liveValues, planFields) : null),
    [liveValues, planFields]
  );
  const geometryBaseline = useMemo(
    () => (planFields ? surfaceValuesToStored(openedFrom, planFields) : null),
    [openedFrom, planFields]
  );

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
              // The sheet opens against the setup that is current NOW, so the geometry it reads and
              // the geometry it counts from both start there — and the baseline stays there.
              setLiveValues(seedValues);
              setOpenedFrom(seedValues);
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
      {geometryValue ? (
        <SheetGeometryStrip
          value={geometryValue}
          baselineValue={geometryBaseline}
          templateKey={templateKey}
          labLabels={{ s: "This run", g: "Setup you started from" }}
        />
      ) : null}
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={seedValues}
        onChange={handleChange}
        onPlanLoaded={(p) => {
          planRef.current = p;
          setPlanFields(p.fields);
        }}
      />
    </div>
  );
}
