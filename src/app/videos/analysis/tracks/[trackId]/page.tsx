"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TrackCameraProfileEditor } from "@/components/videoAnalysis/TrackCameraProfileEditor";
import { PageBackLink } from "@/components/ui/PageBackLink";

type Profile = { id: string; name: string; sectorLines: unknown[] };

export default function TrackVideoAnalysisPage() {
  const params = useParams();
  const trackId = params.trackId as string;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackName, setTrackName] = useState("");

  useEffect(() => {
    void fetch(`/api/tracks/${trackId}/camera-profiles`)
      .then((r) => r.json())
      .then((d) => {
        setProfiles(d.profiles ?? []);
        setTrackName(d.track?.name ?? "");
        if (d.profiles?.[0]) setSelectedId(d.profiles[0].id);
      });
  }, [trackId]);

  async function createProfile() {
    const res = await fetch(`/api/tracks/${trackId}/camera-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Main camera" }),
    });
    if (!res.ok) return;
    const { profile } = await res.json();
    setProfiles((p) => [profile, ...p]);
    setSelectedId(profile.id);
  }

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/videos/analysis/manual/new" />
          <div>
            <h1 className="page-title">{trackName || "Track"}</h1>
            <p className="page-subtitle">Camera profile & sector lines</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
            onClick={() => void createProfile()}
          >
            New camera profile
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded-md border px-3 py-2 text-xs ${
                selectedId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
              }`}
              onClick={() => setSelectedId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {selectedId && <TrackCameraProfileEditor trackId={trackId} profileId={selectedId} />}
      </section>
    </>
  );
}
