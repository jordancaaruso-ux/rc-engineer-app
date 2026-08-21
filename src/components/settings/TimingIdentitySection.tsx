"use client";

import { useRef, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { ChipListField } from "@/components/settings/ChipListField";
import { postSetting, SaveNote, type SaveState } from "@/components/settings/saveState";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";
import {
  formatSpeedhiveDriverNamesForSetting,
  parseSpeedhiveDriverNamesSetting,
} from "@/lib/speedhive/speedhiveDriverNames";

/**
 * Timing & results — everything that lets a lap import find you, under one heading.
 *
 * Resectioned 2026-08-18. These fields used to sit naked at the top of Settings with
 * nothing naming the group, so each one had to explain in its own hint *why it existed*
 * — 50+ words between two of them. The section heading says it once now, and the hints
 * are down to what the field itself needs.
 *
 * Two removals in the same pass, both founder calls:
 *   · The "I don't have my own chip" checkbox. `speedhiveTransponderLoanerAt` still
 *     satisfies `hasTimingIdentity` and the API still accepts it, so anyone who already
 *     ticked it keeps working — there is just no longer a way to tick it. A driver on a
 *     borrowed club chip isn't who this app is for.
 *   · The LiveRC driver ID text box. It was read-only and machine-assigned; it is a
 *     caption with a Clear link now, and only when there is one.
 */

type InitialTiming = {
  liveRcDriverName: string;
  /** LiveRC `data-driver-id` when known; disambiguates same name on A/B/C mains. */
  liveRcDriverId: string;
  /** Comma-separated MYLAPS transponder numbers for Speedhive discovery at a track. */
  speedhiveTransponderNumbers: string;
  /** Speedhive display names; empty uses the LiveRC driver name when set. */
  speedhiveDriverName: string;
  /** MyRCM display name; empty falls back to the MYLAPS then LiveRC names. */
  myRcmDriverName: string;
};

export function TimingIdentitySection({ initial }: { initial: InitialTiming }) {
  const [liveRcDriverName, setLiveRcDriverName] = useState(initial.liveRcDriverName);
  const [liveRcDriverId, setLiveRcDriverId] = useState(initial.liveRcDriverId);
  const [speedhiveDriverName, setSpeedhiveDriverName] = useState(initial.speedhiveDriverName);
  const [speedhiveTransponderNumbers, setSpeedhiveTransponderNumbers] = useState(
    initial.speedhiveTransponderNumbers
  );
  const [myRcmDriverName, setMyRcmDriverName] = useState(initial.myRcmDriverName);
  const [savingDriver, setSavingDriver] = useState<SaveState>({ kind: "idle" });
  const [savingMyRcmDriver, setSavingMyRcmDriver] = useState<SaveState>({ kind: "idle" });
  const [savingDriverId, setSavingDriverId] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveDriver, setSavingSpeedhiveDriver] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveTransponder, setSavingSpeedhiveTransponder] = useState<SaveState>({
    kind: "idle",
  });

  // Last value committed to the server. Blur only writes when the trimmed value
  // differs, so tabbing through an untouched field costs nothing.
  const committedLiveRc = useRef(initial.liveRcDriverName);
  const committedMyRcm = useRef(initial.myRcmDriverName);

  async function commitLiveRcName() {
    if (liveRcDriverName.trim() === committedLiveRc.current.trim()) return;
    const ok = await postSetting(
      "/api/settings/live-rc-driver",
      { liveRcDriverName: liveRcDriverName.trim() || null },
      setSavingDriver
    );
    if (ok) committedLiveRc.current = liveRcDriverName;
  }

  async function commitMyRcmName() {
    if (myRcmDriverName.trim() === committedMyRcm.current.trim()) return;
    const ok = await postSetting(
      "/api/settings/myrcm-driver",
      { myRcmDriverName: myRcmDriverName.trim() || null },
      setSavingMyRcmDriver
    );
    if (ok) committedMyRcm.current = myRcmDriverName;
  }

  return (
    <CardPanel contentClassName="p-0">
      {/* Heading and its one line of context both sit IN the card now (2026-08-18) — see
          the note in YouSection. The hint travels with the label: it explains the section,
          not any single field, so it belongs under the same hairline. */}
      <div className="px-4 pt-3.5">
        <Eyebrow>Timing &amp; results</Eyebrow>
        <p className="ui-caption">How we spot your runs on LiveRC and MYLAPS.</p>
      </div>
      <div className="space-y-1.5 px-4 pb-3.5 pt-3">
        <ChipListField<number>
          id="speedhive-transponder-input"
          label="Transponder numbers"
          initialText={speedhiveTransponderNumbers}
          parse={parseSpeedhiveTransponderNumbersSetting}
          format={formatSpeedhiveTransponderNumbersForSetting}
          state={savingSpeedhiveTransponder}
          inputMode="numeric"
          chipMono
          // Numbers can't contain either, so both are natural separators.
          commitKeys={["Enter", ",", " "]}
          placeholder="e.g. 1234567"
          addLabel="Add transponder number"
          invalidHint="Transponder numbers are digits only."
          hint="Every chip you race with — spares included."
          onSave={(text) => {
            setSpeedhiveTransponderNumbers(text ?? "");
            return postSetting(
              "/api/settings/speedhive-driver",
              { speedhiveTransponderNumbers: text },
              setSavingSpeedhiveTransponder
            );
          }}
        />
      </div>

      <div className="space-y-1.5 border-t border-border px-4 py-3.5 text-sm">
        <label htmlFor="liverc-driver-name" className="block text-sm font-medium text-foreground">
          Name on LiveRC
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="liverc-driver-name"
            type="text"
            value={liveRcDriverName}
            onChange={(e) => setLiveRcDriverName(e.target.value)}
            onBlur={() => void commitLiveRcName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="e.g. Jordan Smith"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
          />
          <SaveNote state={savingDriver} />
        </div>
        {/*
         * The ID is machine-assigned — LiveRC's own `data-driver-id`, learned the first time
         * an import matches you, never typed. It was a read-only text box with a Clear button
         * beside it, which gave plumbing the same weight as the fields you actually fill.
         */}
        {liveRcDriverId.trim() ? (
          <p className="ui-caption flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <span className="tabular-nums">Matched to LiveRC ID {liveRcDriverId}</span>
            <button
              type="button"
              disabled={savingDriverId.kind === "saving"}
              onClick={async () => {
                const ok = await postSetting(
                  "/api/settings/live-rc-driver",
                  { liveRcDriverId: null },
                  setSavingDriverId
                );
                if (ok) setLiveRcDriverId("");
              }}
              className="font-medium text-primary-ink underline underline-offset-2 disabled:opacity-60"
            >
              Clear
            </button>
            {savingDriverId.kind === "error" ? (
              <span className="text-destructive">{savingDriverId.text}</span>
            ) : null}
          </p>
        ) : (
          <p className="ui-caption text-muted-foreground">Exactly as the timing sheet prints it.</p>
        )}
      </div>

      {/* Not redundant with the chips above: a transponder only matches when MYLAPS actually
          publishes one on the classification row, and plenty of sessions don't carry the field
          at all. The name is what `classificationRowMatchesUser` falls back to then. */}
      <div className="space-y-1.5 border-t border-border px-4 py-3.5">
        <ChipListField<string>
          id="speedhive-driver-name-input"
          label="Name on MYLAPS"
          initialText={speedhiveDriverName}
          parse={parseSpeedhiveDriverNamesSetting}
          format={formatSpeedhiveDriverNamesForSetting}
          state={savingSpeedhiveDriver}
          // Enter only: a name contains spaces, and sheets print "Caruso, Jordan".
          commitKeys={["Enter"]}
          placeholder="e.g. Jordan Smith"
          addAnotherPlaceholder="Add another spelling…"
          addLabel="Add driver name"
          invalidHint="Type the name as the timing sheet prints it."
          hint="Every spelling you appear under."
          onSave={(text) => {
            setSpeedhiveDriverName(text ?? "");
            return postSetting(
              "/api/settings/speedhive-driver",
              { speedhiveDriverName: text },
              setSavingSpeedhiveDriver
            );
          }}
        />
      </div>

      {/* MyRCM publishes no driver id and no transponder on its results — the printed name is the
          only handle there is. Optional, because the import tries the MYLAPS and LiveRC names
          first; fill it in only when MyRCM spells you differently. Leaving it blank never costs
          you the field: an unmatched import still brings in every driver and asks which row is
          yours, rather than quietly handing back the winner's laps. */}
      <div className="space-y-1.5 border-t border-border px-4 py-3.5 text-sm">
        <label htmlFor="myrcm-driver-name" className="block text-sm font-medium text-foreground">
          Name on MyRCM
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="myrcm-driver-name"
            type="text"
            value={myRcmDriverName}
            onChange={(e) => setMyRcmDriverName(e.target.value)}
            onBlur={() => void commitMyRcmName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="e.g. Jordan Smith"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
          />
          <SaveNote state={savingMyRcmDriver} />
        </div>
        <p className="ui-caption text-muted-foreground">
          Only if MyRCM spells you differently.
        </p>
      </div>
    </CardPanel>
  );
}
