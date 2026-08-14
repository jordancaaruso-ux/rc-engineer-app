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
import { Eyebrow } from "@/components/ui/panel";
import {
  computeRollCenterFromSnapshot,
  solveRollCenterDiagram,
} from "@/lib/rollCenter/computeFromSnapshot";
import { resolvePackForTemplateKey } from "@/lib/rollCenter/packs";
import { RollCenterDetail, fmtMm, labHref } from "@/components/rollCenter/RollCenterDetail";

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
  // The diagram solve only runs once the block is opened.
  const solves = useMemo(
    () => (expanded && pack ? solveRollCenterDiagram(value, pack) : null),
    [expanded, pack, value]
  );
  const bodyId = useId();
  if (!computed) return null;

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
          <span className="text-[11px] tabular-nums font-semibold text-foreground">
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
          <RollCenterDetail
            computed={computed}
            solves={solves}
            value={value}
            baselineValue={baselineValue}
            baseline={baseline}
            labLabels={{ s: "This sheet", g: "Baseline" }}
          />
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
        <span className="text-[11px] tabular-nums">
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
