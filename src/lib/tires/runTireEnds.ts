/**
 * A run's tires in words, for every surface that only READS them — the run page, compare, the
 * debrief, the team feed.
 *
 * A single-tire run (every on-road run) has one end, "only". A front/rear run (off-road,
 * 2026-09-19) has two, front first — the order the form asks for them and the way a driver reads
 * a car, nose to tail. On those runs the un-prefixed `Run` tire columns are the REAR.
 *
 * THE RULE THIS FILE EXISTS TO HOLD: a run is front/rear because it HAS front data, never because
 * of what its car races today. Cars get re-classed, chassis rows get merged, and a run logged as
 * front/rear must keep reading as front/rear — while a run logged with one tire on the same car
 * the week before the feature shipped must keep reading as one. So no caller here is ever handed
 * the car's discipline.
 *
 * Pure: no Prisma, no React.
 */

import {
  formatTireFitmentEnd,
  normalizeTireFitment,
  tireFitmentHasContent,
} from "@/lib/tires/tireFitment";

export type RunTireEndsSource = {
  tireType?: { displayName: string } | null;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
  frontTireTypeId?: string | null;
  frontTireType?: { displayName: string } | null;
  frontTireRunNumber?: number | null;
  frontTireAgeKnown?: boolean | null;
  /** Raw `Run.tireFitment` JSON. */
  tireFitment?: unknown;
};

export type RunTireEndLine = {
  end: "front" | "rear" | "only";
  /** "Front" | "Rear", or null for a single-tire run, which needs no name. */
  label: string | null;
  /** "AKA Array Clay · run 2", or null when that end has no tire logged. */
  identity: string | null;
  /** "Stock insert · Mono wheel · 3 extra holes", or null. */
  fitment: string | null;
};

export function isSplitTireRun(run: RunTireEndsSource | null | undefined): boolean {
  if (!run) return false;
  return (
    Boolean(run.frontTireTypeId || run.frontTireType) ||
    tireFitmentHasContent(normalizeTireFitment(run.tireFitment))
  );
}

/** "Sweep D32 · run 3", "… · run 3 (age unknown)" — the wording the run page has always used. */
function identity(
  tire: { displayName: string } | null | undefined,
  runNumber: number | null | undefined,
  ageKnown: boolean | null | undefined
): string | null {
  if (!tire) return null;
  const n = typeof runNumber === "number" && runNumber > 0 ? ` · run ${runNumber}` : "";
  return `${tire.displayName}${n}${ageKnown === false ? " (age unknown)" : ""}`;
}

export function runTireEndLines(run: RunTireEndsSource | null | undefined): RunTireEndLine[] {
  if (!run) return [];
  const rear = identity(run.tireType, run.tireRunNumber, run.tireAgeKnown);
  if (!isSplitTireRun(run)) {
    return rear ? [{ end: "only", label: null, identity: rear, fitment: null }] : [];
  }
  const fitment = normalizeTireFitment(run.tireFitment);
  return [
    {
      end: "front",
      label: "Front",
      identity: identity(run.frontTireType, run.frontTireRunNumber, run.frontTireAgeKnown),
      fitment: formatTireFitmentEnd(fitment?.front),
    },
    {
      end: "rear",
      label: "Rear",
      identity: rear,
      fitment: formatTireFitmentEnd(fitment?.rear),
    },
  ];
}

/**
 * Everything on one line: "Sweep D32 · run 3" for a single tire, and for a front/rear run
 * "F AKA Array Clay · run 2 (Stock insert) / R Cactus Yellow · run 1". Null when nothing is logged.
 */
export function formatRunTiresOneLine(
  run: RunTireEndsSource | null | undefined,
  opts?: { fitment?: boolean }
): string | null {
  const lines = runTireEndLines(run);
  if (lines.length === 0) return null;
  if (lines.length === 1 && lines[0].end === "only") return lines[0].identity;
  const parts = lines
    .filter((l) => l.identity || (opts?.fitment && l.fitment))
    .map((l) => {
      const tail = opts?.fitment && l.fitment ? ` (${l.fitment})` : "";
      return `${l.end === "front" ? "F" : "R"} ${l.identity ?? "—"}${tail}`;
    });
  return parts.length > 0 ? parts.join(" / ") : null;
}
