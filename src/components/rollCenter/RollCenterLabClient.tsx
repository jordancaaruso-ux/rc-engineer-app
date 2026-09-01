"use client";

/**
 * Geometry Lab — the interactive what-if surface (Phase 3,
 * docs/ROLL_CENTER_NORTH_STAR.md). Two setup SLOTS, A and B: fill either from
 * URL seeds (`s`/`g` + `sl`/`gl` labels), the setup picker (own runs ·
 * downloaded sheets · teammate-shared runs), or by freezing the current
 * what-if into B. Tap a slot chip to select it: the selected setup renders
 * solid and drives every value below the diagram; the other renders as the
 * dashed ghost. Sliders edit whichever slot is selected — both stay live.
 *
 * Delta chips only exist against a real comparison (the other slot) — never
 * against the blank no-shim car. The diff list reads other → selected in
 * compare mode, and edits-vs-loaded-sheet in single-setup mode.
 *
 * State is client-side sheet vocabulary; the picker reads the same authed
 * sources as the Load-setup flow (/api/runs/for-picker + /api/setup/options
 * + /api/runs/teammate-for-picker). Deltas between setups are
 * instrument-grade; absolutes carry the pack grade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AxleSchematic, type ChassisPlate } from "@/components/rollCenter/AxleSchematic";
import { LabSheetPane } from "@/components/rollCenter/LabSheetPane";
import {
  chassisBottomAt,
  chassisPlateCorners,
  computeAxleMetrics,
  solveAxle,
  type AxleAdjustments,
  type SolvedAxle,
  type Vec2,
} from "@/lib/rollCenter/engine";
import {
  computeRollCenterFromSnapshot,
  deriveRollCenterInputs,
} from "@/lib/rollCenter/computeFromSnapshot";
import {
  DEFAULT_CHASSIS_HALF_WIDTH_MM,
  resolveLabPack,
  resolvePackForSnapshot,
} from "@/lib/rollCenter/packs";
import {
  GEOMETRY_SHEET_KEYS,
  LAB_DEFAULT_FIELDS,
  decodeLabSlot,
  encodeLabFields,
  encodeLabSlot,
  extractGeometryFields,
  labChangeList,
  type GeometrySheetKey,
  type LabFields,
  type LabSource,
} from "@/lib/rollCenter/labState";
import { loadLabSource, saveLabSlot, type LabWriteTarget } from "@/lib/rollCenter/labSource";
import {
  formatRunCreatedRelativeWhen,
  formatRunPickerParts,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import Link from "next/link";

const ROLL_MAX_DEG = 3;

/** Square reset button sitting against each pose slider. */
const POSE_ICON_BUTTON =
  "tap-active grid size-5 shrink-0 place-items-center rounded border border-border text-muted-foreground transition hover:border-primary-ink/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

/** Which list a row belongs to. One tab each; a row never appears in two. */
type PickerSource = "mine" | "teammates" | "setups";

/**
 * One searchable setup row. `title` answers "which session", `detail` answers
 * "which car, where, how fast" — two lines, because one line at 390px clips
 * exactly the half that tells two rows apart. `label` is the flattened form,
 * kept for the slot chip and the shareable URL.
 */
type SetupPickerEntry = {
  id: string;
  kind: "run" | "sheet" | "saved" | "team";
  source: PickerSource;
  label: string;
  title: string;
  detail: string;
  when: string;
  fields: LabFields;
  /*
   * The picker's own APIs already return the whole snapshot and the chassis it belongs to — the Lab
   * used to keep the geometry slice and drop both. Keeping them is what lets a picked setup draw its
   * sheet and be saved back to, with no second round trip.
   */
  setupSheetModelId: string | null;
  fullData: Record<string, unknown> | null;
  /**
   * Whether this row's car has measured hardpoints behind it.
   *
   * The picker used to DROP every row that answered false, which is why a driver on anything but
   * an Awesomatix opened the Lab to an empty list — the app knew about their setups and simply
   * declined to mention them. Rows are marked now, never hidden: "no measurements" tells you what
   * is missing, an empty list tells you nothing.
   */
  hasGeometry: boolean;
  /** Where a save may land. Resolved from what this row IS, not from anything the driver picks. */
  write: LabWriteTarget | null;
  labSource: LabSource | null;
};

/** Per-source row cap: no source can crowd out another, unlike the old shared 30. */
const PICKER_ROWS_PER_SOURCE = 40;

const PICKER_SOURCE_LABEL: Record<PickerSource, string> = {
  mine: "Mine",
  teammates: "Teammates",
  setups: "Setups",
};

function flattenPickerLabel(title: string, detail: string): string {
  return detail ? `${title} · ${detail}` : title;
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function fmtMm(v: number, dp = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
}

/**
 * Which pin of the arm a per-leg key drives.
 *
 * The suffix is two letters: the axle, then the pin. `upper_inner_shims_ff` is the FRONT axle's
 * FRONT pin; `_fr` the front axle's rear pin. The axle half is already in the section heading, so
 * only the pin is worth the width.
 */
function legLabel(key: GeometrySheetKey): string | undefined {
  if (/_(?:f|r)f$/.test(key)) return "front pin";
  if (/_(?:f|r)r$/.test(key)) return "rear pin";
  return undefined;
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-axle control rows: which sheet keys each slider writes (all legs equalized on edit).
 *
 * `teaching` is the name the same slider wears on the teaching model, which has no parts to name —
 * so it says what the adjustment DOES instead. "Under lower arm" is a shim stack, and plenty of
 * chassis move that mount with an eccentric insert and no shim in sight; "raise lower arm inner"
 * is true of all of them.
 */
const AXLE_SLIDERS: Record<
  "front" | "rear",
  { label: string; teaching: string; keys: GeometrySheetKey[]; max: number }[]
> = {
  front: [
    { label: "Under lower arm", teaching: "Raise lower arm inner", keys: ["under_lower_arm_shims_ff", "under_lower_arm_shims_fr"], max: 5 },
    { label: "Under hub", teaching: "Raise hub off lower ball", keys: ["under_hub_shims_front"], max: 3 },
    { label: "Upper inner", teaching: "Raise upper link inner", keys: ["upper_inner_shims_ff", "upper_inner_shims_fr"], max: 5 },
    { label: "Upper outer", teaching: "Raise upper link outer", keys: ["upper_outer_shims_front"], max: 3 },
  ],
  rear: [
    { label: "Under lower arm", teaching: "Raise lower arm inner", keys: ["under_lower_arm_shims_rf", "under_lower_arm_shims_rr"], max: 5 },
    { label: "Under hub", teaching: "Raise hub off lower ball", keys: ["under_hub_shims_rear"], max: 3 },
    { label: "Upper inner", teaching: "Raise upper link inner", keys: ["upper_inner_shims_rf", "upper_inner_shims_rr"], max: 5 },
    { label: "Upper outer", teaching: "Raise upper link outer", keys: ["upper_outer_shims_rear"], max: 3 },
  ],
};

const SENSITIVITY_SLIDERS: { label: string; teaching: string; adjKey: keyof AxleAdjustments }[] = [
  { label: "Under lower arm", teaching: "Lower arm inner", adjKey: "underLowerArmMm" },
  { label: "Under hub", teaching: "Hub off lower ball", adjKey: "underHubMm" },
  { label: "Upper inner", teaching: "Upper link inner", adjKey: "upperInnerMm" },
  { label: "Upper outer", teaching: "Upper link outer", adjKey: "upperOuterMm" },
];

/** One slider row: label + 0.25-detent slider + free-typed mm box (founder rulings). */
function SliderRow({
  label,
  sublabel,
  value,
  min = 0,
  max,
  step = 0.25,
  unit = "mm",
  onChange,
}: {
  label: string;
  /** Which leg this row drives, on the split rows only. */
  sublabel?: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="type-data-label w-[9.5rem] shrink-0">
        {label}
        {sublabel ? (
          <span className="block text-faint normal-case tracking-normal">{sublabel}</span>
        ) : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label}${sublabel ? ` ${sublabel}` : ""} (${unit})`}
        className="min-w-0 flex-1 accent-primary"
      />
      <input
        type="number"
        inputMode="decimal"
        step={0.05}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label}${sublabel ? ` ${sublabel}` : ""} exact value (${unit})`}
        className="w-16 shrink-0 rounded-md border border-border bg-secondary px-1.5 py-1 text-right text-[11px] tabular-nums"
      />
    </div>
  );
}

/* ── Setup slots ──────────────────────────────────────────────────────────── */

type SlotId = "a" | "b";

type Slot = {
  fields: LabFields;
  /** The as-loaded state when the slot came from a real setup; null = blank car. */
  loaded: LabFields | null;
  label: string | null;
  /** Which chassis's sheet this setup draws on. Null on a bare geometry link — no sheet, sliders only. */
  setupSheetModelId: string | null;
  /** The row these values came from, kept so the URL stays re-shareable and reloads intact. */
  source: LabSource | null;
  /**
   * Every stored value, when the slot came from a row we could read whole.
   *
   * Sheet mode and the save path both stand on this. Nineteen geometry keys cannot draw a sheet —
   * they would leave 260 boxes blank on the driver's own paper — and writing nineteen keys back as a
   * setup would erase everything they don't mention. No full data, no sheet and no save.
   */
  fullData: Record<string, unknown> | null;
  /** Where a save from this slot may land. Null while unknown, or when nothing may be written. */
  write: LabWriteTarget | null;
  /**
   * A box was edited on the sheet.
   *
   * The change list only tracks the nineteen geometry keys, which is right for the readouts — but in
   * sheet mode the driver can type into any of the ~300 boxes, and a spring change they made here is
   * still a change they expect to be able to save. Without this the save button would sit disabled
   * over an edit they can see on the paper in front of them.
   */
  sheetDirty: boolean;
};

function slotFromFields(
  rawFields: LabFields,
  label: string | null,
  origin?: Partial<Pick<Slot, "setupSheetModelId" | "source" | "fullData" | "write">>
): Slot {
  const merged = { ...LAB_DEFAULT_FIELDS, ...rawFields };
  return {
    fields: merged,
    loaded: { ...merged },
    label,
    setupSheetModelId: origin?.setupSheetModelId ?? null,
    source: origin?.source ?? null,
    fullData: origin?.fullData ?? null,
    write: origin?.write ?? null,
    sheetDirty: false,
  };
}

/** The blank no-shim car — not a setup, so it carries no sheet, no data and nowhere to save. */
function blankSlot(): Slot {
  return {
    fields: { ...LAB_DEFAULT_FIELDS },
    loaded: null,
    label: null,
    setupSheetModelId: null,
    source: null,
    fullData: null,
    write: null,
    sheetDirty: false,
  };
}

function slotName(slot: Slot): string {
  return slot.label ?? (slot.loaded ? "Loaded sheet" : "Blank car");
}

/** One slot chip: tap to make this setup the solid, editable one. */
function SlotChip({
  id,
  slot,
  selected,
  onSelect,
  onClear,
}: {
  id: SlotId;
  slot: Slot;
  selected: boolean;
  onSelect: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 transition",
        selected
          ? "border-primary-ink/60 bg-secondary"
          : "border-dashed border-border text-muted-foreground"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={slotName(slot)}
      >
        <span
          className={cn(
            "shrink-0 rounded border px-1 micro-caps",
            selected ? "border-primary-ink/60 text-foreground" : "border-border text-faint"
          )}
        >
          {id}
        </span>
        <span className="truncate text-xs font-semibold">{slotName(slot)}</span>
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear setup ${id.toUpperCase()}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function RollCenterLabClient({ seed, seedLabel, ghostSeed, ghostSeedLabel }: {
  seed: string | null;
  seedLabel?: string | null;
  ghostSeed: string | null;
  ghostSeedLabel?: string | null;
}) {
  const [slots, setSlots] = useState<{ a: Slot; b: Slot | null }>(() => {
    const aDecoded = seed ? decodeLabSlot(seed) : null;
    const bDecoded = ghostSeed ? decodeLabSlot(ghostSeed) : null;
    return {
      a: aDecoded
        ? slotFromFields(aDecoded.fields, seedLabel ?? null, {
            setupSheetModelId: aDecoded.setupSheetModelId,
            source: aDecoded.source,
          })
        : blankSlot(),
      b: bDecoded
        ? slotFromFields(bDecoded.fields, ghostSeedLabel ?? null, {
            setupSheetModelId: bDecoded.setupSheetModelId,
            source: bDecoded.source,
          })
        : null,
    };
  });

  /*
   * A seeded slot arrives holding the geometry slice and a reference. Follow the reference once, on
   * mount, to fill in the rest of the sheet and work out whether this row may be written to.
   *
   * The fetch is deliberately not awaited before first paint: geometry is computable from the slice
   * alone, so the Lab draws immediately and the sheet becomes available a moment later. A reference
   * that can't be read — stale link, deleted setup, a teammate's row that stopped being shared —
   * leaves the slot exactly as the URL described it, which still works.
   */
  useEffect(() => {
    const seeds: [SlotId, string | null][] = [
      ["a", seed],
      ["b", ghostSeed],
    ];
    let cancelled = false;
    for (const [slotId, raw] of seeds) {
      const decoded = raw ? decodeLabSlot(raw) : null;
      if (!decoded?.source) continue;
      void loadLabSource(decoded.source).then((loaded) => {
        if (cancelled || !loaded) return;
        setSlots((s) => {
          const slot = slotId === "a" ? s.a : s.b;
          if (!slot) return s;
          /*
           * The URL's slice wins over the fetched row on the keys it carries. A link can encode a
           * what-if that was never saved ("open in Lab with this shim change"), and re-reading the
           * stored values over the top would silently undo it.
           */
          const merged = { ...loaded.fields, ...decoded.fields };
          const next: Slot = {
            ...slot,
            fields: { ...LAB_DEFAULT_FIELDS, ...merged },
            loaded: { ...LAB_DEFAULT_FIELDS, ...merged },
            label: slot.label ?? loaded.label,
            setupSheetModelId: slot.setupSheetModelId ?? loaded.setupSheetModelId,
            fullData: loaded.fullData,
            write: loaded.write,
          };
          return slotId === "a" ? { ...s, a: next } : { ...s, b: next };
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [seed, ghostSeed]);
  const [sel, setSel] = useState<SlotId>("a");
  const [axle, setAxle] = useState<"front" | "rear">("front");
  const [rollDeg, setRollDeg] = useState(0);
  /**
   * Chassis bump, held as movement from the setup's own ride height (0 = at rest) even
   * though the slider reads absolute ride height. Storing the delta is what keeps the
   * pose meaningful when the ride-height slider moves or the axle toggles: "2mm of squat"
   * stays 2mm of squat, and the absolute readout re-reads itself.
   */
  const [bumpMm, setBumpMm] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Sliders or the setup's own sheet. Sliders is the default — see the toggle's note below. */
  const [inputMode, setInputMode] = useState<"sliders" | "sheet">("sliders");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Guard: selection can never point at an empty slot.
  const activeId: SlotId = sel === "b" && slots.b ? "b" : "a";
  const otherId: SlotId = activeId === "a" ? "b" : "a";
  const active = activeId === "b" ? slots.b! : slots.a;
  const other = activeId === "a" ? slots.b : slots.a;
  const comparing = slots.b != null;
  const activeName = slotName(active);
  const otherName = comparing && other ? slotName(other) : null;

  /*
   * The sheet needs both halves: a chassis to draw, and the whole snapshot to draw INTO it. A slot
   * seeded from a bare geometry link has neither, and the toggle simply doesn't appear — the Lab
   * behaves exactly as it did before this existed.
   */
  const sheetAvailable = Boolean(active.setupSheetModelId && active.fullData);
  const sheetMode = sheetAvailable && inputMode === "sheet";

  /* ── Setup picker (own runs + teammates + saved setups & sheets) ── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerTab, setPickerTab] = useState<PickerSource>("mine");
  const [pickerSources, setPickerSources] = useState<SetupPickerEntry[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  /** In-flight guard (a ref, so two taps in one render can't both fire the fetch). */
  const pickerFetching = useRef(false);
  /** True while the picker is open, so each fresh open refetches exactly once. */
  const pickerOpenedRef = useRef(false);

  const loadPickerSources = async () => {
    if (pickerFetching.current) return;
    pickerFetching.current = true;
    setPickerLoading(true);
    setPickerError(null);
    const safeJson = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    const [runsRes, docsRes, teamRes, libRes] = await Promise.all([
      safeJson("/api/runs/for-picker") as Promise<{ runs?: RunPickerRun[] } | null>,
      safeJson("/api/setup/options") as Promise<{
        downloadedSetups?: {
          id: string;
          originalFilename?: string | null;
          createdAt?: string;
          setupData?: unknown;
          documentSetupTemplate?: string | null;
          baselineSetupSnapshotId?: string | null;
        }[];
      } | null>,
      safeJson("/api/runs/teammate-for-picker") as Promise<{
        runs?: (RunPickerRun & { userId?: string | null })[];
        memberDisplayByUserId?: Record<string, string>;
      } | null>,
      safeJson("/api/setups/library-for-picker") as Promise<{
        setups?: {
          id: string;
          name?: string | null;
          createdAt?: string;
          carId?: string | null;
          carName?: string | null;
          setupSheetModelId?: string | null;
          setupData?: unknown;
          runCount?: number;
        }[];
      } | null>,
    ]);
    if (!runsRes && !docsRes && !teamRes && !libRes) {
      // Keep whatever is already on screen — a failed refetch must not blank a usable list.
      setPickerError("Couldn't load your setups — check you're signed in.");
      setPickerLoading(false);
      pickerFetching.current = false;
      return;
    }
    const entries: SetupPickerEntry[] = [];
    const push = (
      id: string,
      kind: SetupPickerEntry["kind"],
      source: PickerSource,
      title: string,
      detail: string,
      when: string,
      data: Record<string, unknown>,
      origin?: {
        setupSheetModelId?: string | null;
        labSource?: LabSource | null;
        write?: LabWriteTarget | null;
      }
    ) => {
      entries.push({
        id,
        kind,
        source,
        label: flattenPickerLabel(title, detail),
        title,
        detail,
        when,
        fields: extractGeometryFields(data),
        setupSheetModelId: origin?.setupSheetModelId ?? null,
        hasGeometry: resolvePackForSnapshot(data) != null,
        // The row already holds the whole snapshot; keeping it is free and is what sheet mode needs.
        fullData: data,
        labSource: origin?.labSource ?? null,
        write: origin?.write ?? null,
      });
    };
    for (const run of runsRes?.runs ?? []) {
      const data = run.setupSnapshot?.data;
      if (!isJsonObject(data)) continue;
      const parts = formatRunPickerParts(run);
      push(`run-${run.id}`, "run", "mine", parts.title, parts.detail, parts.when, data, {
        setupSheetModelId: run.car?.setupSheetModelId ?? null,
        labSource: { kind: "run", id: run.id },
        // Your own run: correctable, never overwritable — the correction writes a new snapshot.
        write: { kind: "run", runId: run.id },
      });
    }
    for (const run of teamRes?.runs ?? []) {
      const data = run.setupSnapshot?.data;
      if (!isJsonObject(data)) continue;
      const parts = formatRunPickerParts(run, teamRes?.memberDisplayByUserId);
      push(`team-${run.id}`, "team", "teammates", parts.title, parts.detail, parts.when, data, {
        setupSheetModelId: run.car?.setupSheetModelId ?? null,
        labSource: { kind: "run", id: run.id },
        // Readable, never writable. Copying it onto your own car is the only move.
        write: { kind: "copy", carId: run.carId ?? null },
      });
    }
    const savedIds = new Set<string>();
    for (const saved of libRes?.setups ?? []) {
      const data = saved.setupData;
      if (!isJsonObject(data)) continue;
      savedIds.add(saved.id);
      push(
        `saved-${saved.id}`,
        "saved",
        "setups",
        saved.name?.trim() || "Untitled setup",
        // Car only. A value count reads as detail but answers nothing you'd ask here,
        // and it cost a second wrapped line on names that are already long.
        saved.carName?.trim() || "",
        saved.createdAt ? formatRunCreatedRelativeWhen(saved.createdAt) : "",
        data,
        {
          setupSheetModelId: saved.setupSheetModelId ?? null,
          labSource: { kind: "setup", id: saved.id },
          /*
           * A saved setup with runs behind it is one of those runs' own records (saving marks, it
           * does not copy), so it carries history and cannot be written in place. Which run to
           * correct is ambiguous past the first, so copy is the only unambiguous answer.
           */
          write:
            (saved.runCount ?? 0) > 0
              ? { kind: "copy", carId: saved.carId ?? null }
              : { kind: "in-place", setupId: saved.id },
        }
      );
    }
    for (const sheet of docsRes?.downloadedSetups ?? []) {
      const data = sheet.setupData;
      if (!isJsonObject(data)) continue;
      // An imported sheet whose snapshot was later saved is the SAME setup — it was
      // listing twice, once under each name. The saved row wins: it carries the name
      // the driver chose.
      if (sheet.baselineSetupSnapshotId && savedIds.has(sheet.baselineSetupSnapshotId)) continue;
      push(
        `sheet-${sheet.id}`,
        "sheet",
        "setups",
        sheet.originalFilename?.replace(/\.(pdf|jpe?g|png|webp)$/i, "").trim() || "Downloaded setup",
        sheet.documentSetupTemplate?.trim() || "Imported sheet",
        // Relative, like every other row — this one used to be a bare locale date.
        sheet.createdAt ? formatRunCreatedRelativeWhen(sheet.createdAt) : "",
        data
      );
    }
    setPickerSources(entries);
    setPickerLoading(false);
    pickerFetching.current = false;
  };

  const openPicker = () => {
    if (!pickerOpenedRef.current) {
      pickerOpenedRef.current = true;
      // Refetch on each fresh open: a run logged since the Lab loaded should be here.
      void loadPickerSources();
    }
    setPickerOpen(true);
  };

  const closePicker = () => {
    pickerOpenedRef.current = false;
    setPickerOpen(false);
    setPickerQuery("");
  };

  /** How many rows each source holds before the search box narrows anything. */
  const pickerPoolCounts = useMemo(() => {
    const counts: Record<PickerSource, number> = { mine: 0, teammates: 0, setups: 0 };
    for (const e of pickerSources ?? []) counts[e.source] += 1;
    return counts;
  }, [pickerSources]);

  /** Filtered rows per source, each capped on its own, with the pre-cap total. */
  const pickerBuckets = useMemo(() => {
    const tokens = pickerQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Record<PickerSource, { rows: SetupPickerEntry[]; total: number }> = {
      mine: { rows: [], total: 0 },
      teammates: { rows: [], total: 0 },
      setups: { rows: [], total: 0 },
    };
    for (const e of pickerSources ?? []) {
      if (tokens.length) {
        const hay = `${e.title} ${e.detail} ${e.when} ${e.kind}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      const bucket = out[e.source];
      bucket.total += 1;
      if (bucket.rows.length < PICKER_ROWS_PER_SOURCE) bucket.rows.push(e);
    }
    return out;
  }, [pickerSources, pickerQuery]);

  /**
   * A source with nothing in it hides — except Teammates, which stays with an empty
   * state, because "I have no teammates" and "this app has no teams" must not look
   * the same. Availability reads the unfiltered pool so tabs don't flicker as you type.
   */
  const pickerTabs: PickerSource[] = ["mine", "teammates", "setups"].filter(
    (s) => s === "teammates" || pickerPoolCounts[s as PickerSource] > 0
  ) as PickerSource[];
  const activeTab: PickerSource = pickerTabs.includes(pickerTab) ? pickerTab : pickerTabs[0] ?? "mine";
  const activeBucket = pickerBuckets[activeTab];

  /**
   * Keep the URL shareable: mirror slot A (`s`/`sl`) and slot B (`g`/`gl`) into the query string.
   *
   * The chassis and the source ride inside the encoded blob, so reloading or sharing a Lab URL keeps
   * the sheet drawable and the save door open — without either, a refresh would silently drop the
   * driver back to sliders on the setup they were just editing.
   */
  const syncUrl = (slotId: SlotId, slot: Slot | null) => {
    try {
      const url = new URL(window.location.href);
      const fieldsParam = slotId === "a" ? "s" : "g";
      const labelParam = slotId === "a" ? "sl" : "gl";
      if (slot) {
        url.searchParams.set(
          fieldsParam,
          encodeLabSlot({
            fields: slot.fields,
            setupSheetModelId: slot.setupSheetModelId,
            source: slot.source,
          })
        );
        if (slot.label) url.searchParams.set(labelParam, slot.label.slice(0, 60));
        else url.searchParams.delete(labelParam);
      } else {
        url.searchParams.delete(fieldsParam);
        url.searchParams.delete(labelParam);
      }
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* best-effort — Lab state itself is unaffected */
    }
  };

  const setSlot = (slotId: SlotId, slot: Slot | null) => {
    setSlots((s) => (slotId === "a" ? { ...s, a: slot ?? s.a } : { ...s, b: slot }));
    syncUrl(slotId, slot);
  };

  const loadEntryIntoSlot = (slotId: SlotId, entry: SetupPickerEntry) => {
    setSlot(
      slotId,
      slotFromFields(entry.fields, entry.label, {
        setupSheetModelId: entry.setupSheetModelId,
        source: entry.labSource,
        fullData: entry.fullData,
        write: entry.write,
      })
    );
  };

  /** Main row tap: load into the selected slot and close the picker. */
  const loadEntry = (entry: SetupPickerEntry) => {
    loadEntryIntoSlot(activeId, entry);
    closePicker();
  };

  /** "vs" tap: load into the other slot (starts the comparison); picker stays open. */
  const loadEntryAsComparison = (entry: SetupPickerEntry) => {
    loadEntryIntoSlot(otherId, entry);
  };

  /** Freeze the current what-if into B (the old "Set ghost = current", unified into slots). */
  const freezeCurrentToB = () => {
    setSlot("b", {
      fields: { ...active.fields },
      loaded: { ...active.fields },
      label: active.label ? `${active.label} · copy` : "What-if copy",
      /*
       * The chassis and the full sheet come along so the frozen copy still draws as paper. What does
       * NOT come along is anywhere to save it: this is a what-if the driver made up, and writing it
       * back to the row the original came from would put unsaved fiddling into a stored setup.
       */
      setupSheetModelId: active.setupSheetModelId,
      source: null,
      fullData: active.fullData,
      write: null,
      sheetDirty: false,
    });
  };

  const clearSlotB = () => {
    setSel("a");
    setSlot("b", null);
  };

  /**
   * Back to the blank car (founder pin on `/tools`, 2026-08-19).
   *
   * B could always be cleared and A never could, so a driver who arrived with a setup seeded —
   * which is every door into the Lab except the two empty-state links — had no way to reach the
   * no-shim car the Lab starts from. The calculator existed and was unreachable.
   *
   * Not `setSlot("a", …)`: that guard turns a null into "keep what's there" (right, A must always
   * hold a car) and would otherwise write the blank car's own fields back into `s`. Blank is the
   * absence of a seed, so the params come off instead and a refresh lands blank too.
   */
  const clearSlotA = () => {
    setSlots((s) => ({ ...s, a: blankSlot() }));
    syncUrl("a", null);
  };

  const fields = active.fields;
  /*
   * Which car this is, and — when the answer is "we don't know" — the teaching model instead of
   * somebody else's hardpoints. `resolveLabPack` never returns null, so the Lab always draws.
   */
  const pack = useMemo(() => resolveLabPack(fields as Record<string, unknown>), [fields]);
  /** No measurements behind the drawing: everything that leaves the Lab is sealed off below. */
  const sandbox = pack.isTeachingModel === true;
  const inputs = useMemo(
    () => deriveRollCenterInputs(fields as Record<string, unknown>, pack),
    [fields, pack]
  );
  const computed = useMemo(
    () => computeRollCenterFromSnapshot(fields as Record<string, unknown>, pack),
    [fields, pack]
  );
  const otherFields = other?.fields ?? null;
  const otherPack = useMemo(
    () => (otherFields ? resolveLabPack(otherFields as Record<string, unknown>) : null),
    [otherFields]
  );
  const otherInputs = useMemo(
    () =>
      otherFields ? deriveRollCenterInputs(otherFields as Record<string, unknown>, otherPack) : null,
    [otherFields, otherPack]
  );
  const otherComputed = useMemo(
    () =>
      otherFields
        ? computeRollCenterFromSnapshot(otherFields as Record<string, unknown>, otherPack)
        : null,
    [otherFields, otherPack]
  );
  // Delta chips only exist against the other slot — never vs the blank car.
  const compareComputed = comparing ? otherComputed : null;

  const geo = inputs ? inputs.pack[axle] : null;
  const adj = inputs ? (axle === "front" ? inputs.frontAdj : inputs.rearAdj) : null;
  const ghostGeo = comparing && otherInputs ? otherInputs.pack[axle] : null;
  const ghostAdj = comparing && otherInputs ? (axle === "front" ? otherInputs.frontAdj : otherInputs.rearAdj) : null;

  /**
   * The axle's own ride height, and therefore the bump slider's travel: down to 0 (chassis
   * on the deck) and up to twice static. Same expression the ride-height slider reads.
   */
  const rideHeightKey: GeometrySheetKey = axle === "front" ? "ride_height_front" : "ride_height_rear";
  const staticRh = parseNum(fields[rideHeightKey]) ?? (axle === "front" ? 5.0 : 5.2);

  // Ride-height edits and axle toggles change what the travel limits are; keep the pose inside them.
  useEffect(() => {
    setBumpMm((b) => Math.min(staticRh, Math.max(-staticRh, b)));
  }, [staticRh]);

  const solved = useMemo(
    () => (geo && adj ? solveAxle(geo, adj, rollDeg, bumpMm) : null),
    [geo, adj, rollDeg, bumpMm]
  );
  const ghostSolved = useMemo(
    () => (ghostGeo && ghostAdj ? solveAxle(ghostGeo, ghostAdj, rollDeg, bumpMm) : null),
    [ghostGeo, ghostAdj, rollDeg, bumpMm]
  );

  /**
   * Camber gain at the pose the sliders are actually holding, read off the OUTSIDE wheel and
   * measured AGAINST THE CHASSIS.
   *
   * The roll slider only travels positive, and positive roll drops the left mounts (measured on
   * the A800 pack: left inner-lower 9.45mm at rest → 8.92mm at 3°), so the left side is the
   * loaded one and `left` is the outside wheel for every value the slider can hold. At exactly
   * 0° the car is symmetric and the choice costs nothing.
   *
   * The engine solves camber against the GROUND, which on a touring car is nearly all body lean:
   * roll 3° and the outside front swings from −1.78° to +1.07° against the road, a +0.96°/°
   * reading that says little beyond "the car leaned over". Founder's call, made twice — once in
   * the interview and again after seeing both numbers on screen: what earns the row is what the
   * GEOMETRY generates, so the lean comes back out. On the LEFT wheel the chassis frame is the
   * world frame turned by +roll, so subtracting the roll angle is the entire conversion (it would
   * be +roll on the right). What survives is about −0.04°/° — small, because long arms move the
   * wheel very little over the travel roll produces — and negative in the same direction as the
   * bump row, so the two rows finally read the same way round.
   *
   * Both numbers are slopes, not totals — a central difference either side of where the sliders
   * sit, which is why they keep moving as you drag: camber gain is not a constant, it falls away
   * as the arms go over centre. Bump is per mm of COMPRESSION, the sign convention
   * `computeAxleMetrics` already publishes on the run-page geometry strip; the roll subtraction is
   * a constant at any fixed roll, so it cancels out of the bump slope entirely.
   */
  const camberGain = useMemo(() => {
    if (!geo || !adj) return null;
    const camberVsChassis = (roll: number, bump: number) => {
      const vsRoad = solveAxle(geo, adj, roll, bump)?.left.camberDeg;
      return vsRoad == null ? null : vsRoad - roll;
    };
    const H = 0.5;
    const rollUp = camberVsChassis(rollDeg + H, bumpMm);
    const rollDown = camberVsChassis(rollDeg - H, bumpMm);
    const bumpIn = camberVsChassis(rollDeg, bumpMm - H);
    const bumpOut = camberVsChassis(rollDeg, bumpMm + H);
    return {
      perRollDeg: rollUp != null && rollDown != null ? (rollUp - rollDown) / (2 * H) : null,
      perBumpMm: bumpIn != null && bumpOut != null ? (bumpIn - bumpOut) / (2 * H) : null,
    };
  }, [geo, adj, rollDeg, bumpMm]);

  /**
   * Both ends of the bump travel, folded into the extents but never drawn. Without this the
   * frame mounts rise and fall out of the derived viewBox and the whole drawing rescales
   * under the slider — the tyres are pinned to the ground, the chassis is not.
   */
  const bumpExtent = useMemo(() => {
    const pts: Vec2[] = [];
    const ends: [typeof geo, typeof adj][] = [
      [geo, adj],
      [ghostGeo, ghostAdj],
    ];
    for (const [g, a] of ends) {
      if (!g || !a) continue;
      for (const b of [-staticRh, staticRh]) {
        const s = solveAxle(g, a, 0, b);
        if (!s) continue;
        pts.push(s.left.innerUpper, s.right.innerUpper, s.left.innerLower, s.right.innerLower);
        if (s.rollCentre) pts.push(s.rollCentre);
      }
    }
    return pts;
  }, [geo, adj, ghostGeo, ghostAdj, staticRh]);

  /**
   * Bump extremes only, so the bump slider never rescales the view. A roll-centre sweep used to
   * be folded in here too — an attempt to hold the frame still against a roll centre that was
   * allowed to set the frame's floor. The schematic no longer lets RC touch the extents at all
   * (fixed window, marker pinned), so feeding a sweep back in would only re-introduce the drift.
   */
  const schematicExtraPoints = useMemo(() => bumpExtent, [bumpExtent]);

  const sensitivities = useMemo(() => {
    if (!geo || !adj) return null;
    const base = computeAxleMetrics(geo, adj);
    if (!base) return null;
    return SENSITIVITY_SLIDERS.map(({ label, teaching, adjKey }) => {
      const m = computeAxleMetrics(geo, { ...adj, [adjKey]: adj[adjKey] + 1 });
      return { label: sandbox ? teaching : label, perMm: m ? m.rcHeightMm - base.rcHeightMm : null };
    });
  }, [geo, adj, sandbox]);

  /**
   * The chassis plate under the drawing, and the ride height it finally makes visible.
   *
   * Width is drawn and never solved, so a pack that has never had one measured costs a dashed
   * outline and not one changed number. Thickness is the pack's BASE plate — `chassisPlateCorners`
   * adds the datum shift itself, which is how a thicker chassis reads as a thicker plate rather
   * than as a raised car.
   */
  const chassisPlate = useMemo<ChassisPlate | null>(() => {
    if (!geo || !adj) return null;
    const halfWidth = pack.chassisHalfWidthMm ?? DEFAULT_CHASSIS_HALF_WIDTH_MM;
    const baseThickness = pack.chassisOptions[pack.baseChassisCode]?.thicknessMm ?? 2;
    /*
     * Inboard of the plate edge, clear of the arms above and the roll-centre marker below.
     *
     * The inset is a SHARE of the plate, not a flat 15mm. A flat 15mm was written for a wide
     * plate and quietly broke on a narrow one: the A800 declares a 22mm half-width, which put the
     * dimension 7mm from the centreline — on top of the dashed centreline and running its label
     * under the RC readout. Capping at 15mm means a wide plate (the 45mm teaching car) lands
     * exactly where it always did.
     */
    const rideAtX = -(halfWidth - Math.min(15, halfWidth * 0.35));
    const rideTop = chassisBottomAt(geo, adj, rideAtX, rollDeg, bumpMm);
    return {
      corners: chassisPlateCorners(geo, adj, halfWidth, baseThickness, rollDeg, bumpMm),
      rideTop,
      rideAtX,
      rideHeightMm: rideTop.z,
      measured: pack.chassisHalfWidthMm != null,
    };
  }, [geo, adj, pack, rollDeg, bumpMm]);

  const updateActiveSlot = (update: (slot: Slot) => Slot) => {
    setSlots((s) =>
      activeId === "a" ? { ...s, a: update(s.a) } : s.b ? { ...s, b: update(s.b) } : s
    );
  };

  const setSlider = (keys: GeometrySheetKey[], value: string) => {
    updateActiveSlot((slot) => {
      const next = { ...slot.fields };
      for (const k of keys) next[k] = value;
      return { ...slot, fields: next };
    });
  };

  /**
   * A box edit on the sheet, folded into the selected slot.
   *
   * Both halves are kept: the geometry slice drives the solve and the sliders, and the full stored
   * setup replaces what the slot is holding — so a later save writes the sheet the driver actually
   * edited rather than nineteen keys over the top of a stale snapshot.
   */
  const applySheetEdit = useCallback(
    (next: { fields: LabFields; fullData: Record<string, unknown> }) => {
      updateActiveSlot((slot) => ({
        ...slot,
        // Blank box means "not recorded", which is the doctrine's assumed-zero, not a stored value.
        fields: { ...LAB_DEFAULT_FIELDS, ...next.fields },
        fullData: next.fullData,
        sheetDirty: true,
      }));
    },
    // `updateActiveSlot` closes over `activeId`, which is the only thing that changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId]
  );

  const sliderValue = (keys: GeometrySheetKey[]): { value: number; legsDiffer: boolean } => {
    const nums = keys.map((k) => parseNum(fields[k]) ?? 0);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { value: Math.round(mean * 100) / 100, legsDiffer: nums.length > 1 && Math.abs(nums[0] - nums[1]) > 1e-9 };
  };

  const chassisCode = useMemo(() => {
    const raw = (fields.chassis ?? "").toUpperCase();
    if (!inputs) return null;
    const codes = Object.keys(inputs.pack.chassisOptions).sort((a, b) => b.length - a.length);
    for (const code of codes) if (raw.includes(code.toUpperCase())) return code;
    if (/CARBON/.test(raw)) return "C01B-RC";
    if (/ALU/.test(raw)) return "C01B-RAF";
    if (/STEEL/.test(raw)) return "C01RS";
    if (/TITAN/.test(raw)) return "TITANIUM";
    return inputs.pack.baseChassisCode;
  }, [fields.chassis, inputs]);

  // Compare mode: diff other → selected. Single mode: edits vs the loaded sheet
  // (a blank-car session has no list — the no-shim default is not a baseline).
  const changes = useMemo(() => {
    if (comparing && otherFields) return labChangeList(fields, otherFields);
    if (active.loaded) return labChangeList(fields, active.loaded);
    return [];
  }, [comparing, otherFields, fields, active.loaded]);

  /**
   * The selected slot's whole setup, with this session's geometry edits merged in.
   *
   * Merges the CHANGED keys only, over the stored snapshot — not the geometry slice over the top.
   * Two reasons. A slice written as the setup would erase the ~260 boxes it says nothing about. And
   * the slice is flattened for the URL: `chassis` travels as text, while storage holds it as a
   * preset object, so re-writing an untouched chassis would turn a real value into its own JSON.
   * Only what the driver actually moved gets written, which sidesteps both.
   */
  const mergedSaveData = useMemo(() => {
    if (!active.fullData) return null;
    const changed: Record<string, string> = {};
    for (const key of GEOMETRY_SHEET_KEYS) {
      const now = (active.fields[key] ?? "").trim();
      const before = (active.loaded?.[key] ?? "").trim();
      if (now !== before) changed[key] = now;
    }
    return { data: { ...active.fullData, ...changed }, changedCount: Object.keys(changed).length };
  }, [active.fullData, active.fields, active.loaded]);

  /** `/runs/new` reads this back through the same codec — the universal exit, needing no stored row. */
  const nextRunHref = `/runs/new?labSetup=${encodeLabFields(fields)}`;

  const runSave = async () => {
    if (!active.write || !mergedSaveData) return;
    setSaving(true);
    setSaveMsg(null);
    const result = await saveLabSlot(active.write, mergedSaveData.data);
    setSaving(false);
    if (result.ok) {
      // The edits are now the stored state, so "changes vs loaded" has to start counting again.
      updateActiveSlot((slot) => ({ ...slot, loaded: { ...slot.fields }, sheetDirty: false }));
      setSaveMsg(active.write.kind === "run" ? "Run corrected." : "Saved to this setup.");
    } else {
      setSaveMsg(result.error);
    }
  };

  const copyChanges = async () => {
    const text = changes.length > 0 ? changes.join("\n") : "no geometry changes";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the list is visible on screen anyway */
    }
  };

  /* ── Setups card (slot chips + picker) ── */
  const setupsCard = (
    <CardPanel className="lab-setups" contentClassName="space-y-2">
      <Eyebrow>Setups</Eyebrow>
      <div className="flex items-center gap-2">
        <SlotChip
          id="a"
          slot={slots.a}
          selected={activeId === "a"}
          onSelect={() => setSel("a")}
          /* Only once there's a setup in it — the blank car has nothing to clear, and an ✕
             that does nothing reads as broken. `loaded` is the tell: it's null on blank. */
          onClear={slots.a.loaded ? clearSlotA : undefined}
        />
        {slots.b ? (
          <SlotChip
            id="b"
            slot={slots.b}
            selected={activeId === "b"}
            onSelect={() => setSel("b")}
            onClear={clearSlotB}
          />
        ) : (
          <button
            type="button"
            onClick={freezeCurrentToB}
            title="Copy the current what-if into slot B, then tweak A against it"
            className="tap-active flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary-ink/40 hover:text-foreground"
          >
            + Compare current…
          </button>
        )}
      </div>
      <input
        type="search"
        value={pickerQuery}
        placeholder={`Search setups → load into ${activeId.toUpperCase()}…`}
        onFocus={openPicker}
        onClick={openPicker}
        onChange={(e) => {
          setPickerQuery(e.target.value);
          openPicker();
        }}
        aria-label="Search your runs, teammate runs, and saved setups"
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {pickerOpen && (
        <div className="space-y-1.5">
          {pickerTabs.length > 1 && (
            <SegmentedControl
              size="sm"
              ariaLabel="Setup source"
              value={activeTab}
              onChange={setPickerTab}
              segmentClassName="px-2 py-1 text-[11px]"
              options={pickerTabs.map((s) => ({
                value: s,
                ariaLabel: PICKER_SOURCE_LABEL[s],
                label: (
                  <span className="flex items-baseline gap-1">
                    {PICKER_SOURCE_LABEL[s]}
                    {pickerBuckets[s].total > 0 && (
                      <span className="text-[9px] tabular-nums opacity-60">
                        {pickerBuckets[s].total}
                      </span>
                    )}
                  </span>
                ),
              }))}
            />
          )}
          {pickerLoading && !pickerSources && (
            <p className="text-xs text-muted-foreground">Loading your setups…</p>
          )}
          {pickerError && !pickerSources && (
            <p className="text-xs text-muted-foreground">{pickerError}</p>
          )}
          {pickerSources && activeBucket.rows.length === 0 && (
            <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
              {/* The Teams nudge only makes sense to someone who already has setups of
                  their own. To a brand-new account with nothing, "no teammates" is not
                  the problem, so they get the plain line. */}
              {activeTab === "teammates" &&
              pickerPoolCounts.teammates === 0 &&
              pickerPoolCounts.mine + pickerPoolCounts.setups > 0 ? (
                <>
                  No teammates are sharing runs yet. Set up a team and their setups show up here —{" "}
                  <Link href="/teams" className="text-primary-ink underline underline-offset-2">
                    Teams
                  </Link>
                  .
                </>
              ) : (
                "No matching setups with computable geometry."
              )}
            </p>
          )}
          <ul className="max-h-[420px] space-y-0.5 overflow-y-auto">
            {activeBucket.rows.map((entry) => (
              <li key={entry.id} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => loadEntry(entry)}
                  title={`Load into setup ${activeId.toUpperCase()}`}
                  className="grid min-w-0 flex-1 grid-cols-[2.1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
                >
                  <span className="pt-0.5 micro-caps text-faint">
                    {entry.kind}
                  </span>
                  {/* break-words, not truncate: a filename-shaped setup name is one
                      unbreakable token and would otherwise paint over the date column. */}
                  <span className="min-w-0">
                    <span className="block break-words text-xs leading-snug">{entry.title}</span>
                    {entry.detail && (
                      <span className="block break-words tabular-nums text-[10px] leading-snug text-muted-foreground">
                        {entry.detail}
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap pt-0.5 text-right text-[10px] tabular-nums text-faint">
                    {entry.when}
                    {/* Marked, not hidden. A row with no measurements still loads — it just opens
                        the teaching model rather than pretending to be this car. */}
                    {!entry.hasGeometry && (
                      <span className="block normal-nums text-[9px] leading-tight">
                        no measurements
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => loadEntryAsComparison(entry)}
                  title={`Load into setup ${otherId.toUpperCase()} as the comparison`}
                  className="shrink-0 self-center rounded-md border border-border px-1.5 py-1 micro-caps text-muted-foreground transition hover:text-foreground"
                >
                  vs
                </button>
              </li>
            ))}
          </ul>
          {activeBucket.rows.length < activeBucket.total && (
            <p className="px-2 tabular-nums text-[10px] text-faint">
              Showing {activeBucket.rows.length} of {activeBucket.total} — search to narrow
            </p>
          )}
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
            onClick={closePicker}
          >
            Close
          </button>
        </div>
      )}
      {!comparing && !slots.a.loaded && !pickerOpen && (
        <p className="text-[10px] leading-relaxed text-faint">
          Blank no-shim car — play freely, or load a setup to see your real geometry.
        </p>
      )}
    </CardPanel>
  );

  if (!inputs || !computed) {
    return (
      <div className="flex flex-col gap-3">
        {setupsCard}
        <CardPanel contentClassName="space-y-3 text-sm text-muted-foreground">
          <p>This setup doesn&apos;t match a supported platform pack (Awesomatix A800R/RR today).</p>
          <Button
            variant="outline"
            onClick={() =>
              updateActiveSlot(() => blankSlot())
            }
          >
            Reset {activeId.toUpperCase()} to A800 baseline
          </Button>
        </CardPanel>
      </div>
    );
  }

  /*
   * "At rest" needs a tolerance, not ===: bump is stored as (slider − staticRh) and the roll
   * animation integrates real time, so both land on values like 1e-15 rather than a clean 0.
   * Each axis resets on its own, so each knows separately whether it has anything to undo.
   */
  const rollAtRest = Math.abs(rollDeg) < 1e-9;
  const bumpAtRest = Math.abs(bumpMm) < 1e-9;

  const rcAtRoll = solved?.rollCentre ?? null;

  const deltaChip = (current: number, base: number | null | undefined, unit: string) => {
    if (base == null) return null;
    const d = current - base;
    if (Math.abs(d) < 0.05) return null;
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {d > 0 ? "↑" : "↓"} {Math.abs(d).toFixed(1)}
        {unit}
      </span>
    );
  };

  /*
   * Phone: one column, in this source order. Desktop (xl+): the same DOM re-flowed
   * into an instrument — controls on the left, the drawing and its readout in the
   * middle, the slower reading (camber gain, sensitivities, change list) beneath at
   * xl and beside at 2xl. The columns are placed EXPLICITLY (`col-start`/`row-start`)
   * rather than by source order, because the desktop order is not the phone order:
   * on a phone you meet the drawing before the sliders, on a desktop the sliders are the
   * hand you keep on the tool.
   *
   * The desktop geometry itself lives in globals.css under `.lab-grid`, not in
   * utilities here, for the reason `.dash-wide` and `.engineer-wide` exist: a
   * three-column rule at 1400px has to beat the two-column rule at 1280px, and
   * Tailwind 4 sorts an arbitrary `min-[1400px]:` variant BEFORE the named `xl:`
   * — so the utility version silently rendered two columns at every width (class
   * present in the DOM, layout unchanged). Unlayered CSS wins outright. These
   * class names are the hooks it places; nothing below 1280px reads them, so
   * 390px is byte-identical (docs/VISUAL_NORTH_STAR.md).
   */
  return (
    <div className="lab-grid flex flex-col gap-3">
      {/* ── Setups (A/B slots + picker) ────────────────────────────── */}
      {setupsCard}

      {/* ── The instrument ─────────────────────────────────────────── */}
      <CardPanel className="lab-instrument" contentClassName="space-y-3">
        <Eyebrow>Roll centre</Eyebrow>
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            className="max-w-[200px]"
            ariaLabel="Axle"
            options={[
              { value: "front", label: "Front" },
              { value: "rear", label: "Rear" },
            ]}
            value={axle}
            onChange={setAxle}
          />
          <span
            className={cn(
              "ml-auto micro-caps rounded border px-1.5 py-0.5",
              sandbox
                ? "border-foreground/40 text-foreground"
                : "border-border text-faint"
            )}
            title={
              sandbox
                ? "Not a real car — invented numbers you can learn the directions on"
                : "Trust grade for absolute values; deltas are exact regardless"
            }
          >
            {sandbox ? "sandbox" : computed.verificationGrade}
          </span>
        </div>

        {/*
         * The honest gap, said out loud on the one surface where a driver would otherwise assume
         * the numbers are theirs. Two wordings, because "we don't have YOUR car" and "you opened
         * a toy with no car at all" are different facts and only one of them is a gap to fill.
         */}
        {sandbox && (
          <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-[11px] leading-relaxed text-faint">
            {active.source || active.setupSheetModelId ? (
              <>
                We don&rsquo;t have measured hardpoints for this car yet, so this is the{" "}
                <span className="text-foreground">teaching model</span> — not your chassis.{" "}
              </>
            ) : (
              <>
                A <span className="text-foreground">teaching model</span>, not a car anyone races —
                built to what every 1/10 touring car shares, with the mount heights chosen round.{" "}
              </>
            )}
            Which way each shim moves the roll centre, and roughly how far, holds for any
            double-wishbone touring car. The exact millimetre isn&rsquo;t yours.
          </p>
        )}

        {/*
         * Phone: a 12:5 letterbox, so the drawing is a fixed slice of a 390px column.
         * Desktop: capped by HEIGHT instead. At a 1000px-wide centre track the 12:5
         * box would be 415px tall and push the roll-centre numbers off the bottom of
         * the screen — which is the one thing this layout exists to prevent. `vh` so
         * a short laptop screen gets a shorter drawing rather than a scrollbar.
         * `AxleSchematic` is `h-full w-full` on a viewBox with the default
         * `xMidYMid meet`, so it just letterboxes centred in whatever box it is given.
         */}
        {solved && (
          <div className="aspect-[12/5] w-full xl:aspect-auto xl:h-[min(40vh,24rem)]">
            <AxleSchematic
              solved={solved}
              ghost={ghostSolved}
              chassis={chassisPlate}
              extraPoints={schematicExtraPoints}
              fitBox
              axleLabel={axle}
              showCamber
              className="text-foreground"
            />
          </div>
        )}
        {comparing && (
          <p className="truncate text-right micro-caps text-faint">
            solid = {activeId} · dashed = {otherId}
          </p>
        )}

        {/*
         * Pose controls — roll and bump stack, and neither touches the stored setup. The header
         * deliberately mirrors "Adjustments · front" below, reset and all: two labelled sections
         * with their own reset is what tells a driver which sliders change the car and which
         * only change how it is standing.
         */}
        <Eyebrow>Pose</Eyebrow>

        <div className="flex items-center gap-2">
          <span className="type-data-label w-[2.5rem] shrink-0">Roll</span>
          <input
            type="range"
            min={0}
            max={ROLL_MAX_DEG}
            step={0.05}
            value={rollDeg}
            onChange={(e) => setRollDeg(Number(e.target.value))}
            aria-label="Chassis roll angle (degrees)"
            className="min-w-0 flex-1 accent-primary"
          />
          <button
            type="button"
            disabled={rollAtRest}
            onClick={() => setRollDeg(0)}
            aria-label="Reset roll"
            className={POSE_ICON_BUTTON}
          >
            <RotateCcw aria-hidden className="size-[11px]" strokeWidth={2.4} />
          </button>
          <span className="w-[7.5rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {rollDeg.toFixed(1)}° · RC {rcAtRoll ? `${fmtMm(rcAtRoll.z)}/${fmtMm(rcAtRoll.x, 0)}` : "—"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="type-data-label w-[2.5rem] shrink-0">Bump</span>
          <input
            type="range"
            min={0}
            max={2 * staticRh}
            step={0.1}
            value={staticRh + bumpMm}
            onChange={(e) => setBumpMm(Number(e.target.value) - staticRh)}
            aria-label="Chassis bump — ride height in millimetres"
            className="min-w-0 flex-1 accent-primary"
          />
          <button
            type="button"
            disabled={bumpAtRest}
            onClick={() => setBumpMm(0)}
            aria-label="Reset bump"
            className={POSE_ICON_BUTTON}
          >
            <RotateCcw aria-hidden className="size-[11px]" strokeWidth={2.4} />
          </button>
          <span className="w-[7.5rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            RH {(staticRh + bumpMm).toFixed(1)}mm ({bumpMm >= 0 ? "+" : ""}
            {bumpMm.toFixed(1)})
          </span>
        </div>

        <div className="grid grid-cols-3 gap-x-4">
          {[
            { label: "RC front", value: computed.front.rcHeightMm, base: compareComputed?.front.rcHeightMm },
            { label: "RC rear", value: computed.rear.rcHeightMm, base: compareComputed?.rear.rcHeightMm },
            { label: "Rake", value: computed.rakeMm, base: compareComputed?.rakeMm },
          ].map((s) => (
            <div key={s.label} className="space-y-0.5">
              <div className="type-data-label">{s.label}</div>
                <div className="fig-stat">{fmtMm(s.value)} mm</div>
              {/* Fixed-height slot: chips appearing/vanishing must not reflow the card */}
              <div className="h-4">{deltaChip(s.value, s.base, "")}</div>
            </div>
          ))}
        </div>
      </CardPanel>

      {/* ── Adjustments (edit the selected slot) ───────────────────── */}
      <CardPanel className="lab-adjust" contentClassName="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>
            Adjustments · {axle}
            {comparing ? ` · ${activeId.toUpperCase()}` : ""}
          </Eyebrow>
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition"
            onClick={() =>
              updateActiveSlot((slot) => ({
                ...slot,
                fields: slot.loaded ? { ...slot.loaded } : { ...LAB_DEFAULT_FIELDS },
              }))
            }
          >
            {active.loaded ? "Reset to loaded" : "Reset to blank"}
          </button>
        </div>

        {/*
         * Two ways in, one state. The sliders stay the default because they are the fast surface: four
         * sliders beat panning a page picture to find one box, which is what a driver is doing
         * between runs. The sheet appears only when this slot came from a real setup on a chassis the
         * app can draw — without the whole snapshot behind it the paper would render mostly empty.
         *
         * Mutually exclusive on purpose. The fill surface reads its values once and then owns them
         * (see `LabSheetPane`), so a slider moved while the sheet was on screen could not reach it;
         * switching modes remounts the sheet and re-seeds it, which makes that impossible to hit.
         */}
        {sheetAvailable && (
          <SegmentedControl
            size="sm"
            ariaLabel="How to adjust this setup"
            options={[
              { value: "sliders", label: "Sliders" },
              { value: "sheet", label: "Sheet" },
            ]}
            value={inputMode}
            onChange={(v) => setInputMode(v as "sliders" | "sheet")}
          />
        )}

        {sheetMode ? (
          <p className="ui-caption">
            Your sheet is below — type a stack into any box and the geometry moves with it.
          </p>
        ) : null}

        {/*
         * One row while the two legs agree; two rows the moment they don't.
         *
         * The inner shim keys are per-leg — the front and rear pin of the same arm — and a car often
         * runs them equal, so a single slider is the honest control for the common case. When they are
         * NOT equal, one slider cannot represent them: it used to show the mean and write that mean
         * into both legs, quietly flattening a real difference on the first touch. Splitting is what
         * makes the Lab safe to save from, and it keeps the per-leg data the side-view model wants.
         *
         * The front view still solves on the mean of the two (`legMean` in computeFromSnapshot) —
         * this is about not destroying what was stored, not about changing the geometry.
         */}
        {!sheetMode &&
          AXLE_SLIDERS[axle].flatMap((slider) => {
            const { value, legsDiffer } = sliderValue(slider.keys);
            // The teaching model has no parts to name, so its sliders are named for what they do.
            const sliderLabel = sandbox ? slider.teaching : slider.label;
            if (!legsDiffer) {
              return [
                <SliderRow
                  key={slider.label}
                  label={sliderLabel}
                  value={value}
                  max={slider.max}
                  onChange={(v) => setSlider(slider.keys, v)}
                />,
              ];
            }
            return slider.keys.map((key) => (
              <SliderRow
                key={key}
                label={sliderLabel}
                sublabel={legLabel(key)}
                value={parseNum(fields[key]) ?? 0}
                max={slider.max}
                onChange={(v) => setSlider([key], v)}
              />
            ));
          })}

        {!sheetMode && (
        <SliderRow
          label="Ride height"
          value={staticRh}
          min={4}
          max={7}
          step={0.1}
          onChange={(v) => setSlider([rideHeightKey], v)}
        />
        )}
        {!sheetMode && (
        <SliderRow
          label="Camber (neg °)"
          value={(() => {
            // Sheets record camber as magnitude-of-negative ("2.0" and "-2.0" both = −2°);
            // the slider always shows the magnitude. Unset → the solved link-default camber.
            const raw = parseNum(fields[axle === "front" ? "camber_front" : "camber_rear"]);
            return raw != null
              ? Math.abs(raw)
              : Math.round(Math.abs(computed[axle].camberDeg) * 100) / 100;
          })()}
          min={0}
          max={4}
          step={0.25}
          unit="°"
          onChange={(v) => setSlider([axle === "front" ? "camber_front" : "camber_rear"], v)}
        />
        )}

        {/* Label beside the control from sm, but back above it at xl: the desktop
            Adjustments column is 21rem, and a 9.5rem label leaves the chassis
            options ~148px to share, which clipped the last one off the card.
            Four plates since 2026-08-29, so the rail is tighter again — the label
            above it is what buys them the full column. */}
        {!sheetMode && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 xl:flex-col xl:items-stretch xl:gap-1.5">
          <span className="type-data-label shrink-0 sm:w-[9.5rem] xl:w-auto">Chassis</span>
          <SegmentedControl
            size="sm"
            className="sm:flex-1"
            ariaLabel="Chassis plate"
            options={Object.entries(inputs.pack.chassisOptions).map(([code, o]) => ({
              value: code,
              label: o.label,
            }))}
            value={chassisCode ?? inputs.pack.baseChassisCode}
            onChange={(code) => setSlider(["chassis"], code)}
          />
        </div>
        )}
      </CardPanel>

      {/* The sheet itself — a full-width row, because a page picture cannot live in a 21rem column. */}
      {sheetMode && active.setupSheetModelId && active.fullData && (
        <CardPanel className="lab-sheet" contentClassName="space-y-2">
          {/* Setup names run long ("A800RR_Caruso_Bayside_Starting…"), and this one is a whole
              heading rather than a chip — without the clamp it runs off the card at 390px. */}
          <Eyebrow className="min-w-0 [&>span]:truncate">
            {activeName} · sheet
            {comparing ? ` · ${activeId.toUpperCase()}` : ""}
          </Eyebrow>
          <LabSheetPane
            /* Remount when the slot or its chassis changes: the surface seeds its values once, so a
               new setup has to arrive as a new surface or it would keep drawing the old one. */
            key={`${activeId}-${active.setupSheetModelId}`}
            setupSheetModelId={active.setupSheetModelId}
            values={active.fullData}
            onChange={applySheetEdit}
          />
        </CardPanel>
      )}

      {/*
       * The slower reading. `display: contents` on a phone, so these two cards stay
       * direct children of the flex column and the `gap-3` between them is untouched;
       * at xl `.lab-aside` gives the wrapper a real box so both travel together —
       * under the drawing while there are only two columns, beside it once there
       * are three.
       */}
      <div className="lab-aside contents">
        {/* ── Camber gain + sensitivities ──────────────────────────────── */}
        <CardPanel contentClassName="space-y-3">
          <Eyebrow>Camber gain · {axle}</Eyebrow>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-data-label">In roll (outside)</span>
              <span className="text-[11px] tabular-nums">
                {camberGain?.perRollDeg != null ? `${fmtMm(camberGain.perRollDeg, 3)}° / ° roll` : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-data-label">In bump (outside)</span>
              <span className="text-[11px] tabular-nums">
                {camberGain?.perBumpMm != null ? `${fmtMm(camberGain.perBumpMm, 3)}° / mm` : "—"}
              </span>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-faint">
            Outside wheel measured against the chassis, at the pose the sliders are holding — the
            camber your geometry makes, with the body lean taken out. Negative = the wheel is
            leaning further in.
          </p>
          <Eyebrow>Shim sensitivity · {axle}</Eyebrow>
          <div className="space-y-1">
            {sensitivities?.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-2">
                <span className="type-data-label">{s.label}</span>
                <span className="text-[11px] tabular-nums">
                  {s.perMm != null ? `${fmtMm(s.perMm)}mm RC / mm shim` : "—"}
                </span>
              </div>
            ))}
          </div>
        </CardPanel>

        {/* ── Differences ────────────────────────────────────────────── */}
        <CardPanel contentClassName="space-y-3">
          <Eyebrow>{comparing ? "Differences" : "Changes"}</Eyebrow>

          {changes.length > 0 ? (
            <div className="rounded-md border border-border bg-secondary/60 p-2.5">
              <div className="type-data-label mb-1 truncate">
                {comparing ? `${otherName} → ${activeName}` : "Changes vs loaded sheet"}
              </div>
              <ul className="space-y-0.5">
                {changes.map((c) => (
                  <li key={c} className="tabular-nums text-[10px] leading-relaxed text-muted-foreground">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {comparing
                ? "The two setups have identical geometry."
                : active.loaded
                  ? "No edits vs the loaded sheet yet."
                  : "Load a setup — or compare two — to see differences here."}
            </p>
          )}

          {/*
           * The way out. Which door exists is settled by what this slot IS, not by anything the
           * driver picks here: a setup no run points at can be written in place; a run's own record
           * never can, and is corrected by writing a new snapshot and repointing the run. Everything
           * else — a teammate's setup, a frozen what-if, the blank car — leaves through the next run,
           * which needs no stored row at all and so is always offered.
           */}
          <div className="flex flex-wrap items-center gap-2">
            {!sandbox && active.write && mergedSaveData ? (
              <Button
                className="px-3 py-1 text-xs"
                onClick={runSave}
                disabled={saving || (mergedSaveData.changedCount === 0 && !active.sheetDirty)}
              >
                {saving
                  ? "Saving…"
                  : active.write.kind === "run"
                    ? "Correct this run"
                    : "Save to this setup"}
              </Button>
            ) : null}
            {!sandbox && (
              <ButtonLink href={nextRunHref} variant="outline" className="px-3 py-1 text-xs">
                Use for next run
              </ButtonLink>
            )}
            <Button
              variant="outline"
              className="px-3 py-1 text-xs"
              onClick={copyChanges}
              disabled={changes.length === 0}
            >
              {copied ? "Copied" : comparing ? "Copy differences" : "Copy change list"}
            </Button>
          </div>

          {/*
           * Sealed off. Nothing worked out on a car we never measured may become a stored setup, a
           * run prefill, or Engineer context — the directions it teaches are true, the millimetres
           * are not, and only the millimetres would survive the trip out.
           */}
          {sandbox && (
            <p className="ui-caption text-faint">
              Nothing here saves or exports — it isn&rsquo;t your car. Load a setup we have
              measurements for to use these numbers on.
            </p>
          )}

          {saveMsg ? <p className="ui-caption">{saveMsg}</p> : null}

          {computed.assumptions.length > 0 && (
            <p className="text-[10px] leading-relaxed text-faint">
              Assumed: {computed.assumptions.join(" · ")}
            </p>
          )}
        </CardPanel>
      </div>
    </div>
  );
}
