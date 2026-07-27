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
 * Styled as one of the setup sheet's sections (SectionCard anatomy: inset Eyebrow
 * header band, bordered label|value rows) so the card reads as part of the sheet.
 * Geometry deltas are neutral ink — direction, not good/bad.
 */

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Eyebrow } from "@/components/ui/panel";
import { AxleSchematic } from "@/components/rollCenter/AxleSchematic";
import {
  computeRollCenterFromSnapshot,
  solveRollCenterDiagram,
} from "@/lib/rollCenter/computeFromSnapshot";
import { resolvePackForTemplateKey } from "@/lib/rollCenter/packs";
import { encodeLabFields, extractGeometryFields } from "@/lib/rollCenter/labState";

/** Deep link into the Roll Center Lab seeded with this sheet (+ optional ghost slot). */
function labHref(
  value: Record<string, unknown>,
  ghostValue?: Record<string, unknown> | null,
  labels?: { s?: string; g?: string }
): string {
  const s = encodeLabFields(extractGeometryFields(value));
  const g = ghostValue ? encodeLabFields(extractGeometryFields(ghostValue)) : null;
  const sl = labels?.s ? `&sl=${encodeURIComponent(labels.s.slice(0, 60))}` : "";
  const gl = g && labels?.g ? `&gl=${encodeURIComponent(labels.g.slice(0, 60))}` : "";
  return `/analysis/roll-center?s=${s}${sl}${g ? `&g=${g}` : ""}${gl}`;
}

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
  /**
   * Chassis-type key (`SetupSheetTemplate.templateKey`). Geometry is a property of the car, so the
   * block renders **only** when this resolves to a pack whose hardpoints were measured on it.
   * Without it, nothing renders — no guessing from the snapshot's field names.
   */
  templateKey?: string | null;
  className?: string;
};

export function RollCenterGeometryBlock({
  value,
  baselineValue,
  templateKey,
  className,
}: RollCenterGeometryBlockProps) {
  const pack = useMemo(() => resolvePackForTemplateKey(templateKey), [templateKey]);
  const computed = useMemo(
    () => (pack ? computeRollCenterFromSnapshot(value, pack) : null),
    [pack, value]
  );
  const baseline = useMemo(
    () => (pack && baselineValue ? computeRollCenterFromSnapshot(baselineValue, pack) : null),
    [pack, baselineValue]
  );
  const [expanded, setExpanded] = useState(false);
  const [axle, setAxle] = useState<"front" | "rear">("front");
  // The diagram solve only runs once the block is opened.
  const solves = useMemo(
    () => (expanded && pack ? solveRollCenterDiagram(value, pack) : null),
    [expanded, pack, value]
  );
  const bodyId = useId();
  if (!computed) return null;

  const rakeWord =
    computed.rakeMm > 0.05
      ? "rakes down to front"
      : computed.rakeMm < -0.05
        ? "rakes down to rear"
        : "level";

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-surface-runna", className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className={cn(
          "flex w-full items-center gap-2 bg-surface-runna-inset px-2 py-1.5 text-left",
          expanded && "border-b border-border"
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* Name the pack: these are one car's measured hardpoints, not a universal calculation. */}
          <span className="eyebrow-label">Geometry · {computed.packDisplayName}</span>
          <span className="font-mono text-[11px] tabular-nums font-semibold text-foreground">
            RC {fmtMm(computed.front.rcHeightMm)} / {fmtMm(computed.rear.rcHeightMm)}mm · rake {fmtMm(computed.rakeMm)}
          </span>
        </span>
        <svg
          viewBox="0 0 12 12"
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded ? "-rotate-90" : "rotate-90"
          )}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div id={bodyId}>
          <div className="p-3 space-y-3">
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
                <span className="text-sm font-mono tabular-nums font-semibold text-foreground">
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
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  Δ {Math.abs(computed.rakeMm).toFixed(1)}mm · {rakeWord}
                </span>
              </div>
            </div>

            <div className="flex min-h-[1.9rem] items-stretch">
              <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] ui-title text-muted-foreground flex items-center">
                Camber gain F/R
              </div>
              <div className="flex min-w-0 flex-1 items-center px-2 py-1">
                <span className="text-sm font-mono tabular-nums font-semibold text-foreground">
                  {fmtGain(computed.front.camberGainDegPerMm)} / {fmtGain(computed.rear.camberGainDegPerMm)} °/mm
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/80 px-2 py-2">
            <Link
              href={labHref(value, baselineValue, { s: "This sheet", g: "Baseline" })}
              className="tap-active inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/40 hover:bg-muted/60"
            >
              Open in Lab
            </Link>
            {computed.assumptions.length > 0 && (
              <p className="min-w-0 text-right text-[10px] leading-relaxed text-faint">
                Assumed: {computed.assumptions.join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact run-vs-run geometry line for compare panels: RC front/rear + rake deltas.
 * Renders nothing unless BOTH snapshots compute (same-pack comparison only).
 */
export function RollCenterCompareStrip({ a, b, rightLabel, templateKey, className }: {
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  rightLabel: string;
  /** Chassis-type key — same car gate as the sheet block; without it nothing renders. */
  templateKey?: string | null;
  className?: string;
}) {
  const pack = useMemo(() => resolvePackForTemplateKey(templateKey), [templateKey]);
  const ca = useMemo(() => (pack ? computeRollCenterFromSnapshot(a, pack) : null), [pack, a]);
  const cb = useMemo(() => (pack ? computeRollCenterFromSnapshot(b, pack) : null), [pack, b]);
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
      <Eyebrow>Computed geometry · this run vs {rightLabel}</Eyebrow>
      {row("Roll center front", ca.front.rcHeightMm, cb.front.rcHeightMm)}
      {row("Roll center rear", ca.rear.rcHeightMm, cb.rear.rcHeightMm)}
      {row("Roll axis rake", ca.rakeMm, cb.rakeMm)}
      <div className="pt-1">
        <Link
          href={labHref(a, b, { s: "This run", g: rightLabel })}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition"
        >
          Compare in Lab →
        </Link>
      </div>
    </div>
  );
}
