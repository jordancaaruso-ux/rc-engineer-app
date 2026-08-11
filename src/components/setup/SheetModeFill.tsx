"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import { useSetupFillDraft } from "@/components/setup/useSetupFillDraft";
import { withoutEmptySheetValues } from "@/lib/setupSheetModels/sheetValues";
import {
  storedValuesToSurface,
  surfaceValuesToStored,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { BaselineStartChoice } from "@/components/setup/NewCarSetupClient";
import type { SetupSnapshotData } from "@/lib/runSetup";

/**
 * Filling a setup on a chassis that came from somebody's own PDF: their sheet, on screen, in the
 * places the boxes sit on the paper.
 *
 * `SheetFillSurface` draws and does not persist. This owns everything about keeping the values:
 * the draft while they fill, the save when they finish, and the one shape correction the server's
 * normaliser cannot make for us.
 *
 * ============================== WHY THE DRAFT IS ON THE SERVER ==============================
 *
 * A setup sheet is filled across a day at a track, not in one sitting — between heats, one-handed,
 * on a phone that locks itself. The surface used to keep values in `localStorage`, which is fine
 * for trying it out and wrong the moment the values are somebody's actual setup: a cleared browser,
 * a different phone, or the app being evicted from memory takes the lot.
 */

const DRAFT_DEBOUNCE_MS = 1200;

export function SheetModeFill({
  carId,
  setupSheetModelId,
  chassisName,
  initialValues,
  initialName,
  baselines,
}: {
  carId: string;
  setupSheetModelId: string;
  chassisName: string;
  /**
   * A resumed draft, or the setup being edited — in STORED shapes (arrays, preset objects), which
   * is what drafts and snapshots hold. Converted to the surface's strings here, and back to
   * stored shapes on every save, so a sheet-saved setup is byte-compatible with a form-saved one.
   */
  initialValues?: Record<string, unknown>;
  initialName?: string;
  /**
   * Set ONLY when the driver came through the "start from a baseline" door. The baselines are then
   * offered before the sheet, and whichever one they pick is poured into the boxes. Undefined —
   * which is every other way onto this page — opens the sheet immediately, as it always has.
   */
  baselines?: BaselineStartChoice[];
}) {
  const router = useRouter();
  /**
   * Which baseline to pour in, when there is a choice to make. `null` means "not chosen yet" and is
   * the only thing standing between the driver and their sheet — an empty list, or no `baselines`
   * prop at all, never holds the sheet up.
   */
  const [pickingBaseline, setPickingBaseline] = useState(Boolean(baselines?.length));
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues ? storedValuesToSurface(initialValues) : {}
  );
  /**
   * What the boxes open at. Read once, when the surface mounts — which is why the surface is not
   * rendered at all until the baseline question is answered. Changing this afterwards would do
   * nothing, and pretending otherwise is how a driver loses what they have typed.
   */
  const [startValues, setStartValues] = useState<Record<string, string> | undefined>(() =>
    initialValues ? storedValuesToSurface(initialValues) : undefined
  );
  /**
   * The plan, once the surface has fetched it. Saving needs it to give grouped values back their
   * stored shapes; until it arrives a save falls back to the raw strings, which the storage
   * normaliser has always accepted — the window is the first second of the page, before anything
   * has been typed.
   */
  const planRef = useRef<SheetFillPlan | null>(null);
  const [name, setName] = useState(initialName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const draft = useSetupFillDraft({ carId }, { name: name || null });

  /*
   * Drafting is debounced and must never block typing.
   *
   * The surface reports after each box rather than each keystroke, but a driver sweeping a sheet
   * still moves through boxes faster than a round trip completes. A failed draft is a pill, not an
   * error: they are still filling their sheet, and the save at the end is the one that counts.
   */
  const timerRef = useRef<number | null>(null);

  /** Surface strings → stored shapes; raw strings only in the pre-plan first second. */
  const toStoredPayload = useCallback((surface: Record<string, string>): SetupSnapshotData => {
    const plan = planRef.current;
    if (!plan) return withoutEmptySheetValues(surface);
    // The bridge only emits SetupSnapshotValue shapes: strings, arrays, preset objects.
    return surfaceValuesToStored(surface, plan.fields) as SetupSnapshotData;
  }, []);

  const onSurfaceChange = useCallback(
    (next: Record<string, string>) => {
      setValues(next);
      if (!draft) return;
      // Each change re-arms the timer and cancels the one before it, so the values captured here
      // are by construction the newest ones when it finally fires. No ref needed to chase them.
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const payload = toStoredPayload(next);
        setDraftState("saving");
        draft
          .save({
            values: payload,
            stepIndex: 0,
            pendingText: null,
            pendingStepKey: null,
            answeredCount: Object.keys(payload).length,
            stepCount: Object.keys(payload).length,
          })
          .then(() => setDraftState("saved"))
          .catch(() => setDraftState("failed"));
      }, DRAFT_DEBOUNCE_MS);
    },
    [draft, toStoredPayload]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function save() {
    if (saving) return;
    haptic("light");
    setSaving(true);
    setError(null);
    try {
      /*
       * Strip the boxes they opened and left blank.
       *
       * `normalizeSetupSnapshotForStorage` keeps `""` for a key it does not recognise, and every
       * key on a derived sheet is one it does not recognise. So a box the driver tapped, thought
       * about and left alone would be stored as a deliberate blank — and then show up in "what
       * changed since your last run" every time, forever. Corrected here rather than in the
       * normaliser, which every setup writer in the app shares.
       */
      const payload = toStoredPayload(values);
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          name: name.trim() || `${chassisName} setup`,
          data: payload,
          clearFillDraft: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Couldn't save (${res.status})`);
      }
      router.push(`/cars/${carId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that setup.");
      setSaving(false);
    }
  }

  const filled = Object.keys(withoutEmptySheetValues(values)).length;

  /** Pour a baseline into the boxes, then get out of the way — the sheet is what they came for. */
  function startFrom(choice: BaselineStartChoice | null) {
    if (choice) {
      // Through the same bridge every stored setup takes: a baseline's arrays and preset objects
      // must land in the boxes, not print as "[object Object]".
      const poured = storedValuesToSurface(choice.data);
      setStartValues(poured);
      setValues(poured);
      setName(choice.label);
    }
    setPickingBaseline(false);
  }

  if (pickingBaseline && baselines?.length) {
    return (
      <div className="space-y-3">
        <div className="px-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Start from a baseline</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Its values go into the boxes on your {chassisName} sheet. Change whatever you want from
            there — nothing is locked.
          </p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {baselines.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => startFrom(b)}
                className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{b.label}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {[b.kindLabel, b.contextLabel].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground">›</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => startFrom(null)}
          className="px-1 text-[12.5px] text-muted-foreground underline hover:text-foreground"
        >
          Start from an empty sheet instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={startValues}
        onChange={onSurfaceChange}
        onPlanLoaded={(p) => {
          planRef.current = p;
        }}
      />

      <div className="space-y-2 px-3">
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Name this setup</label>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            placeholder={`${chassisName} setup`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Setup name"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={cn(buttonLinkClassName("primary"), saving && "pointer-events-none opacity-70")}
          >
            {saving ? "Saving…" : "Save setup"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {filled} {filled === 1 ? "box" : "boxes"} filled
            {draftState === "saving"
              ? " · saving"
              : draftState === "saved"
                ? " · saved"
                : draftState === "failed"
                  ? " · not saved yet"
                  : ""}
          </span>
        </div>

        {error ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{error}</p> : null}
      </div>
    </div>
  );
}
