"use client";

import { useRef, useState } from "react";
import { ChipListField } from "@/components/settings/ChipListField";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";
import {
  formatSpeedhiveDriverNamesForSetting,
  parseSpeedhiveDriverNamesSetting,
} from "@/lib/speedhive/speedhiveDriverNames";

type InitialSettings = {
  myName: string;
  liveRcDriverName: string;
  /** LiveRC `data-driver-id` when known; disambiguates same name on A/B/C mains. */
  liveRcDriverId: string;
  /** Speedhive display name; empty uses LiveRC driver name when set. */
  speedhiveDriverName: string;
  /** Comma-separated MYLAPS transponder numbers for Speedhive discovery at a track. */
  speedhiveTransponderNumbers: string;
  /** They race a club or loaner chip, so there is no number that stays theirs. */
  speedhiveTransponderLoaner: boolean;
};

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok" }
  | { kind: "error"; text: string };

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
  const [transponderLoaner, setTransponderLoaner] = useState(initial.speedhiveTransponderLoaner);
  const [savingLoaner, setSavingLoaner] = useState<SaveState>({ kind: "idle" });

  const MAX_RETRIES = 3;

  async function postSetting(
    url: string,
    payload: Record<string, string | boolean | null>,
    setState: (s: SaveState) => void,
    attempt = 0
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
      // Auto-retry with backoff — there's no Save button to click, so recovery
      // has to be automatic. The typed value stays in state throughout, so
      // nothing is lost even if every attempt fails.
      if (attempt < MAX_RETRIES) {
        setState({ kind: "error", text: "Couldn’t save — retrying…" });
        await new Promise((r) => window.setTimeout(r, 1500 * (attempt + 1)));
        return postSetting(url, payload, setState, attempt + 1);
      }
      setState({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn’t save — check your connection",
      });
      return false;
    }
  }

  return (
    <div className="space-y-5">
      <SettingField
        label="Your display name"
        value={myName}
        onChange={setMyName}
        onSave={() => postSetting("/api/settings/my-name", { myName: myName.trim() || null }, setSavingMyName)}
        state={savingMyName}
      />

      <SettingField
        label="LiveRC driver name"
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

      <ChipListField<number>
        id="speedhive-transponder-input"
        label="MYLAPS transponder numbers"
        initialText={speedhiveTransponderNumbers}
        parse={parseSpeedhiveTransponderNumbersSetting}
        format={formatSpeedhiveTransponderNumbersForSetting}
        state={savingSpeedhiveTransponder}
        inputMode="numeric"
        chipMono
        // Numbers can't contain either, so both are natural separators.
        commitKeys={["Enter", ",", " "]}
        placeholder="e.g. 1234567"
        invalidHint="Transponder numbers are digits only."
        hint="Add every chip you own — race, practice, spare, the one in a loaner. Any of them matches a session, so you only do this once."
        onSave={(text) => {
          setSpeedhiveTransponderNumbers(text ?? "");
          // The server clears the loaner flag the moment a real number lands; mirror that here
          // so the box doesn't sit ticked against a number that supersedes it.
          if (parseSpeedhiveTransponderNumbersSetting(text).length > 0) setTransponderLoaner(false);
          return postSetting(
            "/api/settings/speedhive-driver",
            { speedhiveTransponderNumbers: text },
            setSavingSpeedhiveTransponder
          );
        }}
      />

      {/*
       * The way out for a driver who has no number of their own.
       *
       * `speedhiveTransponderLoanerAt` has always satisfied `hasTimingIdentity`, and the API has
       * always accepted it — but nothing ever put it on screen, so a club or loaner-chip racer was
       * asked for a number they cannot give and had no way to say so. Their timing row could never
       * be completed. Found by driving the first-run flow, 2026-08-13.
       *
       * Ticking it is a statement, not a preference, so it saves immediately like every other
       * field here — there is no Save button on this page.
       */}
      <label className="flex cursor-pointer items-start gap-2.5 pt-1">
        <input
          type="checkbox"
          checked={transponderLoaner}
          disabled={parseSpeedhiveTransponderNumbersSetting(speedhiveTransponderNumbers).length > 0}
          onChange={(e) => {
            const next = e.target.checked;
            setTransponderLoaner(next);
            void postSetting(
              "/api/settings/speedhive-driver",
              { speedhiveTransponderLoaner: next },
              setSavingLoaner
            );
          }}
          className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-50"
        />
        <span className="min-w-0">
          <span className="block text-sm text-foreground">
            I don&rsquo;t have my own chip &mdash; the number changes
          </span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">
            Club or loaner transponder. We&rsquo;ll match your sessions on your name instead.
            {parseSpeedhiveTransponderNumbersSetting(speedhiveTransponderNumbers).length > 0
              ? " Not needed while you have a number saved above."
              : ""}
            {savingLoaner.kind === "error" ? ` ${savingLoaner.text}` : ""}
          </span>
        </span>
      </label>

      {/* Not redundant with the chips above: a transponder only matches when
          MYLAPS actually publishes one on the classification row, and plenty of
          sessions don't carry the field at all. The name is what
          `classificationRowMatchesUser` falls back to then — and it is the only
          matcher at all for anyone racing a club or loaner chip. */}
      <ChipListField<string>
        id="speedhive-driver-name-input"
        label="Speedhive driver names"
        initialText={speedhiveDriverName}
        parse={parseSpeedhiveDriverNamesSetting}
        format={formatSpeedhiveDriverNamesForSetting}
        state={savingSpeedhiveDriver}
        // Enter only: a name contains spaces, and sheets print "Caruso, Jordan".
        commitKeys={["Enter"]}
        placeholder="e.g. Jordan Smith"
        invalidHint="Type the name as the timing sheet prints it."
        hint="Every spelling you show up under — each club types it differently, and a chip registered to someone else prints their name. Any one matching counts."
        onSave={(text) => {
          setSpeedhiveDriverName(text ?? "");
          return postSetting(
            "/api/settings/speedhive-driver",
            { speedhiveDriverName: text },
            setSavingSpeedhiveDriver
          );
        }}
      />

      <div className="space-y-1 text-sm">
        <label className="block text-sm font-medium text-foreground">LiveRC driver ID</label>
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
  value,
  onChange,
  onSave,
  state,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => Promise<boolean>;
  state: SaveState;
  placeholder?: string;
  /** One line under the field saying what it's actually for. */
  hint?: string;
}) {
  // Last value we've committed to the server. Blur only writes when the trimmed
  // value differs, so tabbing through untouched fields costs nothing.
  const committed = useRef(value);

  async function commit() {
    if (value.trim() === committed.current.trim()) return;
    const ok = await onSave();
    if (ok) committed.current = value;
  }

  return (
    <div className="space-y-1 text-sm">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
        />
        {state.kind === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : null}
        {state.kind === "ok" ? <span className="ui-caption text-emerald-600">Saved.</span> : null}
        {state.kind === "error" ? (
          <span className="ui-caption text-destructive">{state.text}</span>
        ) : null}
      </div>
      {hint ? <p className="ui-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
