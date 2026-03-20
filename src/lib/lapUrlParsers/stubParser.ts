import type { LapUrlParser, LapUrlParseResult } from "./types";

/** Placeholder until real site adapters are added. */
export const stubUrlParser: LapUrlParser = {
  id: "stub",
  canHandle() {
    return true;
  },
  async parse(url: string): Promise<LapUrlParseResult> {
    return {
      parserId: this.id,
      laps: [],
      message:
        "No results parser matched this URL yet. Add laps manually on the Manual tab, or paste a supported timing link once a parser is available.",
      sessionHint: { name: null, className: null },
      candidates: [],
    };
  },
};
