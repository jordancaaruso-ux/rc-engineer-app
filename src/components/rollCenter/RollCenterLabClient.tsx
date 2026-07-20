"use client";

/**
 * Roll Center Lab — the interactive what-if surface (Phase 3,
 * docs/ROLL_CENTER_NORTH_STAR.md). Two setup SLOTS, A and B: fill either from
 * URL seeds (`s`/`g` + `sl`/`gl` labels), the setup picker (own runs ·
 * downloaded sheets · teammate-shared runs), or by freezing the current
 * what-if into B. Tap a slot chip to select it: the selected setup renders
 * solid and drives every value below the diagram; the other renders as the
 * dashed ghost. Knobs edit whichever slot is selected — both stay live.
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

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import { computeAxleMetrics, solveAxle, type AxleAdjustments } from "@/lib/rollCenter/engine";
import {
  computeRollCenterFromSnapshot,
  deriveRollCenterInputs,
} from "@/lib/rollCenter/computeFromSnapshot";
import { resolvePackForSnapshot } from "@/lib/rollCenter/packs";
import {
  LAB_DEFAULT_FIELDS,
  decodeLabFields,
  encodeLabFields,
  extractGeometryFields,
  labChangeList,
  type GeometrySheetKey,
  type LabFields,
} from "@/lib/rollCenter/labState";
import {
  formatRunPickerLine,
  formatRunPickerLineWithDriver,
  formatRunPickerWhenSegment,
  type RunPickerRun,
} from "@/lib/runPickerFormat";

const ROLL_MAX_DEG = 3;

/** One searchable setup source: own run, downloaded sheet, or teammate run. */
type SetupPickerEntry = {
  id: string;
  kind: "run" | "sheet" | "team";
  label: string;
  when: string;
  fields: LabFields;
};

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function fmtMm(v: number, dp = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Per-axle control rows: which sheet keys each knob writes (all legs equalized on edit). */
const AXLE_KNOBS: Record<
  "front" | "rear",
  { label: string; keys: GeometrySheetKey[]; max: number }[]
> = {
  front: [
    { label: "Under lower arm", keys: ["under_lower_arm_shims_ff", "under_lower_arm_shims_fr"], max: 5 },
    { label: "Under hub", keys: ["under_hub_shims_front"], max: 3 },
    { label: "Upper inner", keys: ["upper_inner_shims_ff", "upper_inner_shims_fr"], max: 5 },
    { label: "Upper outer", keys: ["upper_outer_shims_front"], max: 3 },
  ],
  rear: [
    { label: "Under lower arm", keys: ["under_lower_arm_shims_rf", "under_lower_arm_shims_rr"], max: 5 },
    { label: "Under hub", keys: ["under_hub_shims_rear"], max: 3 },
    { label: "Upper inner", keys: ["upper_inner_shims_rf", "upper_inner_shims_rr"], max: 5 },
    { label: "Upper outer", keys: ["upper_outer_shims_rear"], max: 3 },
  ],
};

const SENSITIVITY_KNOBS: { label: string; adjKey: keyof AxleAdjustments }[] = [
  { label: "Under lower arm", adjKey: "underLowerArmMm" },
  { label: "Under hub", adjKey: "underHubMm" },
  { label: "Upper inner", adjKey: "upperInnerMm" },
  { label: "Upper outer", adjKey: "upperOuterMm" },
];

/** One knob row: label + 0.25-detent slider + free-typed mm box (founder rulings). */
function KnobRow({
  label,
  value,
  legsDiffer,
  min = 0,
  max,
  step = 0.25,
  unit = "mm",
  onChange,
}: {
  label: string;
  value: number;
  legsDiffer?: boolean;
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
        {legsDiffer ? <span className="block text-faint normal-case tracking-normal">legs differ · mean shown</span> : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} (${unit})`}
        className="min-w-0 flex-1 accent-primary"
      />
      <input
        type="number"
        inputMode="decimal"
        step={0.05}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} exact value (${unit})`}
        className="w-16 shrink-0 rounded-md border border-border bg-secondary px-1.5 py-1 text-right font-mono text-[11px] tabular-nums"
      />
    </div>
  );
}

/** RC migration path in the front-view plane (same-unit axes: lateral vs height, mm). */
function MigrationPathChart({
  sweep,
  ghostSweep,
  ghostName,
  current,
}: {
  sweep: { roll: number; x: number; z: number }[];
  ghostSweep: { roll: number; x: number; z: number }[] | null;
  ghostName: string | null;
  current: { x: number; z: number } | null;
}) {
  const W = 320;
  const H = 132;
  const PAD = { l: 34, r: 12, t: 10, b: 20 };
  const all = [...sweep, ...(ghostSweep ?? [])];
  if (all.length < 2) return null;
  const xMin = Math.min(...all.map((p) => p.x)) - 2;
  const xMax = Math.max(...all.map((p) => p.x)) + 2;
  const zMin = Math.min(...all.map((p) => p.z)) - 1;
  const zMax = Math.max(...all.map((p) => p.z)) + 1;
  // Quantized coordinates — server/client libm can differ by 1 ulp (hydration).
  const q = (n: number) => Math.round(n * 100) / 100;
  const X = (x: number) => q(PAD.l + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r));
  const Y = (z: number) => q(PAD.t + ((zMax - z) / (zMax - zMin || 1)) * (H - PAD.t - PAD.b));
  const path = (pts: { x: number; z: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)} ${Y(p.z).toFixed(1)}`).join(" ");
  const ticksX = [xMin + 2, (xMin + xMax) / 2, xMax - 2];
  const ticksZ = [zMin + 1, zMax - 1];
  const last = sweep[sweep.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full font-mono"
      role="img"
      aria-label="Roll center migration path under chassis roll"
    >
      {ticksX.map((t, i) => (
        <g key={`tx-${i}`}>
          <line x1={X(t)} y1={PAD.t} x2={X(t)} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.08} />
          <text x={X(t)} y={H - 8} textAnchor="middle" fontSize={7.5} fill="currentColor" fillOpacity={0.45}>
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      {ticksZ.map((t, i) => (
        <g key={`tz-${i}`}>
          <line x1={PAD.l} y1={Y(t)} x2={W - PAD.r} y2={Y(t)} stroke="currentColor" strokeOpacity={0.08} />
          <text x={PAD.l - 4} y={Y(t) + 2.5} textAnchor="end" fontSize={7.5} fill="currentColor" fillOpacity={0.45}>
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize={7.5} fill="currentColor" fillOpacity={0.55}>
        lateral mm
      </text>
      <text x={PAD.l - 4} y={PAD.t + 2} textAnchor="end" fontSize={7.5} fill="currentColor" fillOpacity={0.55}>
        mm
      </text>

      {ghostSweep && ghostSweep.length > 1 && (
        <path d={path(ghostSweep)} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} strokeDasharray="4 3" />
      )}
      <path d={path(sweep)} fill="none" stroke="currentColor" strokeOpacity={0.75} strokeWidth={2} strokeLinecap="round" />

      {/* Whole-degree waypoints + start/end labels */}
      {sweep
        .filter((p) => Math.abs(p.roll - Math.round(p.roll)) < 1e-6)
        .map((p) => (
          <circle key={`wp-${p.roll}`} cx={X(p.x)} cy={Y(p.z)} r={2} fill="currentColor" fillOpacity={0.5} />
        ))}
      <text x={X(sweep[0].x) + 4} y={Y(sweep[0].z) - 4} fontSize={7.5} fill="currentColor" fillOpacity={0.6}>
        0°
      </text>
      <text x={X(last.x) - 4} y={Y(last.z) - 4} textAnchor="end" fontSize={7.5} fill="currentColor" fillOpacity={0.6}>
        {ROLL_MAX_DEG}°
      </text>

      {/* Current-roll RC — the one yellow mark */}
      {current && (
        <g className="text-primary">
          <circle cx={X(current.x)} cy={Y(current.z)} r={4.5} fill="currentColor" />
        </g>
      )}

      {ghostSweep && (
        <text x={W - PAD.r} y={PAD.t + 8} textAnchor="end" fontSize={7.5} fill="currentColor" fillOpacity={0.5}>
          dashed = {ghostName ?? "ghost"}
        </text>
      )}
    </svg>
  );
}

/* ── Setup slots ──────────────────────────────────────────────────────────── */

type SlotId = "a" | "b";

type Slot = {
  fields: LabFields;
  /** The as-loaded state when the slot came from a real setup; null = blank car. */
  loaded: LabFields | null;
  label: string | null;
};

function slotFromFields(rawFields: LabFields, label: string | null): Slot {
  const merged = { ...LAB_DEFAULT_FIELDS, ...rawFields };
  return { fields: merged, loaded: { ...merged }, label };
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
          ? "border-primary/60 bg-secondary"
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
            "shrink-0 rounded border px-1 font-mono text-[9px] uppercase tracking-[0.18em]",
            selected ? "border-primary/60 text-foreground" : "border-border text-faint"
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
    const aDecoded = seed ? decodeLabFields(seed) : null;
    const bDecoded = ghostSeed ? decodeLabFields(ghostSeed) : null;
    return {
      a: aDecoded
        ? slotFromFields(aDecoded, seedLabel ?? null)
        : { fields: { ...LAB_DEFAULT_FIELDS }, loaded: null, label: null },
      b: bDecoded ? slotFromFields(bDecoded, ghostSeedLabel ?? null) : null,
    };
  });
  const [sel, setSel] = useState<SlotId>("a");
  const [axle, setAxle] = useState<"front" | "rear">("front");
  const [rollDeg, setRollDeg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const rollRef = useRef(0);
  rollRef.current = rollDeg;

  // Guard: selection can never point at an empty slot.
  const activeId: SlotId = sel === "b" && slots.b ? "b" : "a";
  const otherId: SlotId = activeId === "a" ? "b" : "a";
  const active = activeId === "b" ? slots.b! : slots.a;
  const other = activeId === "a" ? slots.b : slots.a;
  const comparing = slots.b != null;
  const activeName = slotName(active);
  const otherName = comparing && other ? slotName(other) : null;

  /* ── Setup picker (own runs + downloaded sheets + teammates) ── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSources, setPickerSources] = useState<SetupPickerEntry[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const loadPickerSources = async () => {
    if (pickerSources || pickerLoading) return;
    setPickerLoading(true);
    setPickerError(null);
    const safeJson = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    const [runsRes, docsRes, teamRes] = await Promise.all([
      safeJson("/api/runs/for-picker") as Promise<{ runs?: RunPickerRun[] } | null>,
      safeJson("/api/setup/options") as Promise<{
        downloadedSetups?: { id: string; originalFilename?: string | null; createdAt?: string; setupData?: unknown }[];
      } | null>,
      safeJson("/api/runs/teammate-for-picker") as Promise<{
        runs?: (RunPickerRun & { userId?: string | null })[];
        memberDisplayByUserId?: Record<string, string>;
      } | null>,
    ]);
    if (!runsRes && !docsRes && !teamRes) {
      setPickerError("Couldn't load your setups — check you're signed in.");
      setPickerLoading(false);
      return;
    }
    const entries: SetupPickerEntry[] = [];
    for (const run of runsRes?.runs ?? []) {
      const data = run.setupSnapshot?.data;
      if (!isJsonObject(data) || !resolvePackForSnapshot(data)) continue;
      entries.push({
        id: `run-${run.id}`,
        kind: "run",
        label: formatRunPickerLine(run),
        when: formatRunPickerWhenSegment(run),
        fields: extractGeometryFields(data),
      });
    }
    for (const sheet of docsRes?.downloadedSetups ?? []) {
      const data = sheet.setupData;
      if (!isJsonObject(data) || !resolvePackForSnapshot(data)) continue;
      entries.push({
        id: `sheet-${sheet.id}`,
        kind: "sheet",
        label: sheet.originalFilename?.trim() || "Downloaded setup",
        when: sheet.createdAt ? new Date(sheet.createdAt).toLocaleDateString() : "",
        fields: extractGeometryFields(data),
      });
    }
    for (const run of teamRes?.runs ?? []) {
      const data = run.setupSnapshot?.data;
      if (!isJsonObject(data) || !resolvePackForSnapshot(data)) continue;
      entries.push({
        id: `team-${run.id}`,
        kind: "team",
        label: formatRunPickerLineWithDriver(run, teamRes?.memberDisplayByUserId),
        when: formatRunPickerWhenSegment(run),
        fields: extractGeometryFields(data),
      });
    }
    setPickerSources(entries);
    setPickerLoading(false);
  };

  const pickerResults = useMemo(() => {
    if (!pickerSources) return [];
    const tokens = pickerQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const matches =
      tokens.length === 0
        ? pickerSources
        : pickerSources.filter((e) => {
            const hay = `${e.label} ${e.when} ${e.kind}`.toLowerCase();
            return tokens.every((t) => hay.includes(t));
          });
    return matches.slice(0, 30);
  }, [pickerSources, pickerQuery]);

  /** Keep the URL shareable: mirror slot A (`s`/`sl`) and slot B (`g`/`gl`) into the query string. */
  const syncUrl = (slotId: SlotId, nextFields: LabFields | null, label: string | null) => {
    try {
      const url = new URL(window.location.href);
      const fieldsParam = slotId === "a" ? "s" : "g";
      const labelParam = slotId === "a" ? "sl" : "gl";
      if (nextFields) {
        url.searchParams.set(fieldsParam, encodeLabFields(nextFields));
        if (label) url.searchParams.set(labelParam, label.slice(0, 60));
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
    syncUrl(slotId, slot?.fields ?? null, slot?.label ?? null);
  };

  const loadEntryIntoSlot = (slotId: SlotId, entry: SetupPickerEntry) => {
    setSlot(slotId, slotFromFields(entry.fields, entry.label));
  };

  /** Main row tap: load into the selected slot and close the picker. */
  const loadEntry = (entry: SetupPickerEntry) => {
    loadEntryIntoSlot(activeId, entry);
    setPickerOpen(false);
    setPickerQuery("");
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
    });
  };

  const clearSlotB = () => {
    setSel("a");
    setSlot("b", null);
  };

  const fields = active.fields;
  const inputs = useMemo(() => deriveRollCenterInputs(fields as Record<string, unknown>), [fields]);
  const computed = useMemo(
    () => computeRollCenterFromSnapshot(fields as Record<string, unknown>),
    [fields]
  );
  const otherFields = other?.fields ?? null;
  const otherInputs = useMemo(
    () => (otherFields ? deriveRollCenterInputs(otherFields as Record<string, unknown>) : null),
    [otherFields]
  );
  const otherComputed = useMemo(
    () => (otherFields ? computeRollCenterFromSnapshot(otherFields as Record<string, unknown>) : null),
    [otherFields]
  );
  // Delta chips only exist against the other slot — never vs the blank car.
  const compareComputed = comparing ? otherComputed : null;

  const geo = inputs ? inputs.pack[axle] : null;
  const adj = inputs ? (axle === "front" ? inputs.frontAdj : inputs.rearAdj) : null;
  const ghostGeo = comparing && otherInputs ? otherInputs.pack[axle] : null;
  const ghostAdj = comparing && otherInputs ? (axle === "front" ? otherInputs.frontAdj : otherInputs.rearAdj) : null;

  const solved = useMemo(
    () => (geo && adj ? solveAxle(geo, adj, rollDeg) : null),
    [geo, adj, rollDeg]
  );
  const ghostSolved = useMemo(
    () => (ghostGeo && ghostAdj ? solveAxle(ghostGeo, ghostAdj, rollDeg) : null),
    [ghostGeo, ghostAdj, rollDeg]
  );

  const sweep = useMemo(() => {
    if (!geo || !adj) return null;
    const pts: { roll: number; x: number; z: number }[] = [];
    for (let r = 0; r <= ROLL_MAX_DEG + 1e-6; r += 0.25) {
      const s = solveAxle(geo, adj, r);
      if (s?.rollCentre) pts.push({ roll: r, x: s.rollCentre.x, z: s.rollCentre.z });
    }
    return pts.length > 1 ? pts : null;
  }, [geo, adj]);
  const ghostSweep = useMemo(() => {
    if (!ghostGeo || !ghostAdj) return null;
    const pts: { roll: number; x: number; z: number }[] = [];
    for (let r = 0; r <= ROLL_MAX_DEG + 1e-6; r += 0.25) {
      const s = solveAxle(ghostGeo, ghostAdj, r);
      if (s?.rollCentre) pts.push({ roll: r, x: s.rollCentre.x, z: s.rollCentre.z });
    }
    return pts.length > 1 ? pts : null;
  }, [ghostGeo, ghostAdj]);

  /** RC sweep paths folded into the schematic's extents so the view never rescales in roll. */
  const schematicExtraPoints = useMemo(
    () => [...(sweep ?? []), ...(ghostSweep ?? [])].map((p) => ({ x: p.x, z: p.z })),
    [sweep, ghostSweep]
  );

  const sensitivities = useMemo(() => {
    if (!geo || !adj) return null;
    const base = computeAxleMetrics(geo, adj);
    if (!base) return null;
    return SENSITIVITY_KNOBS.map(({ label, adjKey }) => {
      const m = computeAxleMetrics(geo, { ...adj, [adjKey]: adj[adjKey] + 1 });
      return { label, perMm: m ? m.rcHeightMm - base.rcHeightMm : null };
    });
  }, [geo, adj]);

  /** Roll animation: ping-pong 0 → 3° → 0 at 1.5°/s. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let dir = 1;
    let value = rollRef.current;
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      value += dir * 1.5 * dt;
      if (value >= ROLL_MAX_DEG) {
        value = ROLL_MAX_DEG;
        dir = -1;
      } else if (value <= 0) {
        value = 0;
        dir = 1;
      }
      setRollDeg(value);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const updateActiveSlot = (update: (slot: Slot) => Slot) => {
    setSlots((s) =>
      activeId === "a" ? { ...s, a: update(s.a) } : s.b ? { ...s, b: update(s.b) } : s
    );
  };

  const setKnob = (keys: GeometrySheetKey[], value: string) => {
    updateActiveSlot((slot) => {
      const next = { ...slot.fields };
      for (const k of keys) next[k] = value;
      return { ...slot, fields: next };
    });
  };

  const knobValue = (keys: GeometrySheetKey[]): { value: number; legsDiffer: boolean } => {
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
    return inputs.pack.baseChassisCode;
  }, [fields.chassis, inputs]);

  // Compare mode: diff other → selected. Single mode: edits vs the loaded sheet
  // (a blank-car session has no list — the no-shim default is not a baseline).
  const changes = useMemo(() => {
    if (comparing && otherFields) return labChangeList(fields, otherFields);
    if (active.loaded) return labChangeList(fields, active.loaded);
    return [];
  }, [comparing, otherFields, fields, active.loaded]);

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
    <CardPanel contentClassName="space-y-2">
      <Eyebrow>Setups</Eyebrow>
      <div className="flex items-center gap-2">
        <SlotChip id="a" slot={slots.a} selected={activeId === "a"} onSelect={() => setSel("a")} />
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
            className="tap-active flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-accent/40 hover:text-foreground"
          >
            + Compare current…
          </button>
        )}
      </div>
      <input
        type="search"
        value={pickerQuery}
        placeholder={`Search setups → load into ${activeId.toUpperCase()}…`}
        onFocus={() => {
          setPickerOpen(true);
          void loadPickerSources();
        }}
        onClick={() => {
          // Reopen on tap even when the input never lost focus (post-load state).
          setPickerOpen(true);
          void loadPickerSources();
        }}
        onChange={(e) => {
          setPickerQuery(e.target.value);
          setPickerOpen(true);
          void loadPickerSources();
        }}
        aria-label="Search runs, downloaded setups, and teammate setups"
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {pickerOpen && (
        <div className="space-y-1">
          {pickerLoading && <p className="text-xs text-muted-foreground">Loading your setups…</p>}
          {pickerError && <p className="text-xs text-muted-foreground">{pickerError}</p>}
          {!pickerLoading && !pickerError && pickerSources && pickerResults.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No matching setups with computable geometry.
            </p>
          )}
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {pickerResults.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => loadEntry(entry)}
                  title={`Load into setup ${activeId.toUpperCase()}`}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
                    {entry.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">{entry.label}</span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                    {entry.when}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => loadEntryAsComparison(entry)}
                  title={`Load into setup ${otherId.toUpperCase()} as the comparison`}
                  className="shrink-0 rounded-md border border-border px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                >
                  vs
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
            onClick={() => {
              setPickerOpen(false);
              setPickerQuery("");
            }}
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
              updateActiveSlot(() => ({ fields: { ...LAB_DEFAULT_FIELDS }, loaded: null, label: null }))
            }
          >
            Reset {activeId.toUpperCase()} to A800 baseline
          </Button>
        </CardPanel>
      </div>
    );
  }

  const rcAtRoll = solved?.rollCentre ?? null;

  const deltaChip = (current: number, base: number | null | undefined, unit: string) => {
    if (base == null) return null;
    const d = current - base;
    if (Math.abs(d) < 0.05) return null;
    return (
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {d > 0 ? "↑" : "↓"} {Math.abs(d).toFixed(1)}
        {unit}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── Setups (A/B slots + picker) ────────────────────────────── */}
      {setupsCard}

      {/* ── The instrument ─────────────────────────────────────────── */}
      <CardPanel contentClassName="space-y-3">
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
            className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-faint border border-border rounded px-1.5 py-0.5"
            title="Trust grade for absolute values; deltas are exact regardless"
          >
            {computed.verificationGrade}
          </span>
        </div>

        {solved && (
          <div className="aspect-[12/5] w-full">
            <AxleSchematic
              solved={solved}
              ghost={ghostSolved}
              extraPoints={schematicExtraPoints}
              fitBox
              axleLabel={axle}
              showCamber
              className="text-foreground"
            />
          </div>
        )}
        {comparing && (
          <p className="truncate text-right font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
            solid = {activeId} · dashed = {otherId}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="px-3 py-1 text-xs"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            {playing ? "Pause" : "Roll"}
          </Button>
          <input
            type="range"
            min={0}
            max={ROLL_MAX_DEG}
            step={0.05}
            value={rollDeg}
            onChange={(e) => {
              setPlaying(false);
              setRollDeg(Number(e.target.value));
            }}
            aria-label="Chassis roll angle (degrees)"
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-[9.5rem] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {rollDeg.toFixed(1)}° · RC {rcAtRoll ? `${fmtMm(rcAtRoll.z)} / ${fmtMm(rcAtRoll.x, 0)}mm` : "—"}
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
              <div className="font-mono text-sm tabular-nums">{fmtMm(s.value)} mm</div>
              {/* Fixed-height slot: chips appearing/vanishing must not reflow the card */}
              <div className="h-4">{deltaChip(s.value, s.base, "")}</div>
            </div>
          ))}
        </div>
      </CardPanel>

      {/* ── Adjustments (edit the selected slot) ───────────────────── */}
      <CardPanel contentClassName="space-y-3">
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

        {AXLE_KNOBS[axle].map((knob) => {
          const { value, legsDiffer } = knobValue(knob.keys);
          return (
            <KnobRow
              key={knob.label}
              label={knob.label}
              value={value}
              legsDiffer={legsDiffer}
              max={knob.max}
              onChange={(v) => setKnob(knob.keys, v)}
            />
          );
        })}

        <KnobRow
          label="Ride height"
          value={parseNum(fields[axle === "front" ? "ride_height_front" : "ride_height_rear"]) ?? (axle === "front" ? 5.0 : 5.2)}
          min={4}
          max={7}
          step={0.1}
          onChange={(v) => setKnob([axle === "front" ? "ride_height_front" : "ride_height_rear"], v)}
        />
        <KnobRow
          label="Camber (neg °)"
          value={(() => {
            // Sheets record camber as magnitude-of-negative ("2.0" and "-2.0" both = −2°);
            // the knob always shows the magnitude. Unset → the solved link-default camber.
            const raw = parseNum(fields[axle === "front" ? "camber_front" : "camber_rear"]);
            return raw != null
              ? Math.abs(raw)
              : Math.round(Math.abs(computed[axle].camberDeg) * 100) / 100;
          })()}
          min={0}
          max={4}
          step={0.25}
          unit="°"
          onChange={(v) => setKnob([axle === "front" ? "camber_front" : "camber_rear"], v)}
        />

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="type-data-label shrink-0 sm:w-[9.5rem]">Chassis</span>
          <SegmentedControl
            size="sm"
            className="sm:flex-1"
            ariaLabel="Chassis plate"
            options={Object.entries(inputs.pack.chassisOptions).map(([code, o]) => ({
              value: code,
              label: o.label,
            }))}
            value={chassisCode ?? inputs.pack.baseChassisCode}
            onChange={(code) => setKnob(["chassis"], code)}
          />
        </div>
      </CardPanel>

      {/* ── Migration + sensitivities ──────────────────────────────── */}
      <CardPanel contentClassName="space-y-3">
        <Eyebrow>RC migration in roll · {axle}</Eyebrow>
        {sweep && (
          <MigrationPathChart
            sweep={sweep}
            ghostSweep={ghostSweep}
            ghostName={comparing ? otherId.toUpperCase() : null}
            current={rcAtRoll}
          />
        )}
        <Eyebrow>Shim sensitivity · {axle}</Eyebrow>
        <div className="space-y-1">
          {sensitivities?.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-2">
              <span className="type-data-label">{s.label}</span>
              <span className="font-mono text-[11px] tabular-nums">
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
                <li key={c} className="font-mono text-[10px] leading-relaxed text-muted-foreground">
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="px-3 py-1 text-xs"
            onClick={copyChanges}
            disabled={changes.length === 0}
          >
            {copied ? "Copied" : comparing ? "Copy differences" : "Copy change list"}
          </Button>
        </div>

        {computed.assumptions.length > 0 && (
          <p className="text-[10px] leading-relaxed text-faint">
            Assumed: {computed.assumptions.join(" · ")}
          </p>
        )}
      </CardPanel>
    </div>
  );
}
