"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type MergeType = "tire" | "track";
type Candidate = { id: string; label: string };

const SEARCH: Record<
  MergeType,
  { url: (q: string) => string; parse: (data: unknown) => Candidate[] }
> = {
  tire: {
    url: (q) => `/api/tire-types?q=${encodeURIComponent(q)}`,
    parse: (data) => {
      const rows = (data as { tireTypes?: Array<{ id: string; displayName: string; modelCode: string }> })
        .tireTypes;
      return (rows ?? []).map((r) => ({ id: r.id, label: `${r.displayName} · ${r.modelCode}` }));
    },
  },
  track: {
    url: (q) => `/api/tracks?q=${encodeURIComponent(q)}`,
    parse: (data) => {
      const rows = (data as { tracks?: Array<{ id: string; name: string; location: string | null }> })
        .tracks;
      return (rows ?? []).map((r) => ({
        id: r.id,
        label: r.location ? `${r.name} · ${r.location}` : r.name,
      }));
    },
  },
};

/**
 * Collapse a duplicate catalog row into the canonical one: search for the target (the row to
 * keep), then merge this row into it — all its history repoints and this row is deleted.
 * See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export function CatalogMergeControl({
  type,
  loserId,
  loserLabel,
}: {
  type: MergeType;
  loserId: string;
  loserLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(SEARCH[type].url(q));
        const data = await res.json().catch(() => ({}));
        if (id !== reqId.current) return; // stale response
        setResults(SEARCH[type].parse(data).filter((c) => c.id !== loserId).slice(0, 6));
      } catch {
        if (id === reqId.current) setResults([]);
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query, type, loserId]);

  const merge = useCallback(
    async (target: Candidate) => {
      if (
        !window.confirm(
          `Merge "${loserLabel}" into "${target.label}"?\n\nAll runs, sets, and events on "${loserLabel}" move to "${target.label}", and "${loserLabel}" is deleted. This cannot be undone.`
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/admin/catalog-merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, winnerId: target.id, loserId }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          window.alert(data.error?.trim() || `Merge failed (${res.status})`);
          return;
        }
        router.refresh();
      } catch {
        window.alert("Merge failed");
      } finally {
        setBusy(false);
      }
    },
    [type, loserId, loserLabel, router]
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
      >
        Merge…
      </button>
    );
  }

  return (
    <div className="w-full space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={type === "tire" ? "Find the tire type to keep…" : "Find the track to keep…"}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
            setResults([]);
          }}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
        >
          Cancel
        </button>
      </div>
      {query.trim().length >= 1 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {searching && results.length === 0 ? (
            <li className="px-2 py-1.5 text-[11px] text-muted-foreground">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-2 py-1.5 text-[11px] text-muted-foreground">No matches.</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => merge(c)}
                  className={cn(
                    "block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50"
                  )}
                >
                  {c.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
