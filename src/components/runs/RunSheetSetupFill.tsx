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
 * back as if they were still chosen. The geometry strip's local copies re-seed on the same change
 * (the render-time reset below), or the roll centre would keep comparing against the old setup.
 */
export function RunSheetSetupFill({
  setupSheetModelId,
  chassisName,
  seedValues,
  seedKey,
  onValues,
  onSaveToRun,
  canSave,
  saving,
  saveSuccess,
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
  /**
   * Bank the run now — the same save the wizard bar performs (draft mid-log, "save edits" on a
   * completed run). Surfaced HERE because sheet edits are captured silently through `onValues`,
   * and a driver who has just filled boxes gets no sign they are kept until something says so
   * (founder report, 2026-08-15) — and because on a phone the wizard bar is hidden while the
   * sheet's always-focused input holds the keyboard, so this row is the visible save.
   */
  onSaveToRun: () => void;
  canSave: boolean;
  saving: boolean;
  saveSuccess: boolean;
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
   * The setup this sheet is seeded FROM, frozen.
   *
   * `seedValues` is derived from the run's setup, and the run's setup is what this sheet writes to
   * — so it moves every time a box is filled. Using it directly as the geometry baseline would make
   * the baseline chase the values and the delta read zero forever. Same hazard as the surface's
   * read-once `initialValues`, and the same answer: capture once, re-capture only when the setup
   * source itself changes.
   */
  const [openedFrom, setOpenedFrom] = useState<Record<string, string>>(seedValues);
  /**
   * Edits since the last successful save — what makes "Save to this run" appear. The surface
   * skips its mount echo, so the first `handleChange` really is a driver touching a box.
   */
  const [dirtySinceSave, setDirtySinceSave] = useState(false);
  /*
   * Re-seed the geometry copies when the setup source changes — during render, not in an effect,
   * so the strip never paints one frame of the old setup's numbers against the new key. (React's
   * documented "adjusting state when a prop changes" shape.)
   */
  const [seededFor, setSeededFor] = useState(seedKey);
  if (seededFor !== seedKey) {
    setSeededFor(seedKey);
    setLiveValues(seedValues);
    setOpenedFrom(seedValues);
    setDirtySinceSave(false);
  }
  /* A save that lands clears the cue — the same render-time adjust as above. */
  const [sawSaveSuccess, setSawSaveSuccess] = useState(saveSuccess);
  if (sawSaveSuccess !== saveSuccess) {
    setSawSaveSuccess(saveSuccess);
    if (saveSuccess) setDirtySinceSave(false);
  }
  const handleChange = useCallback((next: Record<string, string>) => {
    setLiveValues(next);
    setDirtySinceSave(true);
    // Through the bridge before it leaves this component: the run's setup snapshot must hold the
    // same shapes a form edit writes, or "what changed since your last run" would report every
    // grouped row as changed after every sheet-logged run.
    const plan = planRef.current;
    onValuesRef.current(plan ? surfaceValuesToStoredMerge(next, plan.fields) : next);
  }, []);

  /*
   * Geometry compares against the setup this run STARTED on — the previous run's, or whichever
   * setup was chosen above. `surfaceValuesToStored` rather than the merge variant on both sides:
   * the deletion markers the merge emits are for writing to a snapshot, not for reading a geometry
   * from.
   */
  const geometryValue = useMemo(
    () => (planFields ? surfaceValuesToStored(liveValues, planFields) : null),
    [liveValues, planFields]
  );
  const geometryBaseline = useMemo(
    () => (planFields ? surfaceValuesToStored(openedFrom, planFields) : null),
    [openedFrom, planFields]
  );

  /*
   * One row either way — the count on the left, the collapse control on the right. Collapsed is
   * the SAME row with a different verb, not an explanatory card: by the time a driver is here they
   * have chosen this car, and telling them its setup lives on a sheet in front of the sheet is the
   * redundancy that got the old panel removed.
   */
  const countLabel = `${filled} ${filled === 1 ? "box" : "boxes"} filled on ${chassisName}`;

  /* The save cue stays up through its own feedback: edits pending, saving, or just saved. */
  const showSave = dirtySinceSave || saving || saveSuccess;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{countLabel}</span>
        <div className="flex items-center gap-2">
          {showSave ? (
            <button
              type="button"
              onClick={onSaveToRun}
              disabled={!canSave || saving}
              className={buttonLinkClassName(
                "primary",
                "px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {saving ? "Saving…" : dirtySinceSave ? "Save to this run" : "Saved ✓"}
            </button>
          ) : null}
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
                // Re-opening reads the setup that is current NOW — a collapsed spell may have
                // seen named fields edited through the ordinary form — so the sheet and the
                // geometry baseline both restart there.
                setLiveValues(seedValues);
                setOpenedFrom(seedValues);
                setCollapsedFor(null);
              }}
              className={buttonLinkClassName("outline")}
            >
              Open the sheet
            </button>
          )}
        </div>
      </div>
      {open ? (
        <>
          {geometryValue ? (
            <SheetGeometryStrip
              value={geometryValue}
              baselineValue={geometryBaseline}
              templateKey={templateKey}
              labLabels={{ s: "This run", g: "Setup you started from" }}
            />
          ) : null}
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
              setPlanFields(p.fields);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
