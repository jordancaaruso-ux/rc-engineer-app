import type { LapUrlParser } from "./types";
import { stubUrlParser } from "./stubParser";
import { httpTimingParser } from "./httpTimingParser";

/** Order: specific parsers first; stub last. */
const parsers: LapUrlParser[] = [httpTimingParser, stubUrlParser];

export function selectUrlParser(url: string): LapUrlParser {
  const u = url.trim();
  for (const p of parsers) {
    if (p.canHandle(u)) return p;
  }
  return stubUrlParser;
}

export async function parseTimingUrl(url: string) {
  const parser = selectUrlParser(url);
  return parser.parse(url);
}
