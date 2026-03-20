import type { LapUrlParseResult } from "./types";

export type JsonLapCandidate = {
  id: string;
  label: string;
  laps: number[];
};

function toFiniteNumbers(arr: unknown[]): number[] {
  return arr
    .map((x) => (typeof x === "number" ? x : Number(String(x).replace(",", "."))))
    .filter((n) => Number.isFinite(n)) as number[];
}

function isLapSequence(arr: unknown[]): boolean {
  const nums = toFiniteNumbers(arr).filter((n) => n > 2 && n < 400);
  return nums.length > 0;
}

function pushCandidate(out: JsonLapCandidate[], id: string, label: string, laps: number[]) {
  const clean = laps.filter((n) => n > 2 && n < 400);
  if (clean.length === 0) return;
  out.push({ id, label, laps: clean });
}

/** Recursively find lap arrays and named driver rows in JSON. */
export function collectJsonLapCandidates(obj: unknown, path = "root"): JsonLapCandidate[] {
  const out: JsonLapCandidate[] = [];

  function walk(node: unknown, p: string) {
    if (out.length >= 24) return;
    if (Array.isArray(node)) {
      if (isLapSequence(node)) {
        const nums = toFiniteNumbers(node).filter((n) => n > 2 && n < 400);
        pushCandidate(out, p, p === "root" ? "Lap list" : p, nums);
        return;
      }
      node.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const name =
        (typeof o.name === "string" && o.name.trim()) ||
        (typeof o.driver === "string" && o.driver.trim()) ||
        (typeof o.driverName === "string" && o.driverName.trim()) ||
        (typeof o.pilot === "string" && o.pilot.trim()) ||
        null;

      for (const key of ["laps", "lapTimes", "times", "lap_times"]) {
        const arr = o[key];
        if (Array.isArray(arr)) {
          const nums = toFiniteNumbers(arr).filter((n) => n > 2 && n < 400);
          if (nums.length > 0) {
            pushCandidate(out, `${p}.${key}`, name || `Laps (${key})`, nums);
          }
        }
      }

      for (const [k, v] of Object.entries(o)) {
        walk(v, p === "root" ? k : `${p}.${k}`);
      }
    }
  }

  walk(obj, path);
  return dedupeCandidates(out);
}

function dedupeCandidates(c: JsonLapCandidate[]): JsonLapCandidate[] {
  const seen = new Set<string>();
  const next: JsonLapCandidate[] = [];
  for (const row of c) {
    const key = row.laps.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
}

export function parseJsonDocumentToResult(
  text: string,
  parserId: string,
  url: string
): LapUrlParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      parserId,
      laps: [],
      candidates: [],
      message: "Response is not valid JSON.",
    };
  }

  const candidates = collectJsonLapCandidates(parsed).map((c, i) => ({
    id: c.id || `c${i}`,
    label: c.label,
    laps: c.laps,
    roleHint: "unknown" as const,
  }));

  if (candidates.length === 0) {
    return {
      parserId,
      laps: [],
      candidates: [],
      message: "JSON loaded but no lap arrays were found. Try manual entry or a different export.",
    };
  }

  const primary = candidates[0]!;
  return {
    parserId,
    laps: primary.laps,
    candidates,
    sessionHint: { name: null, className: null },
    message:
      candidates.length > 1
        ? `${candidates.length} lap lists found — pick one below. Source: ${url}`
        : `Imported ${primary.laps.length} laps from JSON. Verify before saving.`,
  };
}
