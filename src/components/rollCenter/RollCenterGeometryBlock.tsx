"use client";

/**
 * Computed-geometry block for setup sheets and compare surfaces.
 * Renders only when a platform pack matches the snapshot (Awesomatix today).
 *
 * Founder-picked viewing experience (2026-07-12, docs/ROLL_CENTER_NORTH_STAR.md
 * Phase 2.5): collapsed by default to the RC + rake one-liner; expands to the
 * clean-schematic axle diagram (front/rear toggle, arm angles on the arms) with
 * camber gain for both axles.
 *
 * Trust doctrine: deltas render untagged (instrument-grade); absolutes carry the
 * pack's verification-grade tag. Geometry deltas are neutral ink — direction,
 * not good/bad.
 */

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import {
  computeRollCenterFromSnapshot,
  solveRollCenterDiagram,
  type RollCenterComputation,
} from "@/lib/rollCenter/computeFromSnapshot";

const GRADE_LABELS: Record<RollCenterComputation["verificationGrade"], string> = {
  measured: "measured",
  "cross-checked": "cross-checked",
  "cad-verified": "CAD-verified",
};

function fmtMm(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function NeutralDelta({ current, baseline, unit, dp = 1 }: {
  current: number;
  baseline: number | null | undefined;
  unit: string;
  dp?: number;
}) {
  if (baseline == null) return null;
  const d = current - baseline;
  if (Math.abs(d) < Math.pow(10, -dp) / 2) return null;
  return (
    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
      {d > 0 ? "↑" : "↓"} {Math.abs(d).toFixed(dp)}
      {unit}
    </span>
  );
}

/** Tiny side-view roll-axis strip: front + rear RC dots against the ground line. */
function RollAxisStrip({ frontMm, rearMm }: { frontMm: number; rearMm: number }) {
  const W = 150;
  const H = 40;
  const zMin = Math.min(frontMm, rearMm, 0) - 2;
  const zMax = Math.max(frontMm, rearMm, 0) + 3;
  const y = (z: number) => 6 + ((zMax - z) / (zMax - zMin)) * (H - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[150px]" aria-hidden="true">
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
      <line x1={20} y1={y(frontMm)} x2={W - 20} y2={y(rearMm)} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} />
      <circle cx={20} cy={y(frontMm)} r={3.5} fill="currentColor" />
      <circle cx={W - 20} cy={y(rearMm)} r={3.5} fill="currentColor" />
      <text x={20} y={H - 1} textAnchor="middle" fontSize={7} fill="currentColor" fillOpacity={0.55} style={{ letterSpacing: "0.15em" }}>
        F
      </text>
      <text x={W - 20} y={H - 1} textAnchor="middle" fontSize={7} fill="currentColor" fillOpacity={0.55} style={{ letterSpacing: "0.15em" }}>
        R
      </text>
    </svg>
  );
}

function fmtGain(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

export type RollCenterGeometryBlockProps = {
  value: Record<string, unknown>;
  /** Optional comparison snapshot: renders neutral ↑/↓ deltas vs it. */
  baselineValue?: Record<string, unknown> | null;
  className?: string;
};

export function RollCenterGeometryBlock({ value, baselineValue, className }: RollCenterGeometryBlockProps) {
  const computed = useMemo(() => computeRollCenterFromSnapshot(value), [value]);
  const baseline = useMemo(
    () => (baselineValue ? computeRollCenterFromSnapshot(baselineValue) : null),
    [baselineValue]
  );
  const [expanded, setExpanded] = useState(false);
  const [axle, setAxle] = useState<"front" | "rear">("front");
  // The diagram solve only runs once the block is opened.
  const solves = useMemo(() => (expanded ? solveRollCenterDiagram(value) : null), [expanded, value]);
  const bodyId = useId();
  if (!computed) return null;

  const rakeWord =
    computed.rakeMm > 0.05
      ? "rakes down to front"
      : computed.rakeMm < -0.05
        ? "rakes down to rear"
        : "level";

  return (
    <div className={cn("rounded-lg border border-border bg-secondary/60", className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left"
      >
        <svg
          viewBox="0 0 12 12"
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-90"
          )}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="type-data-label">Geometry</span>
        <span className="font-mono text-[11px] tabular-nums">
          RC {fmtMm(computed.front.rcHeightMm)} / {fmtMm(computed.rear.rcHeightMm)}mm · rake {fmtMm(computed.rakeMm)}
        </span>
        <span
          className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-faint border border-border rounded px-1.5 py-0.5"
          title="Trust grade for absolute values; deltas between setups are exact regardless"
        >
          {GRADE_LABELS[computed.verificationGrade]}
        </span>
      </button>

      {expanded && (
        <div id={bodyId} className="px-3 pb-3 space-y-3">
          <SegmentedControl
            size="sm"
            className="mx-auto max-w-[200px]"
            ariaLabel="Axle shown in the schematic"
            options={[
              { value: "front", label: "Front" },
              { value: "rear", label: "Rear" },
            ]}
            value={axle}
            onChange={setAxle}
          />

          {solves && (
            <AxleSchematic
              solved={axle === "front" ? solves.front : solves.rear}
              axleLabel={axle}
              className="text-foreground"
            />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 items-start">
            <div className="space-y-0.5">
              <div className="type-data-label">Roll center F/R</div>
              <div className="font-mono text-sm tabular-nums">
                {fmtMm(computed.front.rcHeightMm)} / {fmtMm(computed.rear.rcHeightMm)} mm
              </div>
              <div className="flex gap-2">
                <NeutralDelta current={computed.front.rcHeightMm} baseline={baseline?.front.rcHeightMm} unit="F" />
                <NeutralDelta current={computed.rear.rcHeightMm} baseline={baseline?.rear.rcHeightMm} unit="R" />
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="type-data-label">Roll axis</div>
              <div className="text-current">
                <RollAxisStrip frontMm={computed.front.rcHeightMm} rearMm={computed.rear.rcHeightMm} />
              </div>
              <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                Δ {Math.abs(computed.rakeMm).toFixed(1)}mm · {rakeWord}
              </div>
            </div>

            <div className="space-y-0.5 col-span-2 sm:col-span-1">
              <div className="type-data-label">Camber gain F/R</div>
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {fmtGain(computed.front.camberGainDegPerMm)} / {fmtGain(computed.rear.camberGainDegPerMm)} °/mm
              </div>
            </div>
          </div>

          {computed.assumptions.length > 0 && (
            <p className="text-[10px] leading-relaxed text-faint">
              Assumed: {computed.assumptions.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact run-vs-run geometry line for compare panels: RC front/rear + rake deltas.
 * Renders nothing unless BOTH snapshots compute (same-pack comparison only).
 */
export function RollCenterCompareStrip({ a, b, rightLabel, className }: {
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  rightLabel: string;
  className?: string;
}) {
  const ca = useMemo(() => computeRollCenterFromSnapshot(a), [a]);
  const cb = useMemo(() => computeRollCenterFromSnapshot(b), [b]);
  if (!ca || !cb || ca.packId !== cb.packId) return null;

  const row = (label: string, va: number, vb: number) => {
    const d = va - vb;
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-data-label">{label}</span>
        <span className="font-mono text-[11px] tabular-nums">
          {fmtMm(va)} vs {fmtMm(vb)} mm
          <span className="text-muted-foreground">
            {" "}
            {Math.abs(d) < 0.05 ? "· same" : `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(1)}`}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className={cn("rounded-md border border-border bg-secondary/60 p-3 space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-data-label">Computed geometry · this run vs {rightLabel}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
          deltas exact
        </span>
      </div>
      {row("Roll center front", ca.front.rcHeightMm, cb.front.rcHeightMm)}
      {row("Roll center rear", ca.rear.rcHeightMm, cb.rear.rcHeightMm)}
      {row("Roll axis rake", ca.rakeMm, cb.rakeMm)}
    </div>
  );
}
