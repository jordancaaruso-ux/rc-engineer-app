"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";

export function TrackLiveRcUrlEditor(props: {
  trackId: string;
  initialLiveRcUrl: string | null;
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

  return (
    <CardPanel contentClassName="text-sm space-y-2">
      <div className="text-sm font-medium text-foreground">LiveRC track URL</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Paste the track home page (e.g. https://tftr.liverc.com/). Lap times discovery uses this to find your most
        recent sessions without a daily URL.
      </p>
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
          <span className={cn("text-xs", message === "Saved." ? "text-accent" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </CardPanel>
  );
}
