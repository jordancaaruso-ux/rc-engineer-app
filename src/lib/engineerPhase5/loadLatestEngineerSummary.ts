import { prisma } from "@/lib/prisma";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";

export async function getOrComputeEngineerSummaryForLatestRun(
  userId: string,
  opts?: { timeZone?: string | null }
) {
  const latest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return null;
  return getOrComputeEngineerSummaryForRun(userId, latest.id, { timeZone: opts?.timeZone });
}
