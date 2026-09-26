"use client";

import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import type { TrackLookalikeHit } from "@/components/tracks/useTrackLookalikes";

/**
 * "Already here": the clubs the typed name plainly means, under the name box of an add-track form.
 * Tapping one makes it the form's main button ("Use Knox Offroad RC Club"); the form keeps "No,
 * it's a different club" for a genuinely new one (founder ruling 2026-09-26, option B).
 */
export function TrackLookalikeRows(props: {
  hits: TrackLookalikeHit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = props.selectedId ?? props.hits[0]?.id ?? null;
  return (
    <div role="radiogroup" aria-label="Already here" className="space-y-1.5">
      <Eyebrow className="mb-0">Already here</Eyebrow>
      {props.hits.map((t) => {
        const on = t.id === selected;
        const where = [t.location, t.liveRcUrl ? "LiveRC" : t.speedhiveUrl ? "Speedhive" : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => props.onSelect(t.id)}
            className={cn(
              "w-full rounded-lg border px-2.5 py-2 text-left transition",
              on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"
            )}
          >
            <span className="block text-sm font-semibold text-foreground">{t.name}</span>
            {where ? <span className="block text-[11.5px] text-muted-foreground">{where}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
