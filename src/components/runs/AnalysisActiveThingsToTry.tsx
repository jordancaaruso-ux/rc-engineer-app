"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { id: string; text: string };

/**
 * Read-only view of the user’s global ActionItem list while reviewing a run.
 * Keeps decision context visible next to per-run “Things to try” (run snapshot).
 */
export function AnalysisActiveThingsToTry() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/action-items?list=try", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((data: { items?: Item[] } | null) => {
        if (!alive) return;
        if (!data || !Array.isArray(data.items)) {
          setItems([]);
          return;
        }
        setItems(
          data.items.map((i) => ({
            id: i.id,
            text: i.text,
          }))
        );
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Active things to try (all sessions)
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          Persistent list — same as the dashboard. Below, &quot;Things to try&quot; is what you saved with this run only.
        </p>
      </div>
      {items === null ? (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          None yet. Add ideas when you{" "}
          <Link href="/runs/new" className="text-accent underline underline-offset-2">
            log a run
          </Link>{" "}
          or from the{" "}
          <Link href="/" className="text-accent underline underline-offset-2">
            dashboard
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="text-[11px] text-foreground pl-2 border-l-2 border-accent/40 whitespace-pre-wrap break-words">
              {i.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-[10px]">
        <Link href="/" className="text-accent underline underline-offset-2">
          Dashboard workflow
        </Link>
        <Link href="/runs/new" className="text-accent underline underline-offset-2">
          Log next run
        </Link>
      </div>
    </div>
  );
}
