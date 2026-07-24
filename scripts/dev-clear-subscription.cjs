/**
 * dev-clear-subscription.cjs — DEV/TEST ONLY.
 *
 * Deletes the local Subscription row for a user (clean slate after a test run). Does NOT touch
 * Stripe — cancel the Stripe subscription separately if you want a full reset.
 */
const { PrismaClient } = require("@prisma/client");

const EMAIL = process.env.CHECKOUT_EMAIL || "jordancaaruso@gmail.com";

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
    if (!user) throw new Error(`No user found with email ${EMAIL}`);
    const res = await prisma.subscription.deleteMany({ where: { userId: user.id } });
    console.log("CLEARED_ROWS=" + res.count);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
