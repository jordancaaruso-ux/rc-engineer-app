/**
 * Run: `npm run test:run-window`
 *
 * Proves the Starter run window (docs/STARTER_TIER_PLAN.md) end to end against a real database —
 * whatever `.env.local` points at, which should be scratch-dev. The routine hides and reveals as
 * the plan says, and the query gate keeps a hidden run out of every read shape the app uses. Seeds
 * one throwaway member (a `+ob` alias, so `onboarding:cleanup` reaps it too) and deletes them at
 * the end; nothing else in the database is touched.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { STARTER_RUN_WINDOW } from "@/lib/entitlementLogic";
import { prisma, runsIncludingHidden } from "@/lib/prisma";
import {
  applyRunWindow,
  countRunsHiddenByPlan,
  usersNeedingRunWindowPass,
} from "@/lib/runs/runWindow";

const EMAIL = "jordancaaruso+ob-runwindow-test@gmail.com";
const CUSTOMER = "cus_devstate_runwindow";
const TOTAL = STARTER_RUN_WINDOW + 5;
const FUTURE = () => new Date(Date.now() + 30 * 86400000);

let userId = "";
/** Oldest first, by `sortAt`. */
const runIds: string[] = [];

async function reap(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function setPlan(tier: string, status = "active"): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    update: { tier, status, currentPeriodEnd: FUTURE() },
    create: {
      userId,
      stripeSubscriptionId: "sub_devstate_runwindow",
      stripeCustomerId: CUSTOMER,
      status,
      tier,
      currentPeriodEnd: FUTURE(),
    },
  });
}

async function visibleIds(): Promise<string[]> {
  const rows = await prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

before(async () => {
  process.env.BILLING_ENFORCED = "1";
  // The member must not be an admin, or they are grandfathered to full access and nothing hides.
  delete process.env.AUTH_ADMIN_EMAILS;
  await reap();
  const user = await prisma.user.create({
    data: { email: EMAIL, stripeCustomerId: CUSTOMER },
    select: { id: true },
  });
  userId = user.id;
  await setPlan("starter");
  const snapshot = await prisma.setupSnapshot.create({
    data: { userId, data: {} },
    select: { id: true },
  });
  const base = Date.now() - TOTAL * 60_000;
  for (let i = 0; i < TOTAL; i++) {
    const run = await prisma.run.create({
      data: {
        userId,
        setupSnapshotId: snapshot.id,
        sortAt: new Date(base + i * 60_000),
        sessionLabel: `Run ${i + 1}`,
      },
      select: { id: true },
    });
    runIds.push(run.id);
  }
});

after(async () => {
  await reap();
  await prisma.$disconnect();
});

test("a Starter member sees only the window; the rest are stamped, not deleted", async () => {
  const result = await applyRunWindow(userId);
  assert.equal(result.tier, "starter");
  assert.equal(result.hidden, TOTAL - STARTER_RUN_WINDOW);
  assert.equal(result.revealed, 0);
  assert.equal(await prisma.run.count({ where: { userId } }), STARTER_RUN_WINDOW);
  assert.equal(await runsIncludingHidden.count({ where: { userId } }), TOTAL);
  assert.equal(await countRunsHiddenByPlan(userId), TOTAL - STARTER_RUN_WINDOW);
  assert.deepEqual(await visibleIds(), [...runIds].slice(-STARTER_RUN_WINDOW).reverse());
});

test("every read shape misses a hidden run, and no caller can widen the view", async () => {
  const hiddenId = runIds[0];
  assert.equal(await prisma.run.findUnique({ where: { id: hiddenId } }), null);
  assert.equal(await prisma.run.findFirst({ where: { id: hiddenId, userId } }), null);
  await assert.rejects(prisma.run.findUniqueOrThrow({ where: { id: hiddenId } }));
  await assert.rejects(prisma.run.findFirstOrThrow({ where: { id: hiddenId } }));
  assert.equal(await prisma.run.count({ where: { id: hiddenId } }), 0);
  assert.equal(
    (await prisma.run.findMany({ where: { id: { in: runIds } }, select: { id: true } })).length,
    STARTER_RUN_WINDOW,
  );
  const agg = await prisma.run.aggregate({ where: { userId }, _count: { _all: true } });
  assert.equal(agg._count._all, STARTER_RUN_WINDOW);
  const grouped = await prisma.run.groupBy({
    by: ["userId"],
    where: { userId },
    _count: { _all: true },
  });
  assert.equal(grouped[0]?._count._all, STARTER_RUN_WINDOW);
  // Asking the ordinary client for hidden runs gets nothing — only `runsIncludingHidden` may.
  assert.deepEqual(
    await prisma.run.findMany({ where: { userId, hiddenByPlanAt: { not: null } } }),
    [],
  );
  // But the same run is still there, untouched, for the delegate that is allowed to see it.
  const still = await runsIncludingHidden.findUnique({
    where: { id: hiddenId },
    select: { sessionLabel: true, hiddenByPlanAt: true },
  });
  assert.equal(still?.sessionLabel, "Run 1");
  assert.ok(still?.hiddenByPlanAt instanceof Date);
});

test("a second pass changes nothing", async () => {
  const result = await applyRunWindow(userId);
  assert.equal(result.hidden, 0);
  assert.equal(result.revealed, 0);
});

test("deleting a visible run brings the newest hidden run back", async () => {
  const newest = runIds[TOTAL - 1];
  await prisma.run.delete({ where: { id: newest } });
  const result = await applyRunWindow(userId);
  assert.equal(result.revealed, 1);
  assert.equal(result.hidden, 0);
  const visible = await visibleIds();
  assert.equal(visible.length, STARTER_RUN_WINDOW);
  // The 5th oldest was the newest hidden run; it is the oldest visible one now.
  assert.equal(visible[visible.length - 1], runIds[TOTAL - STARTER_RUN_WINDOW - 1]);
  assert.equal(await runsIncludingHidden.count({ where: { userId } }), TOTAL - 1);
});

test("dragging a hidden run to the top reveals it and hides the tenth", async () => {
  const oldest = runIds[0];
  await runsIncludingHidden.update({ where: { id: oldest }, data: { sortAt: new Date() } });
  const result = await applyRunWindow(userId);
  assert.equal(result.revealed, 1);
  assert.equal(result.hidden, 1);
  const visible = await visibleIds();
  assert.equal(visible[0], oldest);
  assert.equal(visible.length, STARTER_RUN_WINDOW);
});

test("an upgrade brings every run back at once", async () => {
  await setPlan("standard");
  const result = await applyRunWindow(userId);
  assert.equal(result.tier, "standard");
  assert.equal(result.revealed, TOTAL - 1 - STARTER_RUN_WINDOW);
  assert.equal(await prisma.run.count({ where: { userId } }), TOTAL - 1);
  assert.equal(await countRunsHiddenByPlan(userId), 0);
});

test("a downgrade hides again", async () => {
  await setPlan("starter");
  const result = await applyRunWindow(userId);
  assert.equal(result.hidden, TOTAL - 1 - STARTER_RUN_WINDOW);
  assert.equal(await prisma.run.count({ where: { userId } }), STARTER_RUN_WINDOW);
});

test("the nightly sweep visits Starter members and anyone still carrying a stamp", async () => {
  assert.ok((await usersNeedingRunWindowPass()).includes(userId));
  // A missed upgrade webhook: the plan moved, the stamps did not. Still on the list.
  await setPlan("standard");
  assert.ok((await usersNeedingRunWindowPass()).includes(userId));
  await applyRunWindow(userId);
  // Revealed and off Starter — nothing left to visit.
  assert.ok(!(await usersNeedingRunWindowPass()).includes(userId));
});

test("a lapsed subscription hides nothing — the paywall does that job", async () => {
  await setPlan("starter");
  await applyRunWindow(userId);
  assert.equal(await prisma.run.count({ where: { userId } }), STARTER_RUN_WINDOW);
  await setPlan("starter", "canceled");
  const result = await applyRunWindow(userId);
  assert.equal(result.tier, "none");
  assert.equal(await countRunsHiddenByPlan(userId), 0);
});

test("with billing dark nothing ever hides", async () => {
  await setPlan("starter");
  await applyRunWindow(userId);
  assert.equal(await countRunsHiddenByPlan(userId), TOTAL - 1 - STARTER_RUN_WINDOW);
  delete process.env.BILLING_ENFORCED;
  const result = await applyRunWindow(userId);
  assert.equal(result.tier, "pro");
  assert.equal(await countRunsHiddenByPlan(userId), 0);
  process.env.BILLING_ENFORCED = "1";
});
