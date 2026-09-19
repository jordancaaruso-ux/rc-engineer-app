"use client";

import { useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { ChipListField } from "@/components/settings/ChipListField";
import { KnownCompetitorsField } from "@/components/settings/KnownCompetitorsField";
import { TransponderCarsField } from "@/components/settings/TransponderCarsField";
import type { KnownCompetitor } from "@/lib/speedhive/knownCompetitors";
import type { TransponderCarMap } from "@/lib/speedhive/transponderCars";
import { postSetting, type SaveState } from "@/components/settings/saveState";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";
import {
  formatSpeedhiveDriverNamesForSetting,
  parseSpeedhiveDriverNamesSetting,
} from "@/lib/speedhive/speedhiveDriverNames";
import {
  formatLiveRcDriverNamesForSetting,
  parseLiveRcDriverNamesSetting,
} from "@/lib/lapWatch/liveRcNameNormalize";

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
  /** Every name the driver appears under on LiveRC, one per line. */
  liveRcDriverName: string;
  /** LiveRC `data-driver-id` when known; disambiguates same name on A/B/C mains. */
  liveRcDriverId: string;
  /** Comma-separated MYLAPS transponder numbers for Speedhive discovery at a track. */
  speedhiveTransponderNumbers: string;
  /** Speedhive display names; empty uses the LiveRC driver name when set. */
  speedhiveDriverName: string;
  /** Other drivers' chips this account has saved — see `KnownCompetitorsField`. */
  knownCompetitors: KnownCompetitor[];
  /** Which car each chip lives in — see `TransponderCarsField`. */
  transponderCars: TransponderCarMap;
  /** The driver's cars, for the chip→car picker. */
  cars: { id: string; name: string }[];
};

export function TimingIdentitySection({ initial }: { initial: InitialTiming }) {
  const [liveRcDriverName, setLiveRcDriverName] = useState(initial.liveRcDriverName);
  const [liveRcDriverId, setLiveRcDriverId] = useState(initial.liveRcDriverId);
  const [speedhiveDriverName, setSpeedhiveDriverName] = useState(initial.speedhiveDriverName);
  const [speedhiveTransponderNumbers, setSpeedhiveTransponderNumbers] = useState(
    initial.speedhiveTransponderNumbers
  );
  const [savingDriver, setSavingDriver] = useState<SaveState>({ kind: "idle" });
  const [savingDriverId, setSavingDriverId] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveDriver, setSavingSpeedhiveDriver] = useState<SaveState>({ kind: "idle" });
  const [savingSpeedhiveTransponder, setSavingSpeedhiveTransponder] = useState<SaveState>({
    kind: "idle",
  });

  return (
    <CardPanel contentClassName="p-0">
      {/* Heading and its one line of context both sit IN the card now (2026-08-18) — see
          the note in YouSection. The hint explains the section, not any single field, so it
          is the first thing under the band; below it rather than inside it, so every
          settings card opens on the same 29px band (2026-09-15). */}
      <div className="eyebrow-band px-4">
        <Eyebrow className="mb-0">Timing &amp; results</Eyebrow>
      </div>
      <p className="ui-caption px-4 pt-2.5">How we spot your runs on LiveRC and MYLAPS.</p>
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
        <TransponderCarsField
          chips={parseSpeedhiveTransponderNumbersSetting(speedhiveTransponderNumbers).map(String)}
          cars={initial.cars}
          initial={initial.transponderCars}
        />
      </div>

      <div className="space-y-1.5 border-t border-border px-4 py-3.5 text-sm">
        {/* A list since 2026-09-19, same as MYLAPS below: a nickname at one club and the full
            name at another are both the driver, and one stored name silently missed the other. */}
        <ChipListField<string>
          id="liverc-driver-name"
          label="Name on LiveRC"
          initialText={liveRcDriverName}
          parse={parseLiveRcDriverNamesSetting}
          format={formatLiveRcDriverNamesForSetting}
          state={savingDriver}
          // Enter only: a name contains spaces, and sheets print "Caruso, Jordan".
          commitKeys={["Enter"]}
          placeholder="e.g. Jordan Smith"
          addAnotherPlaceholder="Add another spelling…"
          addLabel="Add driver name"
          invalidHint="Type the name as the timing sheet prints it."
          hint="Every spelling you appear under."
          onSave={(text) => {
            setLiveRcDriverName(text ?? "");
            return postSetting(
              "/api/settings/live-rc-driver",
              { liveRcDriverName: text },
              setSavingDriver
            );
          }}
        />
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
        ) : null}
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

      {/*
       * Other people's numbers, under the same heading as your own — because it is the same
       * fact about the same timing system, just pointed at someone else. MYLAPS serves any
       * chip's practice to anyone who asks, so knowing a rival's number is the whole of what
       * it takes to compare your run against theirs.
       */}
      <div className="space-y-1.5 border-t border-border px-4 py-3.5">
        <KnownCompetitorsField initial={initial.knownCompetitors} />
      </div>

      {/* The "Name on MyRCM" field was removed on 2026-08-26 with MyRCM import itself (see
          `timingUrlSafetySync.ts`). LiveRC and Speedhive are the two sources left, and each has
          its own identity above; a third name that nothing reads would only be a question the
          driver cannot answer usefully. Saved values stay in `AppSetting` untouched. */}
    </CardPanel>
  );
}
