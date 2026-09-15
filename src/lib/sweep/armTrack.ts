import "server-only";

import { readDoc, writeDoc } from "@/lib/sweep/blobStore";
import {
  isArmedDocExpired,
  newArmedTrackDoc,
  type ArmedBy,
  type ArmedTrackDoc,
  type ArmedTrackFacts,
} from "@/lib/sweep/sweepDocs";

export function armedDocKey(trackId: string): string {
  return `armed/${trackId}.json`;
}

/**
 * "Someone is at this track today." Read-modify-write on the track's armed doc; never touches
 * the DB — the caller already knows the track's clock and the driver's identity. A doc left over
 * from a previous day is replaced, not extended.
 */
export async function armTrack(params: {
  track: { id: string } & ArmedTrackFacts;
  user: { id: string; chips: string[]; liveRcName: string | null };
  armedBy: ArmedBy;
  now?: Date;
}): Promise<ArmedTrackDoc> {
  const now = params.now ?? new Date();
  const key = armedDocKey(params.track.id);
  let doc = await readDoc<ArmedTrackDoc>(key);
  if (!doc || isArmedDocExpired(doc, now)) {
    doc = newArmedTrackDoc(params.track, now);
  }
  const existing = doc.users[params.user.id];
  if (!existing) {
    doc.users[params.user.id] = {
      armedBy: params.armedBy,
      armedAtIso: now.toISOString(),
      chips: params.user.chips,
      liveRcName: params.user.liveRcName,
    };
    await writeDoc(key, doc);
  } else if (
    existing.chips.join(",") !== params.user.chips.join(",") ||
    existing.liveRcName !== params.user.liveRcName
  ) {
    existing.chips = params.user.chips;
    existing.liveRcName = params.user.liveRcName;
    await writeDoc(key, doc);
  }
  return doc;
}
