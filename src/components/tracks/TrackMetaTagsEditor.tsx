"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TrackMetaChipGroups } from "@/components/runs/TrackMetaChipGroups";
import { CardPanel } from "@/components/ui/CardPanel";
import {
  normalizeGripTags,
  normalizeLayoutTags,
  type TrackGripTagId,
  type TrackLayoutTagId,
} from "@/lib/trackMetaTags";

export function TrackMetaTagsEditor({
  trackId,
  initialGripTags,
  initialLayoutTags,
  onSaved,
  compact = false,
}: {
  trackId: string;
  initialGripTags: string[];
  initialLayoutTags: string[];
  onSaved?: (saved: { gripTags: string[]; layoutTags: string[] }) => void;
  /** Smaller section for track list rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [gripTags, setGripTags] = useState<TrackGripTagId[]>(() => normalizeGripTags(initialGripTags));
  const [layoutTags, setLayoutTags] = useState<TrackLayoutTagId[]>(() =>
    normalizeLayoutTags(initialLayoutTags)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGripTags(normalizeGripTags(initialGripTags));
    setLayoutTags(normalizeLayoutTags(initialLayoutTags));
  }, [trackId, initialGripTags, initialLayoutTags]);

  async function persist(patch: { gripTags?: TrackGripTagId[]; layoutTags?: TrackLayoutTagId[] }) {
    const nextGrip = patch.gripTags ?? gripTags;
    const nextLayout = patch.layoutTags ?? layoutTags;
    setSaving(true);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gripTags: nextGrip, layoutTags: nextLayout }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        track?: { gripTags?: string[]; layoutTags?: string[] };
      };
      if (!res.ok || !data.track) return;
      const g = normalizeGripTags(data.track.gripTags);
      const l = normalizeLayoutTags(data.track.layoutTags);
      setGripTags(g);
      setLayoutTags(l);
      onSaved?.({ gripTags: g, layoutTags: l });
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  const chipGroups = (
    <TrackMetaChipGroups
      gripTags={gripTags}
      layoutTags={layoutTags}
      disabled={saving}
      onGripChange={(next) => {
        setGripTags(next);
        void persist({ gripTags: next });
      }}
      onLayoutChange={(next) => {
        setLayoutTags(next);
        void persist({ layoutTags: next });
      }}
    />
  );

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground">Grip &amp; layout</div>
        {chipGroups}
      </div>
    );
  }

  return (
    <CardPanel contentClassName="text-sm space-y-2">
      <div className="text-sm font-medium text-foreground">Grip &amp; layout</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Tap chips to describe this venue. Multi-select is allowed (e.g. medium + high grip). Saved on the track
        for everyone in the catalog.
      </p>
      {chipGroups}
    </CardPanel>
  );
}
