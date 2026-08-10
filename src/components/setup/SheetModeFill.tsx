"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { useSetupFillDraft } from "@/components/setup/useSetupFillDraft";

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

/** Empty boxes are absent, not blank. See below. */
function withoutEmpties(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

const DRAFT_DEBOUNCE_MS = 1200;

export function SheetModeFill({
  carId,
  setupSheetModelId,
  chassisName,
  initialValues,
  initialName,
}: {
  carId: string;
  setupSheetModelId: string;
  chassisName: string;
  /** A resumed draft, or the setup being edited. Absent for a fresh sheet. */
  initialValues?: Record<string, string>;
  initialName?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
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

  const onSurfaceChange = useCallback(
    (next: Record<string, string>) => {
      setValues(next);
      if (!draft) return;
      // Each change re-arms the timer and cancels the one before it, so the values captured here
      // are by construction the newest ones when it finally fires. No ref needed to chase them.
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const payload = withoutEmpties(next);
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
    [draft]
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
      const payload = withoutEmpties(values);
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

  const filled = Object.keys(withoutEmpties(values)).length;

  return (
    <div className="space-y-3">
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={initialValues}
        onChange={onSurfaceChange}
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
