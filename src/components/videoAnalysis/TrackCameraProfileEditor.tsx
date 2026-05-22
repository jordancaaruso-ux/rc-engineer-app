"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SectorLineCanvas, type SectorLineNorm } from "./SectorLineCanvas";

type Profile = {
  id: string;
  name: string;
  referenceImagePath: string | null;
  sectorLines: SectorLineNorm[];
  track: { id: string; name: string };
};

export function TrackCameraProfileEditor({
  trackId,
  profileId,
}: {
  trackId: string;
  profileId: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lines, setLines] = useState<SectorLineNorm[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>("sf");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [workerConfig, setWorkerConfig] = useState<object | null>(null);

  const refUrl = profile?.referenceImagePath
    ? `/api/video-analysis/profiles/${profileId}/reference`
    : null;

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/profiles/${profileId}`);
    if (!res.ok) return;
    const data = await res.json();
    const p = data.profile as Profile & { sectorLines: SectorLineNorm[] };
    setProfile({ ...p, track: data.profile.track });
    setLines(
      p.sectorLines.map((l) => ({
        lineKey: l.lineKey,
        label: l.label,
        x1: l.x1,
        y1: l.y1,
        x2: l.x2,
        y2: l.y2,
        sortOrder: l.sortOrder,
      }))
    );
    setWorkerConfig(data.workerConfig ?? null);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveLines() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/video-analysis/profiles/${profileId}/sectors`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    setSaving(false);
    if (!res.ok) {
      setMsg("Failed to save lines");
      return;
    }
    setMsg("Sector lines saved");
    void load();
  }

  async function uploadReference(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/video-analysis/profiles/${profileId}/reference`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      setMsg("Reference upload failed");
      return;
    }
    setMsg("Reference image uploaded");
    void load();
  }

  function addSector() {
    const n = lines.filter((l) => l.lineKey.startsWith("s")).length + 1;
    const key = `s${n}`;
    setLines([
      ...lines,
      {
        lineKey: key,
        label: `Sector ${n}`,
        x1: 0.4,
        y1: 0.4,
        x2: 0.6,
        y2: 0.4,
        sortOrder: lines.length,
      },
    ]);
    setActiveKey(key);
  }

  function removeActive() {
    if (!activeKey || activeKey === "sf") return;
    setLines(lines.filter((l) => l.lineKey !== activeKey));
    setActiveKey("sf");
  }

  if (!profile) {
    return <p className="text-sm text-muted-foreground">Loading profile…</p>;
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/videos/analysis/tracks/${trackId}`} className="underline text-muted-foreground">
          ← {profile.track.name}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{profile.name}</span>
      </div>

      <SectorLineCanvas
        imageUrl={refUrl}
        lines={lines}
        activeLineKey={activeKey}
        onLinesChange={setLines}
        onActiveLineKey={setActiveKey}
      />

      <div className="flex flex-wrap gap-2">
        <label className="rounded-md border border-border px-3 py-2 text-xs cursor-pointer hover:bg-muted">
          Upload reference still
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadReference(f);
            }}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
          onClick={addSector}
        >
          Add sector line
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
          disabled={!activeKey || activeKey === "sf"}
          onClick={removeActive}
        >
          Remove selected line
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
          disabled={saving}
          onClick={() => void saveLines()}
        >
          {saving ? "Saving…" : "Save lines"}
        </button>
        <Link
          href={`/videos/analysis/jobs/new?trackId=${trackId}&profileId=${profileId}`}
          className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
        >
          New analysis job →
        </Link>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

      <details className="rounded-lg border border-border bg-card p-3 text-xs">
        <summary className="cursor-pointer font-medium">Worker config (for Python CLI)</summary>
        <pre className="mt-2 overflow-auto max-h-48 text-[10px]">
          {JSON.stringify(workerConfig, null, 2)}
        </pre>
        <p className="mt-2 text-muted-foreground">
          Save as <code>config.json</code> and run:{" "}
          <code>python -m rc_video_analysis analyze --video heat.mp4 --config config.json --output results.json</code>
        </p>
      </details>
    </div>
  );
}
