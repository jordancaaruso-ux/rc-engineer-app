"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import {
  TrackTimingUrlsField,
  type TrackTimingUrlsFieldHandle,
} from "@/components/tracks/TrackTimingUrlsField";
import type { TrackTimingUrls } from "@/lib/tracks/trackTimingUrl";

/**
 * Shown on a track that has no timing link at all — which, after the catalog seed, is most of
 * Europe: those rows come from OpenStreetMap, which knows where a track is but not where it posts
 * its results.
 *
 * This is how that gap closes. Rather than us copying a timing provider's directory, the first
 * driver who races here pastes their own club's link once, and every driver at that track gets
 * automatic lap import from then on. Setting timing URLs is deliberately open to any signed-in
 * driver (see the PATCH route: "GPS + track URLs are contributions any driver may add"), so this
 * needs no new permission and no new endpoint.
 *
 * The "look it up" buttons run a plain web search rather than deep-linking into a provider's own
 * search. Speedhive is a single-page app that serves an identical 3KB shell for every URL, so a
 * `?q=` deep link cannot be verified to actually search anything — a link that silently does
 * nothing is worse than one that plainly works. Replace this if a real search URL is ever
 * confirmed in a browser.
 */
export function TrackTimingLinkFinder(props: { trackId: string; trackName: string }) {
  const router = useRouter();
  const fieldRef = useRef<TrackTimingUrlsFieldHandle>(null);
  const [value, setValue] = useState<TrackTimingUrls>({ liveRcUrl: null, speedhiveUrl: null });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function lookupHref(provider: "speedhive.mylaps.com" | "liverc.com"): string {
    return `https://duckduckgo.com/?q=${encodeURIComponent(`${props.trackName} site:${provider}`)}`;
  }

  async function save() {
    // Most people never press Enter on the paste box — fold a half-typed URL in at save time.
    const committed = fieldRef.current?.commit() ?? { ok: true as const, value };
    if (!committed.ok) {
      setError(committed.error);
      return;
    }
    const next = committed.value;
    if (!next.liveRcUrl && !next.speedhiveUrl) {
      setError("Paste the track's timing page first.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracks/${props.trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save that link. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not save that link. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardPanel contentClassName="text-sm space-y-3">
      <Eyebrow>Timing</Eyebrow>
      <div>
        <p className="font-medium text-foreground">No timing link yet</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          Add where this track posts its results and your sessions import themselves — for everyone
          who races here, not just you.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={lookupHref("speedhive.mylaps.com")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
        >
          Look up on Speedhive
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
        <a
          href={lookupHref("liverc.com")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
        >
          Look up on LiveRC
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>

      <TrackTimingUrlsField
        ref={fieldRef}
        value={value}
        onChange={setValue}
        onError={setError}
        inputClassName="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
        labelClassName="text-[11px] font-medium text-muted-foreground"
      />

      {error ? <p className="text-[12px] leading-snug text-destructive">{error}</p> : null}

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        {saving ? "Saving…" : "Save timing link"}
      </Button>
    </CardPanel>
  );
}
