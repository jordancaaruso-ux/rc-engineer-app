import type { LapUrlParser } from "./types";
import {
  importSpeedhivePracticeActivity,
  isSpeedhivePracticeImportUrl,
} from "@/lib/speedhive/speedhivePracticeSessionLaps";

export const speedhivePracticeParser: LapUrlParser = {
  id: "speedhive_practice_v1",

  canHandle(url: string): boolean {
    return isSpeedhivePracticeImportUrl(url);
  },

  async parse(url: string) {
    return importSpeedhivePracticeActivity(url);
  },
};
