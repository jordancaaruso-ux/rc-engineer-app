"use client";

import { useState } from "react";
import { postSetting, SaveNote, type SaveState } from "@/components/settings/saveState";
import { formatTransponderCarsSetting, type TransponderCarMap } from "@/lib/speedhive/transponderCars";

/**
 * "This chip lives in this car." One row per saved transponder, a car picker on each. What it
 * buys: a run the timing sweep files under that chip carries the car the driver declared, so
 * the app never has to guess. Renders nothing until there is at least one chip and one car.
 */
export function TransponderCarsField({
  chips,
  cars,
  initial,
}: {
  chips: readonly string[];
  cars: readonly { id: string; name: string }[];
  initial: TransponderCarMap;
}) {
  const [map, setMap] = useState<TransponderCarMap>(initial);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  if (chips.length === 0 || cars.length === 0) return null;

  async function choose(chip: string, carId: string) {
    const next = { ...map };
    if (carId) next[chip] = carId;
    else delete next[chip];
    setMap(next);
    await postSetting(
      "/api/settings/speedhive-driver",
      { transponderCarsJson: formatTransponderCarsSetting(next) },
      setState,
    );
  }

  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Which car each chip is in</span>
        <SaveNote state={state} />
      </div>
      <ul className="space-y-1">
        {chips.map((chip) => (
          <li key={chip} className="flex items-center gap-2">
            <span className="w-[9ch] shrink-0 text-sm tabular-nums text-muted-foreground">{chip}</span>
            <select
              aria-label={`Car for transponder ${chip}`}
              value={map[chip] ?? ""}
              onChange={(e) => void choose(chip, e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
            >
              <option value="">Which car</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
