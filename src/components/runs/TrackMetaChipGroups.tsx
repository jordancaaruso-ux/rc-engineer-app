"use client";

import { cn } from "@/lib/utils";
import {
  TRACK_GRIP_LABELS,
  TRACK_GRIP_TAG_IDS,
  TRACK_LAYOUT_LABELS,
  TRACK_LAYOUT_TAG_IDS,
  normalizeGripTags,
  normalizeLayoutTags,
  pickOneTag,
  type TrackGripTagId,
  type TrackLayoutTagId,
} from "@/lib/trackMetaTags";

/** Grip and layout are one value each: a tap replaces the lit chip (see `trackMetaTags.ts`). */
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
        <div className="text-muted-foreground text-[11px]">Grip</div>
        <div className="flex flex-wrap gap-1.5">
          {TRACK_GRIP_TAG_IDS.map((id) => {
            const on = g.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onGripChange(pickOneTag(g, id))}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-primary-ink bg-primary/15 text-foreground"
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
        <div className="text-muted-foreground text-[11px]">Layout</div>
        <div className="flex flex-wrap gap-1.5">
          {TRACK_LAYOUT_TAG_IDS.map((id) => {
            const on = l.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onLayoutChange(pickOneTag(l, id))}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-primary-ink bg-primary/15 text-foreground"
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
