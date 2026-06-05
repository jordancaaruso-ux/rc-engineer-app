import type { LapUrlParseContext, LapUrlParseResult, LapUrlParser } from "./types";
import { importSpeedhiveSession, isSpeedhiveSessionUrl } from "@/lib/speedhive/speedhiveSessionLaps";
import { isSpeedhiveOrApiUrl } from "@/lib/speedhive/speedhiveUrl";

export const speedhiveParser: LapUrlParser = {
  id: "speedhive_api_v1",

  canHandle(url: string): boolean {
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (!isSpeedhiveOrApiUrl(trimmed)) return false;
    return isSpeedhiveSessionUrl(trimmed);
  },

  async parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult> {
    return importSpeedhiveSession(url, {
      driverName: context?.driverName ?? null,
      transponderNumbers: context?.speedhiveTransponderNumbers ?? [],
    });
  },
};
