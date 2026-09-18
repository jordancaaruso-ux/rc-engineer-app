"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";

export function TrackLiveRcUrlEditor(props: {
  trackId: string;
  initialLiveRcUrl: string | null;
  /**
   * A LiveRC catalog row IS its URL — the importer writes it alongside the row's source key and
   * the pair is what makes a re-import an update rather than a second copy. It can't be changed
   * and it can't be cleared, so the field shows what it is and offers nothing (founder call
   * 2026-09-18). `canEditLiveRcUrl` refuses the same change at the API, for admins too here.
   */
  locked?: boolean;
}) {
  const router = useRouter();
  const [liveRcUrl, setLiveRcUrl] = useState(props.initialLiveRcUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(props.trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveRcUrl: liveRcUrl.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; track?: { liveRcUrl?: string | null } };
      if (!res.ok) {
        setMessage(data.error ?? "Could not save.");
        return;
      }
      if (data.track?.liveRcUrl != null) setLiveRcUrl(data.track.liveRcUrl);
      else if (!liveRcUrl.trim()) setLiveRcUrl("");
      setMessage("Saved.");
      router.refresh();
    } catch {
      setMessage("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (props.locked) {
    return (
      <CardPanel contentClassName="text-sm space-y-2">
        <div className="text-sm font-medium text-foreground">LiveRC track URL</div>
        <input
          // Muted GROUND says "not yours to change"; the text stays foreground because it is a
          // real value, and a muted one reads as the placeholder of an empty box — which is
          // exactly what the Speedhive field above it looks like.
          className="w-full rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-foreground outline-none"
          value={liveRcUrl}
          readOnly
          disabled
          aria-label="LiveRC track URL"
        />
      </CardPanel>
    );
  }

  return (
    <CardPanel contentClassName="text-sm space-y-2">
      <div className="text-sm font-medium text-foreground">LiveRC track URL</div>
      <input
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
        value={liveRcUrl}
        onChange={(e) => setLiveRcUrl(e.target.value)}
        placeholder="https://tftr.liverc.com/"
        autoComplete="off"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className={cn(buttonLinkClassName("primary"), "text-xs px-3 py-1.5", saving && "opacity-70")}
        >
          {saving ? "Saving…" : "Save LiveRC URL"}
        </button>
        {message ? (
          <span className={cn("text-xs", message === "Saved." ? "text-primary-ink" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </CardPanel>
  );
}
