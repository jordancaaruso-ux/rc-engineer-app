"use client";

import { useState } from "react";

type InitialSettings = {
  myName: string;
  liveRcDriverName: string;
  currentPracticeDayUrl: string;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "ok" } | { kind: "error"; text: string };

export function SettingsClient({ initial }: { initial: InitialSettings }) {
  const [myName, setMyName] = useState(initial.myName);
  const [liveRcDriverName, setLiveRcDriverName] = useState(initial.liveRcDriverName);
  const [currentPracticeDayUrl, setCurrentPracticeDayUrl] = useState(initial.currentPracticeDayUrl);
  const [savingMyName, setSavingMyName] = useState<SaveState>({ kind: "idle" });
  const [savingDriver, setSavingDriver] = useState<SaveState>({ kind: "idle" });
  const [savingDayUrl, setSavingDayUrl] = useState<SaveState>({ kind: "idle" });

  async function postSetting(
    url: string,
    payload: Record<string, string | null>,
    setState: (s: SaveState) => void
  ) {
    setState({ kind: "saving" });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setState({ kind: "ok" });
      window.setTimeout(() => setState({ kind: "idle" }), 1600);
    } catch (err) {
      setState({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save",
      });
    }
  }

  return (
    <div className="space-y-8">
      <SettingField
        label="Your display name"
        hint="Shown on your runs. Purely cosmetic."
        value={myName}
        onChange={setMyName}
        onSave={() => postSetting("/api/settings/my-name", { myName: myName.trim() || null }, setSavingMyName)}
        state={savingMyName}
      />

      <SettingField
        label="LiveRC driver name"
        hint="Used by Lap Times to match your sessions on a practice day URL. Must match how the timing page spells your name."
        value={liveRcDriverName}
        onChange={setLiveRcDriverName}
        onSave={() =>
          postSetting(
            "/api/settings/live-rc-driver",
            { liveRcDriverName: liveRcDriverName.trim() || null },
            setSavingDriver
          )
        }
        state={savingDriver}
        placeholder="e.g. Jordan Smith"
      />

      <SettingField
        label="Current practice day URL"
        hint={
          "Paste the day's LiveRC session list (e.g. /practice/?p=session_list&d=YYYY-MM-DD). " +
          "Log Your Run will pre-fill this under Testing sessions so Lap Times can pull your laps automatically."
        }
        value={currentPracticeDayUrl}
        onChange={setCurrentPracticeDayUrl}
        onSave={() =>
          postSetting(
            "/api/settings/current-practice-day-url",
            { currentPracticeDayUrl: currentPracticeDayUrl.trim() || null },
            setSavingDayUrl
          )
        }
        state={savingDayUrl}
        placeholder="https://example.liverc.com/…/practice/?p=session_list&d=2026-04-20"
      />
    </div>
  );
}

function SettingField({
  label,
  hint,
  value,
  onChange,
  onSave,
  state,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  state: SaveState;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1 text-sm">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-w-[260px] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/50"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={state.kind === "saving"}
          className="rounded-md border border-border bg-muted/70 px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {state.kind === "ok" ? <span className="text-[11px] text-emerald-600">Saved.</span> : null}
        {state.kind === "error" ? (
          <span className="text-[11px] text-destructive">{state.text}</span>
        ) : null}
      </div>
    </div>
  );
}
