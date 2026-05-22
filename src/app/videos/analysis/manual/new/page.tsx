"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  emptyManualSession,
  type ManualVideoSessionV1,
  type ManualDriver,
} from "@/lib/manualVideoAnalysis/types";
import {
  applyDefaultLapSelection,
  defaultDriverKeys,
  setDriverRoles,
} from "@/lib/manualVideoAnalysis/timing";

function NewManualAnalysisForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const presetTrackId = sp.get("trackId") ?? "";
  const presetProfileId = sp.get("profileId") ?? "";
  const presetRunId = sp.get("runId") ?? "";

  const [tracks, setTracks] = useState<Array<{ id: string; name: string }>>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [trackId, setTrackId] = useState(presetTrackId);
  const [profileId, setProfileId] = useState(presetProfileId);
  const [runId, setRunId] = useState(presetRunId);
  const [timingUrl, setTimingUrl] = useState("");
  const [useRun, setUseRun] = useState(Boolean(presetRunId));
  const [drivers, setDrivers] = useState<ManualDriver[]>([]);
  const [meKey, setMeKey] = useState("");
  const [competitorKey, setCompetitorKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function loadDrivers() {
    setLoading(true);
    setMsg(null);
    if (useRun && runId.trim()) {
      const res = await fetch(
        `/api/video-analysis/manual/session-drivers?runId=${encodeURIComponent(runId.trim())}`
      );
      setLoading(false);
      if (!res.ok) {
        setMsg("Could not load laps from run (need imported lap sets)");
        return;
      }
      const d = await res.json();
      applyLoadedDrivers(d.drivers ?? [], d.defaults);
      return;
    }
    if (!timingUrl.trim()) {
      setLoading(false);
      setMsg("Enter timing URL or link a Run");
      return;
    }
    const res = await fetch("/api/video-analysis/manual/parse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: timingUrl.trim() }),
    });
    setLoading(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg((err as { error?: string }).error ?? "Parse failed");
      return;
    }
    const d = await res.json();
    applyLoadedDrivers(d.drivers ?? [], d.defaults);
  }

  function applyLoadedDrivers(
    list: ManualDriver[],
    defaults?: { meKey: string; competitorKey: string }
  ) {
    setDrivers(list);
    const keys = defaults ?? defaultDriverKeys(list);
    setMeKey(keys.meKey);
    setCompetitorKey(keys.competitorKey);
    if (list.length < 2) {
      setMsg("Need at least two drivers in the timing data to compare.");
    } else if (!keys.meKey || !keys.competitorKey) {
      setMsg("Select yourself (Me) and a competitor in the dropdowns below.");
    } else {
      setMsg(null);
    }
  }

  async function createJob() {
    if (!trackId) {
      setMsg("Select a track.");
      return;
    }
    if (!profileId) {
      setMsg("Select a camera profile (or create one for this track).");
      return;
    }
    if (!meKey) {
      setMsg("Select yourself in the Me dropdown.");
      return;
    }
    if (!competitorKey) {
      setMsg("Select a competitor in the Competitor dropdown.");
      return;
    }
    if (meKey === competitorKey) {
      setMsg("Me and competitor must be different drivers.");
      return;
    }
    let session: ManualVideoSessionV1 = {
      ...emptyManualSession(),
      timingSource: useRun && runId.trim() ? "run" : "url",
      timingUrl: useRun ? null : timingUrl.trim(),
      drivers: setDriverRoles(drivers, meKey, competitorKey),
    };
    session = applyDefaultLapSelection(session);

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
    if (!res.ok) {
      setMsg("Failed to create session");
      return;
    }
    const { id } = await res.json();
    router.push(`/videos/analysis/jobs/${id}`);
  }

  return (
    <div className="max-w-lg flex flex-col gap-4 text-sm">
      <label className="text-xs">
        Track
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          value={trackId}
          onChange={(e) => {
            setTrackId(e.target.value);
            setProfileId("");
            setDrivers([]);
            setMeKey("");
            setCompetitorKey("");
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

      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" checked={useRun} onChange={() => setUseRun(true)} />
          Linked Run
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={!useRun} onChange={() => setUseRun(false)} />
          Timing URL
        </label>
      </div>

      {useRun ? (
        <label className="text-xs">
          Run id
          <input
            className="mt-1 w-full rounded-md border border-border px-2 py-1 font-mono text-xs"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            placeholder="From run edit page"
          />
        </label>
      ) : (
        <label className="text-xs">
          LiveRC / timing URL
          <input
            className="mt-1 w-full rounded-md border border-border px-2 py-1"
            value={timingUrl}
            onChange={(e) => setTimingUrl(e.target.value)}
            placeholder="https://..."
          />
        </label>
      )}

      <button
        type="button"
        className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted w-fit"
        disabled={loading}
        onClick={() => void loadDrivers()}
      >
        {loading ? "Loading…" : "Load drivers & laps"}
      </button>

      {drivers.length > 0 && (
        <>
          <label className="text-xs">
            Me
            <select
              className="mt-1 w-full rounded-md border border-border px-2 py-1"
              value={meKey}
              onChange={(e) => setMeKey(e.target.value)}
            >
              {drivers.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.driverName} ({d.laps.length} laps)
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Competitor
            <select
              className="mt-1 w-full rounded-md border border-border px-2 py-1"
              value={competitorKey}
              onChange={(e) => setCompetitorKey(e.target.value)}
            >
              {drivers.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.driverName} ({d.laps.length} laps)
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            All laps are included by default; discard outliers (e.g. race lap 1) on the analysis page.
          </p>
        </>
      )}

      <button
        type="button"
        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground w-fit"
        onClick={() => void createJob()}
      >
        Start manual analysis
      </button>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <Link href="/videos/analysis" className="text-xs underline">
        ← Hub
      </Link>
    </div>
  );
}

export default function NewManualVideoAnalysisPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Manual sector analysis</h1>
          <p className="page-subtitle">
            Sync SF to transponder, mark sector crossings on video, compare best laps.
          </p>
        </div>
      </header>
      <section className="page-body">
        <Suspense>
          <NewManualAnalysisForm />
        </Suspense>
      </section>
    </>
  );
}
