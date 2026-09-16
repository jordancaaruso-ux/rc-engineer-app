/**
 * dev-debrief-shots.ts — DEV ONLY, throwaway. Drive the debrief card on REAL data:
 * a one-day test day and a multi-day event from the founder's account.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-debrief-shots.ts --base=http://192.168.50.91:3000
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? "http://localhost:3000").trim().replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "debrief-shots";
const DAY_GROUP = argValue("group") ?? "day-2026-07-19-name:tftr";

async function findWeekendEventGroup(email: string): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) return null;
  // A declared multi-day meeting the driver actually ran at, most runs first.
  const events = await prisma.event.findMany({
    where: { runs: { some: { userId: user.id } } },
    select: { id: true, name: true, startDate: true, endDate: true, _count: { select: { runs: true } } },
  });
  const multi = events
    .filter((e) => e.endDate.getTime() - e.startDate.getTime() >= 20 * 60 * 60 * 1000)
    // Newest first: the Sessions page loads a window of recent runs, and a meeting outside it
    // is not on the page to be selected.
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  if (!multi.length) return null;
  console.log("weekend event:", multi[0]!.name, multi[0]!._count.runs, "runs");
  return `event-${multi[0]!.id}`;
}

async function shoot(page: Page, group: string, tag: string) {
  await page.goto(`${BASE}/runs/history?g=${encodeURIComponent(group)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  const box = page.getByRole("textbox", { name: /overview|debrief/i });
  console.log(`[${tag}] debrief boxes:`, await box.count());
  const card = page.locator("text=Debrief").first();
  if ((await card.count()) > 0) await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${tag}-01-card.png`, fullPage: true });
  if ((await box.count()) === 0) return;
  console.log(`[${tag}] placeholder:`, await box.first().getAttribute("placeholder"));
  const lines = await page.locator("span.type-data-label").allTextContents();
  console.log(`[${tag}] labels:`, lines.join(" | "));

  const note = `Rear went off late in the day — try 2° less rear toe next time. (${tag})`;
  await box.first().fill(note);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1500);
  const meta = await page.locator("text=/updated|saving|not saved/").first().textContent().catch(() => null);
  console.log(`[${tag}] meta after save:`, meta);
  await page.screenshot({ path: `${OUT}/${tag}-02-typed.png`, fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const after = await page.getByRole("textbox", { name: /overview|debrief/i }).first().inputValue();
  console.log(`[${tag}] survives reload:`, after === note);
  await page.screenshot({ path: `${OUT}/${tag}-03-reloaded.png`, fullPage: true });

  // The run name beside a figure is a door: tapping it must unfold that run below.
  const runRef = page.locator("button.tap-active.text-faint").first();
  if ((await runRef.count()) > 0) {
    const name = (await runRef.textContent())?.trim();
    const before = await page.locator("[aria-expanded='true']").count();
    await runRef.click();
    await page.waitForTimeout(900);
    const after = await page.locator("[aria-expanded='true']").count();
    console.log(`[${tag}] tap "${name}" opened a row:`, after > before);
    await page.screenshot({ path: `${OUT}/${tag}-04-run-opened.png`, fullPage: true });
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const eventGroup = await findWeekendEventGroup(EMAIL);
  console.log("weekend event group:", eventGroup);

  const browser = await chromium.launch();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await phone.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => console.log("  [request failed]", r.url().slice(0, 120)));

  await page.goto(`${BASE}/api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}&to=/runs/history`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  console.log("signed in at:", page.url());

  await shoot(page, DAY_GROUP, "day");
  if (eventGroup) await shoot(page, eventGroup, "weekend");

  // Desktop: the same card in the pane.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await desktop.newPage();
  await dpage.goto(`${BASE}/api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}&to=/runs/history`, {
    waitUntil: "domcontentloaded",
  });
  await dpage.waitForTimeout(1000);
  await dpage.goto(`${BASE}/runs/history?g=${encodeURIComponent(DAY_GROUP)}`, { waitUntil: "networkidle" });
  await dpage.waitForTimeout(1200);
  console.log("[desktop] debrief boxes:", await dpage.getByRole("textbox", { name: /overview|debrief/i }).count());
  await dpage.screenshot({ path: `${OUT}/desktop-01-day.png` });

  // Team scope must show no card.
  const team = await prisma.teamMembership.findFirst({ where: { user: { email: EMAIL } }, select: { teamId: true } });
  if (team) {
    await dpage.goto(`${BASE}/runs/history?teamId=${team.teamId}`, { waitUntil: "networkidle" });
    await dpage.waitForTimeout(1200);
    console.log("[team] debrief boxes (expect 0):", await dpage.getByRole("textbox", { name: /overview|debrief/i }).count());
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`shots in ${OUT}/`);
}

void main();
