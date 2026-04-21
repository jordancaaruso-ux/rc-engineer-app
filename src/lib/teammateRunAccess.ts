import { prisma } from "@/lib/prisma";

export async function hasTeammateLink(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  const row = await prisma.teammateLink.findFirst({
    where: { userId: viewerId, peerUserId: targetUserId },
    select: { id: true },
  });
  return Boolean(row);
}
