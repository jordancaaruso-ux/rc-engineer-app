"use client";

import { useState } from "react";

export function EventLapSourcesPanel(props: {
  eventId: string;
  practiceSourceUrl: string | null;
  resultsSourceUrl: string | null;
  raceClass: string | null;
}) {
  const [practice, setPractice] = useState(props.practiceSourceUrl ?? "");
  const [results, setResults] = useState(props.resultsSourceUrl ?? "");
  const [raceClass, setRaceClass] = useState(props.raceClass ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(props.eventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceSourceUrl: practice.trim() || null,
          resultsSourceUrl: results.trim() || null,
          raceClass: raceClass.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(typeof j.error === "string" ? j.error : "Could not save");
        return;
      }
      setMessage("Saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm shadow-black/20">
      <h2 className="text-sm font-medium text-foreground">LiveRC lap detection</h2>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Paste practice list or results index URLs. The app matches your LiveRC driver name and surfaces prompts on the dashboard when new sessions appear.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Practice session list URL</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={practice}
            onChange={(e) => setPractice(e.target.value)}
            placeholder="https://…/practice?p=session_list"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Results index URL</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={results}
            onChange={(e) => setResults(e.target.value)}
            placeholder="https://…/results"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Race class (must match results row)</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={raceClass}
            onChange={(e) => setRaceClass(e.target.value)}
            placeholder="e.g. 17.5 Stock Buggy"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save sources"}
        </button>
        {message ? <span className="text-[11px] text-muted-foreground">{message}</span> : null}
      </div>
    </div>
  );
}
