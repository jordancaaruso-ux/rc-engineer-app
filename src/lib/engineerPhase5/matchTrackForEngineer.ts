import "server-only";

import { prisma } from "@/lib/prisma";

export type MatchedTrack = {
  id: string;
  name: string;
  score: number;
  matchReason: string;
};

function slugFromLiveRcUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.liverc\.com$/);
    return m?.[1]?.replace(/-/g, "") ?? null;
  } catch {
    return null;
  }
}

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scoreTrack(
  query: string,
  track: { id: string; name: string; location: string | null; liveRcUrl: string | null }
): { score: number; reason: string } | null {
  const q = query.trim().toLowerCase();
  const qNorm = normalizeQuery(q);
  if (!q || !qNorm) return null;

  const name = track.name.trim();
  const nameLower = name.toLowerCase();
  const slug = slugFromLiveRcUrl(track.liveRcUrl);
  const slugNorm = slug ? normalizeQuery(slug) : "";

  if (nameLower === q) return { score: 100, reason: "exact name" };
  if (slugNorm && slugNorm === qNorm) return { score: 98, reason: "LiveRC slug" };
  if (nameLower.includes(q)) return { score: 85, reason: "name contains query" };
  if (qNorm.length >= 3 && normalizeQuery(name).includes(qNorm)) {
    return { score: 82, reason: "name fuzzy match" };
  }
  if (slugNorm && (slugNorm.includes(qNorm) || qNorm.includes(slugNorm))) {
    return { score: 80, reason: "LiveRC slug partial" };
  }
  const loc = track.location?.trim().toLowerCase() ?? "";
  if (loc && loc.includes(q)) return { score: 55, reason: "location" };
  return null;
}

/**
 * Fuzzy track match for Engineer lap-history queries (substring + LiveRC slug).
 */
export async function matchTracksForEngineerQuery(
  userId: string,
  query: string
): Promise<MatchedTrack[]> {
  const q = query.trim();
  if (!q) return [];

  const tracks = await prisma.track.findMany({
    where: {
      OR: [
        { runs: { some: { userId } } },
        { name: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, location: true, liveRcUrl: true },
    take: 80,
  });

  const scored: MatchedTrack[] = [];
  for (const t of tracks) {
    const s = scoreTrack(q, t);
    if (s && s.score >= 50) {
      scored.push({ id: t.id, name: t.name, score: s.score, matchReason: s.reason });
    }
  }

  if (scored.length === 0) {
    const snapshots = await prisma.run.findMany({
      where: {
        userId,
        trackNameSnapshot: { contains: q, mode: "insensitive" },
      },
      distinct: ["trackId"],
      select: { trackId: true, trackNameSnapshot: true, track: { select: { id: true, name: true, location: true, liveRcUrl: true } } },
      take: 20,
    });
    for (const row of snapshots) {
      if (row.track) {
        const s = scoreTrack(q, row.track) ?? { score: 70, reason: "run snapshot" };
        scored.push({ id: row.track.id, name: row.track.name, score: s.score, matchReason: s.reason });
      }
    }
  }

  return [...scored].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
