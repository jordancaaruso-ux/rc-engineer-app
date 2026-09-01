"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { postSetting, SaveNote, type SaveState } from "@/components/settings/saveState";
import {
  MAX_KNOWN_COMPETITORS,
  serializeKnownCompetitorsSetting,
  type KnownCompetitor,
} from "@/lib/speedhive/knownCompetitors";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * "Drivers you know" — a name and a transponder, saved so their practice can be pulled later.
 *
 * A pair, not a chip list, which is why it isn't `ChipListField`: a bare number is unreadable
 * a week later, and the name is the only part of the row a human can check. The chip is still
 * the identity — two rows with the same number collapse to one.
 *
 * Nothing is fetched from here. The row is a phone book entry; pulling their laps happens on
 * the lap analysis page, when you ask for it.
 */
export function KnownCompetitorsField({ initial }: { initial: KnownCompetitor[] }) {
  const [rows, setRows] = useState<KnownCompetitor[]>(initial);
  const [name, setName] = useState("");
  const [chip, setChip] = useState("");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [hint, setHint] = useState<string | null>(null);

  async function save(next: KnownCompetitor[]) {
    setRows(next);
    await postSetting(
      "/api/settings/known-competitors",
      { knownCompetitors: serializeKnownCompetitorsSetting(next) },
      setState
    );
  }

  function add() {
    const transponder = normalizeSpeedhiveTransponderNumber(chip);
    if (!transponder) {
      setHint("A transponder number is digits — check the one you were given.");
      return;
    }
    if (rows.length >= MAX_KNOWN_COMPETITORS) {
      setHint(`That's the ${MAX_KNOWN_COMPETITORS} the list holds.`);
      return;
    }
    setHint(null);
    const label = name.trim() || `Chip ${transponder}`;
    // Same chip typed twice is an edit of the row that's already there, not a second driver.
    const next = [
      ...rows.filter((r) => r.transponder !== transponder),
      { name: label, transponder },
    ];
    setName("");
    setChip("");
    void save(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="ui-label text-[13px] font-medium text-foreground">Drivers you know</span>
        <SaveNote state={state} />
      </div>

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li
              key={r.transponder}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{r.name}</span>
              <span className="type-timestamp shrink-0 tabular-nums">{r.transponder}</span>
              <button
                type="button"
                aria-label={`Remove ${r.name}`}
                onClick={() => void save(rows.filter((x) => x.transponder !== r.transponder))}
                className="tap-active shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Their name"
          aria-label="Competitor name"
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
        />
        <input
          type="text"
          inputMode="numeric"
          value={chip}
          onChange={(e) => setChip(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Transponder"
          aria-label="Competitor transponder number"
          className="w-32 rounded-md border border-border bg-card px-3 py-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-primary-ink/50"
        />
        <button
          type="button"
          onClick={add}
          className="btn-surface shrink-0 px-3 py-2 text-[13px] font-medium"
        >
          Add
        </button>
      </div>

      <p className="ui-caption text-muted-foreground">
        {hint ??
          "Their MYLAPS number. Saved here, you can pull their practice from a track's timing without hunting for a link — MYLAPS tracks only."}
      </p>
    </div>
  );
}
