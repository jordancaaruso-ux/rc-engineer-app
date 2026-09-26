"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Match = { id: number; name: string; countryCode: string | null; url: string };

/**
 * Which track to look for. A saved track is looked up by id — the server reads its name, town and
 * country. A track still being added is looked up by what is in the form's boxes right now.
 */
export type SpeedhiveFinderSource =
  | { trackId: string }
  | { name: string; location: string | null };

let countryNames: Intl.DisplayNames | null = null;
function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    countryNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return countryNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function matchesUrl(source: SpeedhiveFinderSource, q: string | null): string {
  if ("trackId" in source) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return `/api/tracks/${encodeURIComponent(source.trackId)}/speedhive-matches${qs}`;
  }
  const params = new URLSearchParams({ name: q ?? source.name.trim() });
  if (!q && source.location?.trim()) params.set("location", source.location.trim());
  return `/api/tracks/speedhive-matches?${params}`;
}

/**
 * "Find on Speedhive" — lists the Speedhive practice locations that look like this track, and
 * hands back the one the driver taps: saved onto a track that exists, or dropped into the timing
 * pages of a track still being added.
 *
 * Replaces a web-search link out. Speedhive's own site has no search URL we could deep-link, and
 * their directory can't be copied into ours (MYLAPS Conditions of Use 5.3) — so the server reads
 * it at tap time and only the chosen link is kept. See `speedhive-matches/route.ts`.
 *
 * No `<form>` inside: this sits in the add-track forms, and a nested form's submit would bubble
 * up and create the track mid-search.
 */
export function SpeedhiveTrackFinder({
  source,
  onPick,
  size = "md",
  block = false,
}: {
  source: SpeedhiveFinderSource;
  /** Use the picked practice page. Resolve to an error message, or null when done. */
  onPick: (speedhiveUrl: string, name: string) => Promise<string | null>;
  size?: "sm" | "md";
  /**
   * The add-track forms: a full-width button right under the name box that says the name back
   * ("Find “Knox” on Speedhive"), founder pick 2026-09-26. It sat at the foot of the form, under
   * the timing pages, where a driver who had just typed the name never looked.
   */
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Results belong to the name and town they were searched for. Typing in either box closes them
  // and brings the button back, so a list can never answer for a name that's no longer there —
  // not even one typed back to what it was, which would show a manual search's leftovers.
  const lookupKey =
    "trackId" in source ? source.trackId : `${source.name.trim()}\n${source.location?.trim() ?? ""}`;
  const [keySeen, setKeySeen] = useState(lookupKey);
  if (keySeen !== lookupKey) {
    setKeySeen(lookupKey);
    setOpen(false);
  }
  const [loading, setLoading] = useState(false);
  const searchSeq = useRef(0);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  /**
   * The words the shown `matches` answer, or null for the automatic look. An empty typed search
   * says them back: with the automatic look's line it read exactly as before the tap, as if the
   * search never ran (launch test drive, 2026-09-26).
   */
  const [matchesFor, setMatchesFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const text = size === "sm" ? "text-[12px]" : "text-[13px]";
  const nothingTyped = !("trackId" in source) && !source.name.trim();
  const typedName = "trackId" in source ? "" : source.name.trim();

  async function search(q: string | null) {
    // Only the newest search may land — a slow answer for an old name must not replace a new one.
    const seq = ++searchSeq.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(matchesUrl(source, q));
      const data = (await res.json().catch(() => ({}))) as { matches?: Match[]; error?: string };
      if (seq !== searchSeq.current) return;
      if (!res.ok) {
        setError(data.error ?? "Couldn't reach Speedhive just now.");
        setMatches(null);
        return;
      }
      setMatches(data.matches ?? []);
      setMatchesFor(q);
    } catch {
      if (seq !== searchSeq.current) return;
      setError("Couldn't reach Speedhive just now.");
      setMatches(null);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }

  async function pick(match: Match) {
    if (savingId != null) return;
    setSavingId(match.id);
    setError(null);
    const failed = await onPick(match.url, match.name).catch(() => "Could not save that link.");
    setSavingId(null);
    if (failed) setError(failed);
  }

  function submitQuery() {
    if (query.trim() && !loading) void search(query.trim());
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={nothingTyped}
        onClick={() => {
          setQuery("");
          void search(null);
        }}
        // Said whole: the name sits in its own box so it can shorten, which splits the words.
        aria-label={block && typedName ? `Find “${typedName}” on Speedhive` : undefined}
        className={cn(
          block
            ? "flex w-full min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            : "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:bg-muted disabled:opacity-50",
          text
        )}
      >
        <Search aria-hidden className="size-3.5 shrink-0" />
        {block && typedName ? (
          // A long name gives way, never the words around it.
          <span className="flex min-w-0 whitespace-nowrap">
            Find “<span className="min-w-0 truncate">{typedName}</span>” on Speedhive
          </span>
        ) : (
          "Find on Speedhive"
        )}
      </button>
    );
  }

  return (
    <div className="w-full basis-full space-y-2">
      {loading ? (
        <p className={cn("text-muted-foreground", text)}>Searching Speedhive…</p>
      ) : matches && matches.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                disabled={savingId != null}
                onClick={() => void pick(m)}
                className={cn(
                  "flex w-full min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60",
                  text
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{m.name}</span>
                  {countryName(m.countryCode) ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {countryName(m.countryCode)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-primary-ink">
                  {savingId === m.id ? "Saving…" : "Use"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : matches ? (
        <p className={cn("text-muted-foreground", text)}>
          {matchesFor ? `Nothing on Speedhive for “${matchesFor}”` : "Nothing close on Speedhive"}
        </p>
      ) : null}

      <div className="flex gap-1.5">
        <input
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Never let Enter reach the add-track form around this box.
            e.preventDefault();
            submitQuery();
          }}
          placeholder="Search Speedhive by name"
          aria-label="Search Speedhive by name"
          className={cn(
            "min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 outline-none",
            text
          )}
        />
        <button
          type="button"
          onClick={submitQuery}
          disabled={loading || !query.trim()}
          className={cn(
            "shrink-0 rounded-md border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-muted disabled:opacity-50",
            text
          )}
        >
          Search
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
