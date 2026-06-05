import type { SpeedhiveClassificationRow } from "@/lib/speedhive/speedhiveClient";

/** Normalize MYLAPS transponder / chip numbers for comparison (digits only). */
export function normalizeSpeedhiveTransponderNumber(raw: string | number): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return String(Math.trunc(raw));
  }
  const digits = raw.trim().replace(/\D/g, "");
  if (!digits || digits === "0") return null;
  return digits.replace(/^0+/, "") || digits;
}

/** Parse Settings value: comma/space/newline separated numbers or JSON array. */
export function parseSpeedhiveTransponderNumbersSetting(raw: string | null | undefined): number[] {
  const text = raw?.trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        const nums = new Set<number>();
        for (const item of parsed) {
          const n = typeof item === "number" ? item : Number(String(item).replace(/\D/g, ""));
          if (Number.isFinite(n) && n > 0) nums.add(Math.trunc(n));
        }
        return [...nums].sort((a, b) => a - b);
      }
    } catch {
      // fall through to delimiter split
    }
  }

  const nums = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    const norm = normalizeSpeedhiveTransponderNumber(part);
    if (!norm) continue;
    const n = Number(norm);
    if (Number.isFinite(n) && n > 0) nums.add(Math.trunc(n));
  }
  return [...nums].sort((a, b) => a - b);
}

export function formatSpeedhiveTransponderNumbersForSetting(numbers: number[]): string {
  return numbers.filter((n) => Number.isFinite(n) && n > 0).join(", ");
}

const TRANSPONDER_FIELD_KEYS = [
  "transponder",
  "transponderId",
  "transponderNumber",
  "transponderNr",
  "chip",
  "chipNumber",
  "chipNr",
  "codeNr",
  "code",
  "nr",
  "number",
  "competitorNumber",
] as const;

function readTransponderFromValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") return normalizeSpeedhiveTransponderNumber(value);
  if (typeof value === "string") return normalizeSpeedhiveTransponderNumber(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const key of TRANSPONDER_FIELD_KEYS) {
      const nested = readTransponderFromValue(o[key]);
      if (nested) return nested;
    }
  }
  return null;
}

/** Extract transponder/chip id from a classification row when MYLAPS publishes it. */
export function transponderNumberFromClassificationRow(
  row: SpeedhiveClassificationRow
): string | null {
  for (const key of TRANSPONDER_FIELD_KEYS) {
    const v = row[key as keyof SpeedhiveClassificationRow];
    const norm = readTransponderFromValue(v);
    if (norm) return norm;
  }
  const competitor = row.competitor;
  if (competitor && typeof competitor === "object") {
    return readTransponderFromValue(competitor);
  }
  return null;
}

export function classificationRowMatchesTransponder(
  row: SpeedhiveClassificationRow,
  userTransponders: number[]
): boolean {
  if (userTransponders.length === 0) return false;
  const rowNorm = transponderNumberFromClassificationRow(row);
  if (!rowNorm) return false;
  const rowNum = Number(rowNorm);
  if (!Number.isFinite(rowNum)) return false;
  return userTransponders.some((n) => n === rowNum || normalizeSpeedhiveTransponderNumber(n) === rowNorm);
}
