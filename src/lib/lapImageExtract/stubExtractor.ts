import type { LapImageExtractor } from "./types";

/** Swap for a real OCR/vision implementation without changing API routes. */
export const stubLapImageExtractor: LapImageExtractor = {
  id: "stub",
  async extract(_file: File) {
    return {
      laps: [],
      note:
        "Photo lap read is not enabled yet. Use the preview below to paste or type laps from your screenshot, then confirm.",
      meta: { engine: "stub" },
    };
  },
};
