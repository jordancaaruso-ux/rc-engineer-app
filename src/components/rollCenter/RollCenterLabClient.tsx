"use client";

/**
 * Roll Center Lab — the interactive what-if surface (Phase 3,
 * docs/ROLL_CENTER_NORTH_STAR.md). Seeds from any sheet's geometry via the `s`
 * URL param (`g` = ghost), runs the validated engine live as you move shims,
 * animates chassis roll, charts RC migration, lists shim sensitivities, and
 * exports the what-if: change list to clipboard, or straight into a new run's
 * setup form (`/runs/new?labSetup=…`).
 *
 * Everything is client-side sheet vocabulary — no APIs, no persistence. Deltas
 * vs the loaded sheet are instrument-grade; absolutes carry the pack grade.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import { computeAxleMetrics, solveAxle, type AxleAdjustments } from "@/lib/rollCenter/engine";
import {
  computeRollCenterFromSnapshot,
  deriveRollCenterInputs,
} from "@/lib/rollCenter/computeFromSnapshot";
import {
  LAB_DEFAULT_FIELDS,
  decodeLabFields,
  encodeLabFields,
  labChangeList,
  type GeometrySheetKey,
  type LabFields,
} from "@/lib/rollCenter/labState";

const ROLL_MAX_DEG = 3;

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
  current,
}: {
  sweep: { roll: number; x: number; z: number }[];
  ghostSweep: { roll: number; x: number; z: number }[] | null;
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
          dashed = ghost
        </text>
      )}
    </svg>
  );
}

export function RollCenterLabClient({ seed, ghostSeed }: {
  seed: string | null;
  ghostSeed: string | null;
}) {
  /** Loaded sheet state = seed merged over the pack baseline; frozen for deltas + change list. */
  const baseline = useMemo<LabFields>(() => {
    const decoded = seed ? decodeLabFields(seed) : null;
    return { ...LAB_DEFAULT_FIELDS, ...(decoded ?? {}) };
  }, [seed]);

  const [fields, setFields] = useState<LabFields>(baseline);
  const [ghost, setGhost] = useState<LabFields | null>(() => {
    const decoded = ghostSeed ? decodeLabFields(ghostSeed) : null;
    return decoded ? { ...LAB_DEFAULT_FIELDS, ...decoded } : null;
  });
  const [axle, setAxle] = useState<"front" | "rear">("front");
  const [rollDeg, setRollDeg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const rollRef = useRef(0);
  rollRef.current = rollDeg;

  const inputs = useMemo(() => deriveRollCenterInputs(fields as Record<string, unknown>), [fields]);
  const computed = useMemo(
    () => computeRollCenterFromSnapshot(fields as Record<string, unknown>),
    [fields]
  );
  const baselineComputed = useMemo(
    () => computeRollCenterFromSnapshot(baseline as Record<string, unknown>),
    [baseline]
  );
  const ghostInputs = useMemo(
    () => (ghost ? deriveRollCenterInputs(ghost as Record<string, unknown>) : null),
    [ghost]
  );
  const ghostComputed = useMemo(
    () => (ghost ? computeRollCenterFromSnapshot(ghost as Record<string, unknown>) : null),
    [ghost]
  );

  const geo = inputs ? inputs.pack[axle] : null;
  const adj = inputs ? (axle === "front" ? inputs.frontAdj : inputs.rearAdj) : null;
  const ghostGeo = ghostInputs ? ghostInputs.pack[axle] : null;
  const ghostAdj = ghostInputs ? (axle === "front" ? ghostInputs.frontAdj : ghostInputs.rearAdj) : null;

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

  const setKnob = (keys: GeometrySheetKey[], value: string) => {
    setFields((f) => {
      const next = { ...f };
      for (const k of keys) next[k] = value;
      return next;
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

  const changes = useMemo(() => labChangeList(fields, baseline), [fields, baseline]);
  const exportHref = useMemo(
    () => `/runs/new?labSetup=${encodeLabFields(fields)}&focus=setup`,
    [fields]
  );

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

  if (!inputs || !computed) {
    return (
      <CardPanel contentClassName="space-y-3 text-sm text-muted-foreground">
        <p>This state doesn&apos;t match a supported platform pack (Awesomatix A800R/RR today).</p>
        <Button variant="outline" onClick={() => setFields({ ...LAB_DEFAULT_FIELDS })}>
          Reset to A800 baseline
        </Button>
      </CardPanel>
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
      {/* ── The instrument ─────────────────────────────────────────── */}
      <CardPanel contentClassName="space-y-3">
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
          <AxleSchematic solved={solved} ghost={ghostSolved} axleLabel={axle} className="text-foreground" />
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
            { label: "RC front", value: computed.front.rcHeightMm, base: baselineComputed?.front.rcHeightMm },
            { label: "RC rear", value: computed.rear.rcHeightMm, base: baselineComputed?.rear.rcHeightMm },
            { label: "Rake", value: computed.rakeMm, base: baselineComputed?.rakeMm },
          ].map((s) => (
            <div key={s.label} className="space-y-0.5">
              <div className="type-data-label">{s.label}</div>
              <div className="font-mono text-sm tabular-nums">{fmtMm(s.value)} mm</div>
              {deltaChip(s.value, s.base, "")}
            </div>
          ))}
        </div>
      </CardPanel>

      {/* ── Adjustments ────────────────────────────────────────────── */}
      <CardPanel contentClassName="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Adjustments · {axle}</Eyebrow>
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition"
            onClick={() => setFields(baseline)}
          >
            Reset to loaded
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
          <MigrationPathChart sweep={sweep} ghostSweep={ghostSweep} current={rcAtRoll} />
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

      {/* ── Ghost + export ─────────────────────────────────────────── */}
      <CardPanel contentClassName="space-y-3">
        <Eyebrow>Compare &amp; export</Eyebrow>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setGhost({ ...fields })}>
            Set ghost = current
          </Button>
          {ghost && (
            <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setGhost(null)}>
              Clear ghost
            </Button>
          )}
          {ghostComputed && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              ghost RC {fmtMm(ghostComputed.front.rcHeightMm)} / {fmtMm(ghostComputed.rear.rcHeightMm)} · rake{" "}
              {fmtMm(ghostComputed.rakeMm)}
            </span>
          )}
        </div>

        {changes.length > 0 && (
          <div className="rounded-md border border-border bg-secondary/60 p-2.5">
            <div className="type-data-label mb-1">Changes vs loaded sheet</div>
            <ul className="space-y-0.5">
              {changes.map((c) => (
                <li key={c} className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="px-3 py-1 text-xs" onClick={copyChanges} disabled={changes.length === 0}>
            {copied ? "Copied" : "Copy change list"}
          </Button>
          <ButtonLink href={exportHref} className={cn("px-3 py-1 text-xs", changes.length === 0 && "opacity-60")}>
            Log run with this setup
          </ButtonLink>
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
