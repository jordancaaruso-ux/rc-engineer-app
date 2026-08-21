/**
 * Tools — the shapes its bands read, in a module with no Prisma and no `server-only` import
 * so the cards can take them as props without dragging the database client across the
 * boundary. Same split as `paddockModel`, for the same reason.
 *
 * The page is built on the rule Paddock established: **show the thing, don't name it.**
 * `/tools` was three rows with a sentence under each explaining what was behind it, which is
 * exactly what `/more` was — and the sentence was the tell, because it read identically for
 * every driver on every day of the year. Nothing here is a description. Every field is a fact
 * about this account: your car's roll centres, your last two setups, your video jobs, the
 * timing sessions you imported and never attached.
 *
 * Everything is a *summary* that leads somewhere. The Lab, the compare bench, `/videos` and
 * `/laps/import` are unchanged behind these bands and still hold the real work.
 */

// Type-only, both of them: nothing here imports a component or the engine at runtime, and the
// geometry band's drawing is fed from this model rather than re-solved in the card.
import type { SolvedAxle } from "@/lib/rollCenter/engine";
import type { ChassisPlate } from "@/components/rollCenter/AxleSchematic";

/** One end of the pre-filled comparison pair. */
export type ToolsCompareSide = {
  /**
   * The comparison bench's own entry id (`run-<id>` / `saved-<id>`), NOT a bare row id.
   * The bench builds these when it loads its picker; handing back the same string is what
   * lets a link preselect a slot without a second id vocabulary existing.
   */
  entryId: string;
  label: string;
  detail: string;
};

export type ToolsCompare = {
  a: ToolsCompareSide;
  b: ToolsCompareSide;
  /**
   * Boxes filled on one side and not the other, or filled differently on both.
   *
   * The count is the reason to tap. "Race 4 vs Race 3" is two names; "6 boxes differ" is
   * whether the comparison is worth opening — and zero is the most useful answer of all,
   * because two setups you believed were different turning out identical is a finding.
   */
  differingBoxes: number;
};

/**
 * The geometry band, when the car's chassis has a measured pack.
 *
 * `rollCenter` is null when it doesn't — see `ToolsGeometry.reason`. That is the common case
 * and always will be for a while: one pack exists (Awesomatix A800R/RR), because hardpoints
 * have to be measured per chassis before the calculator can say anything true about it.
 */
export type ToolsRollCentre = {
  /** mm, signed. Negative is below ground — normal on a 1/10 touring car. */
  frontMm: number;
  rearMm: number;
  /** rear − front; + rakes down toward the front. */
  rakeMm: number;
  /**
   * The solved FRONT axle, for the drawing that leads the band.
   *
   * Front only, and the rear stays a number. Two axles side by side in a 390px card are ~170px
   * each and the arm-angle labels are 9 units on a 360-unit viewBox — unreadable; stacked, they
   * double the tallest element on the page to show two pictures that differ by half a millimetre.
   */
  frontSolve: SolvedAxle;
  /**
   * The chassis plate under that drawing, and the ride height it dimensions. Null only if the
   * plate can't be built — the drawing then falls back to its mount-to-mount stub.
   *
   * Typed from the drawing's own export rather than restated here: this field exists to be handed
   * straight to `AxleSchematic`, and a second copy of the shape is how the two would drift.
   */
  frontPlate: ChassisPlate | null;
  /** Which setup these came from, e.g. "Race 4 — Ironbark". */
  sourceLabel: string;
  /** The Lab, already seeded with this setup. */
  labHref: string;
};

export type ToolsGeometry = {
  carId: string;
  carName: string;
  /** Null when the driver named the car after its chassis — see `isSameThing` in PaddockCars. */
  chassisName: string | null;
  rollCentre: ToolsRollCentre | null;
  /**
   * Why there are no numbers, when there are none. Shown as one quiet line rather than an
   * error: a chassis without a pack is not a fault, and the Lab still opens.
   */
  reason: "no-pack" | "no-setup" | null;
};

export type ToolsVideoJob = {
  id: string;
  /** Track plus run label where known — "Ironbark — Race 4". */
  title: string;
  /** Already localised. */
  whenLabel: string;
  /** What the driver can do about it, in their words, not the enum's. */
  state: "analysed" | "in-progress" | "failed";
  /** Where the row goes: the run when it has one, otherwise the job. */
  href: string;
};

export type ToolsLapSession = {
  id: string;
  /** The race class or session label when timing gave one, otherwise what kind of session it was. */
  title: string;
  /** When, and where it came from — "17 Jul 2026 · grccc.liverc.com". */
  detail: string;
  href: string;
};

export type ToolsModel = {
  /** Null only on an account with no cars at all. */
  geometry: ToolsGeometry | null;
  /** Null when there aren't two comparable setups yet. */
  compare: ToolsCompare | null;
  video: ToolsVideoJob[];
  /** Imported timing sessions not attached to a run. */
  unlinkedLaps: ToolsLapSession[];
  /** How many unlinked sessions exist in total, for the "N more" line. */
  unlinkedLapTotal: number;
};

/** Video jobs on the page. Three is two full rows at 390px without pushing lap import off. */
export const MAX_VIDEO_JOBS = 3;
/** Unlinked timing sessions listed before the overflow line takes over. */
export const MAX_UNLINKED_LAPS = 3;

/**
 * How far back the lap-import band counts as "waiting".
 *
 * Measured on real data 2026-08-19: 503 unlinked sessions on one account, of which 7 were
 * imported in the last fortnight. The other ~496 are the byproduct of LiveRC event-hub
 * expansion (`expandLiveRcEventHubForImport` stores every race on the hub, most of them other
 * people's classes), so an unbounded band reported "500 more waiting" — a number that is
 * technically true and describes no task anyone has.
 *
 * A fortnight is the honest cut. An import you have not filed since March is not something you
 * are going to file; it is history, and it lives on `/laps/import` where the full list is.
 */
export const UNLINKED_LAP_WINDOW_DAYS = 14;

/**
 * Boxes that differ between two setups.
 *
 * Compared as trimmed strings because a sheet stores whatever the box was filled with — `0.5`
 * from the run form and `"0.5"` from a PDF read are the same setting typed twice, and counting
 * them as a difference would put a number on the card that the compare bench then contradicts.
 *
 * A box empty on both sides is not a difference. A box filled on one side only is.
 */
export function countDifferingBoxes(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): number {
  const text = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return "";
      }
    }
    return String(v).trim();
  };

  let count = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = text(a[key]);
    const right = text(b[key]);
    if (!left && !right) continue;
    if (left !== right) count += 1;
  }
  return count;
}
