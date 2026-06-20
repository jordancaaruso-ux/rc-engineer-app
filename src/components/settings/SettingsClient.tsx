"use client";

import { useState } from "react";

type InitialSettings = {
  myName: string;
  liveRcDriverName: string;
  /** LiveRC `data-driver-id` when known; disambiguates same name on A/B/C mains. */
  liveRcDriverId: string;
  /** Speedhive display name; empty uses LiveRC driver name when set. */
  speedhiveDriverName: string;
  /** Comma-separated MYLAPS transponder numbers for Speedhive discovery at a track. */
  speedhiveTransponderNumbers: string;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "ok" } | { kind: "error"; text: string };

export function SettingsClient({ initial }: { initial: InitialSettings }) {
  const [myName, setMyName] = useState(initial.myName);
  const [liveRcDriverName, setLiveRcDriverName] = useState(initial.liveRcDriverName);
  const [liveRcDriverId, setLiveRcDriverId] = useState(initial.liveRcDriverId);
  const [speedhiveDriverName, setSpeedhiveDriverName] = useState(initial.speedhiveDriverName);
  const [speedhiveTransponderNumbers, setSpeedhiveTransponderNumbers] = useState(
    initial.speedhiveTransponderNumbers
  );
  const [savingMyName, setSavingMyName] = useState<SaveState>({ kind: "idle" });
  const [savingDriver, setSavingDriver] = useState<SaveState>({ kind: "idle" });
  const [savingDriverId, setSavingDriverId] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveDriver, setSavingSpeedhiveDriver] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveTransponder, setSavingSpeedhiveTransponder] = useState<SaveState>({
    kind: "idle",
  });

  async function postSetting(
    url: string,
    payload: Record<string, string | null>,
    setState: (s: SaveState) => void
  ): Promise<boolean> {
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
      return true;
    } catch (err) {
      setState({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save",
      });
      return false;
    }
  }

  return (
    <div className="space-y-5">
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
        hint="Must match how timing pages spell your name. Used together with your LiveRC driver ID so A/B/C mains don’t get mixed up with someone who shares your name."
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
        label="MYLAPS transponder number(s)"
        hint="Used with each track’s Speedhive organization URL to find your sessions (no MYLAPS login). Separate multiple chips with commas."
        value={speedhiveTransponderNumbers}
        onChange={setSpeedhiveTransponderNumbers}
        onSave={() =>
          postSetting(
            "/api/settings/speedhive-driver",
            {
              speedhiveTransponderNumbers: speedhiveTransponderNumbers.trim() || null,
            },
            setSavingSpeedhiveTransponder
          )
        }
        state={savingSpeedhiveTransponder}
        placeholder="e.g. 1234567"
      />

      <SettingField
        label="Speedhive driver name"
        hint="Fallback when public results do not list transponder numbers. Leave blank to use your LiveRC driver name above."
        value={speedhiveDriverName}
        onChange={setSpeedhiveDriverName}
        onSave={() =>
          postSetting(
            "/api/settings/speedhive-driver",
            { speedhiveDriverName: speedhiveDriverName.trim() || null },
            setSavingSpeedhiveDriver
          )
        }
        state={savingSpeedhiveDriver}
        placeholder="e.g. Jordan Smith"
      />

      <div className="space-y-1 text-sm">
        <label className="block text-sm font-medium text-foreground">LiveRC driver ID</label>
        <p className="ui-caption">
          From LiveRC result tables (<code className="text-[10px]">data-driver-id</code>). Usually filled automatically
          when you import a race or open “Your sessions at this event.” Clear it if results pick the wrong person.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            readOnly
            value={liveRcDriverId}
            placeholder="(not set yet)"
            className="w-full min-w-[260px] flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-muted-foreground outline-none"
          />
          <button
            type="button"
            disabled={!liveRcDriverId.trim() || savingDriverId.kind === "saving"}
            onClick={async () => {
              const ok = await postSetting(
                "/api/settings/live-rc-driver",
                { liveRcDriverId: null },
                setSavingDriverId
              );
              if (ok) setLiveRcDriverId("");
            }}
            className="rounded-md border border-border bg-muted/70 px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            Clear ID
          </button>
          {savingDriverId.kind === "ok" ? <span className="ui-caption text-emerald-600">Cleared.</span> : null}
          {savingDriverId.kind === "error" ? (
            <span className="ui-caption text-destructive">{savingDriverId.text}</span>
          ) : null}
        </div>
      </div>
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
      {hint ? <p className="ui-caption">{hint}</p> : null}
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
        {state.kind === "ok" ? <span className="ui-caption text-emerald-600">Saved.</span> : null}
        {state.kind === "error" ? (
          <span className="ui-caption text-destructive">{state.text}</span>
        ) : null}
      </div>
    </div>
  );
}
