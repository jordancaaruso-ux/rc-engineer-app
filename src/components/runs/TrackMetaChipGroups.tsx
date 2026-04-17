"use client";

import { cn } from "@/lib/utils";
import {
  TRACK_GRIP_LABELS,
  TRACK_GRIP_TAG_IDS,
  TRACK_LAYOUT_LABELS,
  TRACK_LAYOUT_TAG_IDS,
  normalizeGripTags,
  normalizeLayoutTags,
  type TrackGripTagId,
  type TrackLayoutTagId,
} from "@/lib/trackMetaTags";

function toggleInOrder<T extends string>(ordered: readonly T[], current: string[], id: T): T[] {
  const set = new Set(current);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return ordered.filter((x) => set.has(x));
}

export function TrackMetaChipGroups({
  gripTags,
  layoutTags,
  onGripChange,
  onLayoutChange,
  disabled,
}: {
  gripTags: string[];
  layoutTags: string[];
  onGripChange: (next: TrackGripTagId[]) => void;
  onLayoutChange: (next: TrackLayoutTagId[]) => void;
  disabled?: boolean;
}) {
  const g = normalizeGripTags(gripTags);
  const l = normalizeLayoutTags(layoutTags);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-[11px]">Grip (multi-select, e.g. medium + high)</div>
        <div className="flex flex-wrap gap-1.5">
          {TRACK_GRIP_TAG_IDS.map((id) => {
            const on = g.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => onGripChange(toggleInOrder(TRACK_GRIP_TAG_IDS, g, id))}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                  disabled && "opacity-50 pointer-events-none"
                )}
              >
                {TRACK_GRIP_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-[11px]">Layout (multi-select)</div>
        <div className="flex flex-wrap gap-1.5">
          {TRACK_LAYOUT_TAG_IDS.map((id) => {
            const on = l.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => onLayoutChange(toggleInOrder(TRACK_LAYOUT_TAG_IDS, l, id))}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                  disabled && "opacity-50 pointer-events-none"
                )}
              >
                {TRACK_LAYOUT_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
