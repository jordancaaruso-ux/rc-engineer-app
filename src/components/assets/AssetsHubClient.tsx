"use client";

import { useEffect, useState } from "react";
import type { NavHubSection } from "@/components/layout/navConfig";
import { HubNavLink } from "@/components/layout/HubNavLink";
import { PillToggle } from "@/components/ui/PillToggle";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * Assets hub with a Mine / Global scope toggle instead of two stacked sections.
 *
 * The old hub listed "My assets" and "Global assets" one above the other, which
 * put two "Cars" rows and two "Tires" rows on screen distinguished only by a
 * section header. Showing one scope at a time removes the ambiguity: within a
 * scope every label is unique. The chosen scope is remembered per device.
 */
const STORAGE_KEY = "assets-hub-scope";

/** "My assets" → "Mine", "Global assets" → "Global"; falls back to the eyebrow. */
function scopeLabel(eyebrow: string): string {
  if (/^my\b/i.test(eyebrow)) return "Mine";
  if (/global/i.test(eyebrow)) return "Global";
  return eyebrow;
}

export function AssetsHubClient({
  sections,
  counts,
}: {
  sections: NavHubSection[];
  /** Live per-destination totals keyed by href (e.g. `/cars` → 4). Mine scope only. */
  counts?: Record<string, number>;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const i = saved == null ? NaN : Number(saved);
      if (Number.isInteger(i) && i >= 0 && i < sections.length) setActive(i);
    } catch {
      /* storage unavailable — stay on the first scope */
    }
    // Restore once on mount; section identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (i: number) => {
    setActive(i);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(i));
    } catch {
      /* non-fatal */
    }
  };

  const current = sections[active] ?? sections[0];
  if (!current) return null;

  return (
    <>
      <PillToggle
        role="tablist"
        ariaLabel="Asset scope"
        options={sections.map((section, i) => ({
          value: String(i),
          label: scopeLabel(section.eyebrow),
        }))}
        value={String(active)}
        onChange={(next) => select(Number(next))}
      />

      <SurfaceCard variant="panel" contentClassName="p-0">
        <ul className="divide-y divide-border">
          {current.links.map((link) => (
            <HubNavLink
              key={link.href}
              link={link}
              variant="row"
              count={counts?.[link.href]}
            />
          ))}
        </ul>
      </SurfaceCard>
    </>
  );
}
