import type { SpeedhiveClassificationRow } from "@/lib/speedhive/speedhiveClient";
import {
  classificationRowMatchesTransponder,
  transponderNumberFromClassificationRow,
} from "@/lib/speedhive/speedhiveTransponder";
import { speedhiveDriverNameMatchesAny } from "@/lib/speedhive/speedhiveNameNormalize";

/**
 * Is this classification row the user?
 *
 * Both identities are sets, and either one hitting is enough. Chips come first
 * because they're exact, but they only work when MYLAPS publishes a transponder
 * on the row — a lot of sessions don't carry the field at all, and then the name
 * is the only thing left. That's also the whole story for anyone on a club or
 * loaner chip, who has no number to give.
 */
export function classificationRowMatchesUser(input: {
  row: SpeedhiveClassificationRow;
  userTransponders: number[];
  driverNorms: readonly string[];
  raceClassFilter: string | null;
}): boolean {
  const { row, userTransponders, driverNorms, raceClassFilter } = input;

  if (raceClassFilter && row.resultClass?.trim().toLowerCase() !== raceClassFilter) {
    return false;
  }

  if (userTransponders.length > 0) {
    if (classificationRowMatchesTransponder(row, userTransponders)) return true;
  }

  if (driverNorms.length > 0 && row.name?.trim()) {
    return speedhiveDriverNameMatchesAny(row.name, driverNorms);
  }

  return false;
}

export function sessionClassificationHasTransponderFields(
  rows: SpeedhiveClassificationRow[]
): boolean {
  return rows.some((row) => transponderNumberFromClassificationRow(row) != null);
}
