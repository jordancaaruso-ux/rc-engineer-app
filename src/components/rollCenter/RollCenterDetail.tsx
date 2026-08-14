"use client";

/**
 * The expanded computed-geometry view, shared by every surface that shows it.
 *
 * Two hosts render this body: `RollCenterGeometryBlock` (the form-style sheet, where it has always
 * lived) and `SheetGeometryStrip` (the drawn-sheet surfaces, where the block went missing when the
 * sheet replaced the form as the setup view). Extracted rather than copied because the two are the
 * same view of the same numbers — a driver who expands geometry on their A800RR sheet and on a
 * form-style chassis must not be reading two different renderings of one calculation.
 *
 * Geometry deltas are neutral ink — direction, not good/bad (docs/ROLL_CENTER_NORTH_STAR.md).
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import type {
  RollCenterComputation,
  solveRollCenterDiagram,
} from "@/lib/rollCenter/computeFromSnapshot";
import { encodeLabSlot, extractGeometryFields, type LabSource } from "@/lib/rollCenter/labState";

export type RollCenterSolves = ReturnType<typeof solveRollCenterDiagram>;

/**
 * Deep link into the Geometry Lab seeded with this sheet (+ optional ghost slot).
 *
 * `origin` is optional and additive: the geometry slice alone still opens the Lab for anyone, exactly
 * as before. When a surface knows which chassis it is drawing and which row it is showing, passing
 * that along is what lets the Lab draw the actual sheet and offer a way back to the setup — see
 * `labState.ts`. A surface that doesn't know simply doesn't say.
 */
export function labHref(
  value: Record<string, unknown>,
  ghostValue?: Record<string, unknown> | null,
  labels?: { s?: string; g?: string },
  origin?: { setupSheetModelId?: string | null; source?: LabSource | null }
): string {
  const s = encodeLabSlot({
    fields: extractGeometryFields(value),
    setupSheetModelId: origin?.setupSheetModelId ?? null,
    source: origin?.source ?? null,
  });
  // The ghost is read-only by definition, so it carries the chassis but never a writable source.
  const g = ghostValue
    ? encodeLabSlot({
        fields: extractGeometryFields(ghostValue),
        setupSheetModelId: origin?.setupSheetModelId ?? null,
        source: null,
      })
    : null;
  const sl = labels?.s ? `&sl=${encodeURIComponent(labels.s.slice(0, 60))}` : "";
  const gl = g && labels?.g ? `&gl=${encodeURIComponent(labels.g.slice(0, 60))}` : "";
  return `/analysis/roll-center?s=${s}${sl}${g ? `&g=${g}` : ""}${gl}`;
}

export function fmtMm(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

export function fmtGain(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

/** Which way the roll axis tips, in words — degrees here are imperceptibly small numbers. */
export function rakeWord(rakeMm: number): string {
  if (rakeMm > 0.05) return "rakes down to front";
  if (rakeMm < -0.05) return "rakes down to rear";
  return "level";
}

/**
 * The pack's verification grade, per the trust doctrine: absolutes carry it, deltas never do.
 *
 * It rides in the expanded body only. The collapsed line is four numbers on one row on a phone, and
 * a grade tag there costs more width than it buys — a deliberate exception, not an omission.
 */
export function GradeTag({ grade }: { grade: RollCenterComputation["verificationGrade"] }) {
  return (
    <span className="rounded border border-border px-1.5 py-0.5 micro-caps text-faint">
      {grade}
    </span>
  );
}

export function NeutralDelta({ current, baseline, unit, dp = 1 }: {
  current: number;
  baseline: number | null | undefined;
  unit: string;
  dp?: number;
}) {
  if (baseline == null) return null;
  const d = current - baseline;
  if (Math.abs(d) < Math.pow(10, -dp) / 2) return null;
  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {d > 0 ? "↑" : "↓"} {Math.abs(d).toFixed(dp)}
      {unit}
    </span>
  );
}

/** Tiny side-view roll-axis strip: front + rear RC dots against the ground line. */
export function RollAxisStrip({ frontMm, rearMm }: { frontMm: number; rearMm: number }) {
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

/**
 * The body itself: front/rear schematic, the three value rows, the Lab door.
 *
 * `solves` is passed in rather than computed here so the caller decides when the diagram solve runs
 * — both hosts only solve once the driver has actually opened the thing.
 */
export function RollCenterDetail({
  computed,
  solves,
  value,
  baselineValue,
  baseline,
  labLabels,
  labOrigin,
  className,
}: {
  computed: RollCenterComputation;
  solves: RollCenterSolves | null;
  /** The snapshot this was computed from — seeds the Lab deep link. */
  value: Record<string, unknown>;
  /** The comparison snapshot, for the Lab's ghost slot. */
  baselineValue?: Record<string, unknown> | null;
  /** The comparison snapshot's computation, for the neutral deltas. */
  baseline?: RollCenterComputation | null;
  labLabels?: { s?: string; g?: string };
  /** Which chassis and which stored row this is, when the host knows — see `labHref`. */
  labOrigin?: { setupSheetModelId?: string | null; source?: LabSource | null };
  className?: string;
}) {
  const [axle, setAxle] = useState<"front" | "rear">("front");

  return (
    <div className={className}>
      <div className="space-y-3 p-3">
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
      </div>

      <div className="border-t border-border/80">
        <div className="flex min-h-[1.9rem] items-stretch border-b border-border/80">
          <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] ui-title text-muted-foreground flex items-center">
            Roll center F/R
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1">
            <span className="fig-stat font-semibold text-foreground">
              {fmtMm(computed.front.rcHeightMm)} / {fmtMm(computed.rear.rcHeightMm)} mm
            </span>
            <NeutralDelta current={computed.front.rcHeightMm} baseline={baseline?.front.rcHeightMm} unit="F" />
            <NeutralDelta current={computed.rear.rcHeightMm} baseline={baseline?.rear.rcHeightMm} unit="R" />
          </div>
        </div>

        <div className="flex min-h-[1.9rem] items-stretch border-b border-border/80">
          <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] ui-title text-muted-foreground flex items-center">
            Roll axis
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
            <RollAxisStrip frontMm={computed.front.rcHeightMm} rearMm={computed.rear.rcHeightMm} />
    <span className="text-[10px] text-muted-foreground tabular-nums">
              Δ {Math.abs(computed.rakeMm).toFixed(1)}mm · {rakeWord(computed.rakeMm)}
            </span>
          </div>
        </div>

        <div className="flex min-h-[1.9rem] items-stretch">
          <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] ui-title text-muted-foreground flex items-center">
            Camber gain F/R
          </div>
          <div className="flex min-w-0 flex-1 items-center px-2 py-1">
            <span className="fig-stat font-semibold text-foreground">
              {fmtGain(computed.front.camberGainDegPerMm)} / {fmtGain(computed.rear.camberGainDegPerMm)} °/mm
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/80 px-2 py-2">
        <Link
          href={labHref(value, baselineValue, labLabels, labOrigin)}
          /* `primary-ink`, not `accent`: yellow doing a foreground job has to darken on paper,
             which is the whole reason that token exists (light mode, main @ 4275087). */
          className="tap-active inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-primary-ink/40 hover:bg-muted/60"
        >
          Open in Lab
        </Link>
        <GradeTag grade={computed.verificationGrade} />
        {computed.assumptions.length > 0 && (
          <p className={cn("min-w-0 flex-1 text-right text-[10px] leading-relaxed text-faint")}>
            Assumed: {computed.assumptions.join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
