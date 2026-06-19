"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { useRouter, useSearchParams } from "next/navigation";
import { emptyManualSession } from "@/lib/manualVideoAnalysis/types";

function NewLapSyncForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const presetTrackId = sp.get("trackId") ?? "";
  const presetProfileId = sp.get("profileId") ?? "";
  const presetRunId = sp.get("runId") ?? "";

  const [tracks, setTracks] = useState<Array<{ id: string; name: string }>>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [trackId, setTrackId] = useState(presetTrackId);
  const [profileId, setProfileId] = useState(presetProfileId);
  const [runId] = useState(presetRunId);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetch("/api/tracks")
      .then((r) => r.json())
      .catch(() => ({ tracks: [] }))
      .then((d) => {
        const list = d.tracks ?? d;
        if (Array.isArray(list)) setTracks(list);
      });
  }, []);

  useEffect(() => {
    if (!trackId) {
      setProfiles([]);
      setProfileId("");
      return;
    }
    void fetch(`/api/tracks/${trackId}/camera-profiles`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.profiles ?? [];
        setProfiles(list);
        setProfileId((prev) => {
          if (prev && list.some((p: { id: string }) => p.id === prev)) return prev;
          return list[0]?.id ?? "";
        });
      });
  }, [trackId]);

  async function createJob() {
    if (!trackId) {
      setMsg("Select a track.");
      return;
    }
    if (!profileId) {
      setMsg("Select a camera profile (or create one for this track).");
      return;
    }

    setCreating(true);
    setMsg(null);

    const session = {
      ...emptyManualSession(),
      timingSource: runId.trim() ? ("run" as const) : ("url" as const),
      compare: { my: null, competitor: null, alignAt: "sf_start" as const },
    };

    const res = await fetch("/api/video-analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId,
        profileId,
        runId: runId.trim() || null,
        analysisMode: "manual",
        manualJson: session,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      setMsg("Failed to create session");
      return;
    }
    const { id } = await res.json();
    router.push(`/videos/analysis/jobs/${id}`);
  }

  return (
    <CardPanel className="max-w-lg" contentClassName="flex flex-col gap-4 text-sm">
      <label className="text-xs">
        Track
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          value={trackId}
          onChange={(e) => {
            setTrackId(e.target.value);
            setProfileId("");
          }}
        >
          <option value="">Select track</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        Camera profile
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          disabled={!trackId}
        >
          <option value="">Select profile</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {trackId && profiles.length === 0 && (
          <Link
            href={`/videos/analysis/tracks/${trackId}`}
            className="text-xs underline block mt-1"
          >
            Create camera profile first
          </Link>
        )}
      </label>

      <p className="text-xs text-muted-foreground">
        Upload your video on the next screen. LiveRC timing links are optional — add them there when
        you want lap sync and compare.
      </p>

      <button
        type="button"
        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground w-fit disabled:opacity-50"
        disabled={creating}
        onClick={() => void createJob()}
      >
        {creating ? "Starting…" : "Start video analysis"}
      </button>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <Link href="/videos" className="text-xs underline">
        ← Videos
      </Link>
    </CardPanel>
  );
}

export default function NewManualVideoAnalysisPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Video lap sync</h1>
          <p className="page-subtitle">
            Watch your video, optionally link LiveRC laps, anchor SF, and compare drivers.
          </p>
        </div>
      </header>
      <section className="page-body">
        <Suspense>
          <NewLapSyncForm />
        </Suspense>
      </section>
    </>
  );
}
