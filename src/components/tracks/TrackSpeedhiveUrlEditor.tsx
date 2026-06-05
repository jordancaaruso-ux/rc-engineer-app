"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

export function TrackSpeedhiveUrlEditor(props: {
  trackId: string;
  initialSpeedhiveUrl: string | null;
}) {
  const router = useRouter();
  const [speedhiveUrl, setSpeedhiveUrl] = useState(props.initialSpeedhiveUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(props.trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speedhiveUrl: speedhiveUrl.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        track?: { speedhiveUrl?: string | null };
      };
      if (!res.ok) {
        setMessage(data.error ?? "Could not save.");
        return;
      }
      if (data.track?.speedhiveUrl != null) setSpeedhiveUrl(data.track.speedhiveUrl);
      else if (!speedhiveUrl.trim()) setSpeedhiveUrl("");
      setMessage("Saved.");
      router.refresh();
    } catch {
      setMessage("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm space-y-2">
      <div className="text-sm font-medium text-foreground">Speedhive track URL</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Paste the track&apos;s Speedhive practice page (e.g.{" "}
        <span className="font-mono text-foreground/90">speedhive.mylaps.com/practice/4591</span>
        ). We use your MYLAPS transponder from Settings to find your practice sessions at that
        track. Organization URLs (…/organizations/…) still work for race day results.
      </p>
      <input
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
        value={speedhiveUrl}
        onChange={(e) => setSpeedhiveUrl(e.target.value)}
        placeholder="https://speedhive.mylaps.com/practice/4591"
        autoComplete="off"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className={cn(buttonLinkClassName("primary"), "text-xs px-3 py-1.5", saving && "opacity-70")}
        >
          {saving ? "Saving…" : "Save Speedhive URL"}
        </button>
        {message ? (
          <span className={cn("text-xs", message === "Saved." ? "text-accent" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
