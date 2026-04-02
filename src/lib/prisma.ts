import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function assertActionItemDelegate(client: PrismaClient): void {
  const delegate = (
    client as unknown as { actionItem?: { findFirst?: unknown } }
  ).actionItem;
  if (delegate == null || typeof delegate.findFirst !== "function") {
    throw new Error(
      "Prisma client is missing prisma.actionItem (ActionItem model). " +
        "Stop the dev server, run `npx prisma generate`, then `npx prisma db push`, and restart. " +
        "On Windows, if generate shows EPERM, close anything using node_modules/.prisma (IDE, dev server, antivirus scan)."
    );
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

assertActionItemDelegate(prisma);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
