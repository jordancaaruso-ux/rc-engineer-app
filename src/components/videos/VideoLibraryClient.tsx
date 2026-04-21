"use client";

import { useRef, useState } from "react";

type VideoRow = {
  id: string;
  createdAt: string;
  label: string | null;
  originalFilename: string;
  mimeType: string;
  bytes: number;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function VideoLibraryClient({ initialVideos }: { initialVideos: VideoRow[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<VideoRow[]>(initialVideos);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refreshList() {
    const res = await fetch("/api/videos", { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as { videos?: VideoRow[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to refresh list");
    setVideos(data.videos ?? []);
  }

  async function uploadOne(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    if (label.trim()) fd.set("label", label.trim());
    const res = await fetch("/api/videos", { method: "POST", body: fd });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    if (!data.id) throw new Error("Invalid response from upload");
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    e.target.value = "";
    if (!list?.length) return;
    const file = list[0];
    setErr(null);
    setBusy(true);
    try {
      await uploadOne(file);
      setLabel("");
      await refreshList();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Upload error";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-2xl">
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Upload video</div>
        <p className="text-[11px] text-muted-foreground">
          Server uploads are capped on Vercel (roughly 4–4.5MB). For now, keep clips short/small.
        </p>
        <label className="block text-xs">
          <span className="text-muted-foreground">Optional label</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "Q2 lap 3 onboard"'
            disabled={busy}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            className="sr-only"
            onChange={onFilesChosen}
            aria-label="Upload video"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Choose video…"}
          </button>
          <button
            type="button"
            onClick={() => refreshList().catch((e) => setErr(e instanceof Error ? e.message : "Refresh failed"))}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {err ? <div className="text-xs text-destructive">{err}</div> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2 ui-title text-xs uppercase tracking-wide text-muted-foreground">
          Your videos
        </div>
        {videos.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No videos uploaded yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {videos.map((v) => (
              <li key={v.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">
                      {v.label?.trim() ? v.label : v.originalFilename}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatUtc(v.createdAt)} · {formatFileSize(v.bytes)} · {v.mimeType}
                    </div>
                  </div>
                </div>
                <video
                  className="w-full max-w-3xl rounded-md border border-border bg-black"
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/videos/${v.id}/file`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

