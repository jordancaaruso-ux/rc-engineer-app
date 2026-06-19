"use client";

import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import {
  DEFAULT_OVERLAY_ALIGNMENT,
  type OverlayAlignment,
  patchAlignment,
} from "@/components/videos/videoOverlayAlignment";
import { clamp } from "@/components/videos/videoOverlayConstants";

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  nudgeStep?: number;
  onChange: (v: number) => void;
  compact?: boolean;
};

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  nudgeStep,
  onChange,
  compact = false,
}: SliderRowProps) {
  const nudge = nudgeStep ?? step;
  const display = unit ? `${value.toFixed(step < 1 ? 1 : 0)}${unit}` : String(value);

  return (
    <label className={cn("block text-xs", compact && "space-y-0.5")}>
      <span className="text-muted-foreground">
        {label}: {display}
      </span>
      <input
        className="mt-1 w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {nudgeStep != null ? (
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => onChange(clamp(value - nudge, min, max))}
          >
            −
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => onChange(clamp(value + nudge, min, max))}
          >
            +
          </button>
        </div>
      ) : null}
    </label>
  );
}

type Props = {
  alignment: OverlayAlignment;
  onChange: (next: OverlayAlignment) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  compact?: boolean;
};

export function VideoOverlayAlignmentPanel({
  alignment,
  onChange,
  expanded,
  onToggleExpanded,
  compact = false,
}: Props) {
  const set = (patch: Partial<OverlayAlignment>) => onChange(patchAlignment(alignment, patch));

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        onClick={onToggleExpanded}
      >
        <span>Align overlay</span>
        <span className="text-[10px] opacity-70">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded ? (
        <CardPanel contentClassName="space-y-3" className={compact ? "max-h-48 overflow-y-auto" : undefined}>
          <SliderRow
            label="Shift X"
            value={alignment.translateX}
            min={-400}
            max={400}
            step={1}
            unit="px"
            nudgeStep={1}
            onChange={(v) => set({ translateX: v })}
            compact={compact}
          />
          <SliderRow
            label="Shift Y"
            value={alignment.translateY}
            min={-400}
            max={400}
            step={1}
            unit="px"
            nudgeStep={1}
            onChange={(v) => set({ translateY: v })}
            compact={compact}
          />
          <SliderRow
            label="Scale"
            value={alignment.scale}
            min={0.5}
            max={2}
            step={0.01}
            unit="×"
            nudgeStep={0.01}
            onChange={(v) => set({ scale: v })}
            compact={compact}
          />
          <SliderRow
            label="Scale X"
            value={alignment.scaleX}
            min={0.8}
            max={1.2}
            step={0.01}
            unit="×"
            nudgeStep={0.01}
            onChange={(v) => set({ scaleX: v })}
            compact={compact}
          />
          <SliderRow
            label="Scale Y"
            value={alignment.scaleY}
            min={0.8}
            max={1.2}
            step={0.01}
            unit="×"
            nudgeStep={0.01}
            onChange={(v) => set({ scaleY: v })}
            compact={compact}
          />
          <SliderRow
            label="Rotate"
            value={alignment.rotateDeg}
            min={-45}
            max={45}
            step={0.1}
            unit="°"
            nudgeStep={0.5}
            onChange={(v) => set({ rotateDeg: v })}
            compact={compact}
          />
          <SliderRow
            label="Skew X"
            value={alignment.skewXDeg}
            min={-25}
            max={25}
            step={0.1}
            unit="°"
            nudgeStep={0.5}
            onChange={(v) => set({ skewXDeg: v })}
            compact={compact}
          />
          <SliderRow
            label="Skew Y"
            value={alignment.skewYDeg}
            min={-25}
            max={25}
            step={0.1}
            unit="°"
            nudgeStep={0.5}
            onChange={(v) => set({ skewYDeg: v })}
            compact={compact}
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted w-full"
            onClick={() => onChange({ ...DEFAULT_OVERLAY_ALIGNMENT })}
          >
            Reset alignment
          </button>
        </CardPanel>
      ) : null}
    </div>
  );
}
