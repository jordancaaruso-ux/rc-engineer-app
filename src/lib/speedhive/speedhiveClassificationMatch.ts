import type { SpeedhiveClassificationRow } from "@/lib/speedhive/speedhiveClient";
import {
  classificationRowMatchesTransponder,
  transponderNumberFromClassificationRow,
} from "@/lib/speedhive/speedhiveTransponder";
import { speedhiveDriverNameMatches } from "@/lib/speedhive/speedhiveNameNormalize";

export function classificationRowMatchesUser(input: {
  row: SpeedhiveClassificationRow;
  userTransponders: number[];
  driverNorm: string;
  raceClassFilter: string | null;
}): boolean {
  const { row, userTransponders, driverNorm, raceClassFilter } = input;

  if (raceClassFilter && row.resultClass?.trim().toLowerCase() !== raceClassFilter) {
    return false;
  }

  if (userTransponders.length > 0) {
    if (classificationRowMatchesTransponder(row, userTransponders)) return true;
  }

  if (driverNorm && row.name?.trim()) {
    return speedhiveDriverNameMatches(row.name, driverNorm);
  }

  return false;
}

export function sessionClassificationHasTransponderFields(
  rows: SpeedhiveClassificationRow[]
): boolean {
  return rows.some((row) => transponderNumberFromClassificationRow(row) != null);
}
