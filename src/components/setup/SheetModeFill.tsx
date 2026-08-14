"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { useSetupFillDraft } from "@/components/setup/useSetupFillDraft";
import { withoutEmptySheetValues } from "@/lib/setupSheetModels/sheetValues";
import {
  storedValuesToSurface,
  surfaceValuesToStored,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { SetupSnapshotData } from "@/lib/runSetup";

/** One setup a new sheet can be started from, whatever it is: kept, run, read from a PDF, or global. */
export type SheetStartChoice = {
  id: string;
  label: string;
  /** The second line — a date, a track, a baseline's kind. Absent when there is nothing to add. */
  meta?: string;
  data: SetupSnapshotData;
};

/** Choices under a heading, so "my setups" and "published baselines" never read as one list. */
export type SheetStartGroup = {
  title: string;
  choices: SheetStartChoice[];
};

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
  startChoices,
  parkedDraft,
  templateKey,
}: {
  carId: string;
  setupSheetModelId: string;
  chassisName: string;
  /** Chassis-type key, for the computed-geometry strip. No key, no strip. */
  templateKey?: string | null;
  /**
   * A resumed draft, or the setup being edited — in STORED shapes (arrays, preset objects), which
   * is what drafts and snapshots hold. Converted to the surface's strings here, and back to
   * stored shapes on every save, so a sheet-saved setup is byte-compatible with a form-saved one.
   */
  initialValues?: Record<string, unknown>;
  initialName?: string;
  /**
   * Set ONLY when the driver came through the "start from one you already have" door: this car's
   * own setups first, then the baselines published for its chassis. Whichever they pick is poured
   * into the boxes. Undefined — which is every other way onto this page — opens the sheet
   * immediately, as it always has.
   */
  startChoices?: SheetStartGroup[];
  /**
   * A fill already parked on this car, when there is one AND the driver came through the start-from
   * door. It has to be offered rather than assumed: a draft used to skip the picker entirely, so a
   * driver who asked to start from an existing setup was silently dropped onto their half-finished
   * sheet instead — and since a draft is written the moment anyone types a box, that was nearly
   * everyone. Reported from prod 2026-08-15.
   */
  parkedDraft?: { answeredCount: number; stepCount: number } | null;
}) {
  const router = useRouter();
  const startGroups = useMemo(
    () => (startChoices ?? []).filter((g) => g.choices.length > 0),
    [startChoices]
  );
  /**
   * Whether the "what do I start from" question is still standing between the driver and their
   * sheet. Answered by picking one or by declining; an empty list never asks it at all.
   */
  const [picking, setPicking] = useState(startGroups.length > 0);
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
  /**
   * The same plan again, as state.
   *
   * The ref is what saving reads, and a ref cannot make the geometry strip redraw when the plan
   * finally lands. `onPlanLoaded` fires exactly once, from the surface's fetch, so this is one
   * render — not a loop.
   */
  const [planFields, setPlanFields] = useState<SheetFillPlan["fields"] | null>(null);
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

  /*
   * What the geometry strip reads: the boxes as they stand, and the boxes as they opened.
   *
   * Both go through the same bridge saving uses, so the numbers on the strip are computed from the
   * shapes that will actually be stored — not from a second, looser reading of the same boxes. The
   * baseline is deliberately the values as LOADED (or as poured from a baseline), which makes the
   * delta read "what I have changed this session".
   */
  const geometryValue = useMemo(
    () => (planFields ? surfaceValuesToStored(values, planFields) : null),
    [values, planFields]
  );
  const geometryBaseline = useMemo(
    () => (planFields && startValues ? surfaceValuesToStored(startValues, planFields) : null),
    [startValues, planFields]
  );

  /** Pour a setup into the boxes, then get out of the way — the sheet is what they came for. */
  function startFrom(choice: SheetStartChoice | null) {
    if (choice) {
      // Through the same bridge every stored setup takes: arrays and preset objects must land in
      // the boxes, not print as "[object Object]".
      const poured = storedValuesToSurface(choice.data);
      setStartValues(poured);
      setValues(poured);
      setName(choice.label);
    }
    setPicking(false);
  }

  if (picking && startGroups.length > 0) {
    return (
      <div className="space-y-3">
        <div className="px-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Start from one you already have</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Its values go into the boxes on your {chassisName} sheet. Change whatever you want from
            there — the setup you copied is untouched.
          </p>
        </div>

        {/*
          Grouped, never merged. A setup off last weekend's run and a baseline published for the
          whole chassis are different kinds of thing to start from, and a driver scanning one list
          for "the one I ran at Mount Barker" should not have to read past three kit sheets.
        */}
        {/*
          The draft goes first, because it is the only choice on this list that is already open —
          picking anything else pours over what they had. Declining it is the two lines underneath.
        */}
        {parkedDraft ? (
          <section className="space-y-1.5">
            <h3 className="micro-caps px-1 text-faint">Where you left off</h3>
            <ul className="divide-y divide-border rounded-lg border border-amber-500/40 bg-amber-500/5">
              <li>
                <button
                  type="button"
                  onClick={() => startFrom(null)}
                  className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      Carry on with your draft
                    </span>
                    <span className="block truncate tabular-nums text-[11px] text-muted-foreground">
                      {parkedDraft.answeredCount} of {parkedDraft.stepCount} boxes filled
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">›</span>
                </button>
              </li>
            </ul>
          </section>
        ) : null}

        {startGroups.map((group) => (
          <section key={group.title} className="space-y-1.5">
            <h3 className="micro-caps px-1 text-faint">{group.title}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {group.choices.map((choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    onClick={() => startFrom(choice)}
                    className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {choice.label}
                      </span>
                      {choice.meta ? (
                        <span className="block truncate tabular-nums text-[11px] text-muted-foreground">
                          {choice.meta}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-muted-foreground">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/*
          With a draft parked, "empty" has to actually empty the boxes — otherwise this line and
          the draft row above it would do the same thing, and one of them would be lying.
        */}
        <button
          type="button"
          onClick={() => {
            if (parkedDraft) {
              setStartValues({});
              setValues({});
            }
            startFrom(null);
          }}
          className="px-1 text-[12.5px] text-muted-foreground underline hover:text-foreground"
        >
          {parkedDraft
            ? "Start from an empty sheet instead — this replaces your draft"
            : "Start from an empty sheet instead"}
        </button>
      </div>
    );
  }

  /*
   * The clip at the top of the paper: what this sheet is called, whether what they have typed is
   * safe, and the way out.
   *
   * All three used to sit UNDER the surface — which on a phone is under a full A4 page of boxes, so
   * naming a setup meant scrolling past two hundred of them to reach the field, and saving meant
   * scrolling back down there again (founder, 2026-08-14).
   *
   * NOT `position: sticky`, however much it wants to be. `.app-shell` is `overflow-x: hidden`, and
   * the spec computes `overflow-y` from `visible` to `auto` for that — making the shell a scrollport
   * that never actually scrolls, so a sticky child resolves its offsets against a container that
   * stays put and simply scrolls away. That is why `TopRail` lives outside the shell. A sticky bar
   * here would read correctly in the source and do nothing on the page.
   *
   * The box count is deliberately NOT repeated here: `SheetFillSurface` already draws it directly
   * below, as a bar with a denominator (`98 / 233`), which is the better of the two.
   */
  const clip = (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="micro-caps text-faint">Name this setup</span>
        {/*
         * Draft state, where they can see it while filling rather than a page-scroll away. Never
         * green: green and red are pace and quality deltas everywhere else in the app, and a
         * saved draft is neither.
         */}
        {draftState === "idle" ? null : (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[11px]",
              draftState === "failed" ? "text-warning" : "text-muted-foreground"
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {draftState === "saving"
              ? "Saving"
              : draftState === "saved"
                ? "Draft saved"
                : "Draft didn't save"}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-end gap-3">
        {/*
         * Ruled, not boxed. The paper this screen exists to draw writes its NAME on a rule, and the
         * title of the document is the one place worth borrowing the sheet's own vocabulary.
         *
         * `type="text"` is load-bearing rather than tidiness: the app's focus ring is
         * `input[type="text"]:focus-visible`, which never matched this field while it carried no
         * type attribute at all — so it had no visible keyboard focus.
         *
         * The placeholder is smaller than the typed value on purpose. It is the name this setup
         * GETS if they type nothing, so it has to fit — at the typed size "Awesomatix A800RR setup"
         * clipped to "…A800RR setu" — and a lighter voice is the honest one for a suggestion.
         */}
        <input
          type="text"
          className="min-h-11 min-w-0 flex-1 rounded-none border-0 border-b border-border bg-transparent px-0 pb-1.5 text-[15px] font-semibold tracking-tight text-foreground outline-none placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal placeholder:text-faint"
          placeholder={`${chassisName} setup`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Setup name"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={cn(
            buttonLinkClassName("primary"),
            "min-h-11 shrink-0 px-5 text-[13px]",
            saving && "pointer-events-none opacity-70"
          )}
        >
          {saving ? "Saving…" : "Save setup"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-warning">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      {clip}
      {geometryValue ? (
        <SheetGeometryStrip
          value={geometryValue}
          baselineValue={geometryBaseline}
          templateKey={templateKey}
          labLabels={{ s: name.trim() || "This sheet", g: "As opened" }}
        />
      ) : null}
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={startValues}
        onChange={onSurfaceChange}
        onPlanLoaded={(p) => {
          planRef.current = p;
          setPlanFields(p.fields);
        }}
      />
    </div>
  );
}
