"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { PageBackLink } from "@/components/ui/PageBackLink";

function NewJobForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const trackId = sp.get("trackId") ?? "";
  const profileId = sp.get("profileId") ?? "";
  const initialRunId = sp.get("runId") ?? "";
  const [runId, setRunId] = useState(initialRunId);
  const [localPath, setLocalPath] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function createJob() {
    setMsg(null);
    const res = await fetch("/api/video-analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId,
        profileId,
        runId: runId.trim() || null,
      }),
    });
    if (!res.ok) {
      setMsg("Failed to create job");
      return;
    }
    const { id } = await res.json();
    if (localPath.trim()) {
      sessionStorage.setItem(`video-analysis-local-path:${id}`, localPath.trim());
    }
    router.push(`/videos/analysis/jobs/${id}`);
  }

  return (
    <div className="max-w-lg flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Create a job, run the Python worker on your machine, then import <code>results.json</code> on
        the next screen.
      </p>
      <label className="text-xs">
        Link to Run (optional, for transponder compare)
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          placeholder="Run id"
        />
      </label>
      <label className="text-xs">
        Local video path (reminder only — worker uses this on your PC)
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          placeholder="C:\Videos\heat.mp4"
        />
      </label>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground w-fit"
        onClick={() => void createJob()}
        disabled={!trackId || !profileId}
      >
        Create job
      </button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

export default function NewVideoAnalysisJobPage() {
  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/analysis" />
          <div>
            <h1 className="page-title">New analysis job</h1>
          </div>
        </div>
      </header>
      <section className="page-body">
        <Suspense>
          <NewJobForm />
        </Suspense>
      </section>
    </>
  );
}
