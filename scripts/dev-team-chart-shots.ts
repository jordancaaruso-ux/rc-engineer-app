/**
 * Throwaway: shoot /debug/team-focus (three fixtures) at phone + desktop width,
 * and report the y-axis labels actually rendered on each card.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     <this file> --base=http://localhost:3005
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? "http://localhost:3005").trim().replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "team-chart-shots";

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via dotenv-cli so .env.local loads.");
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user ${email} in this database.`);
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email });
  return `${BASE}/api/auth/callback/nodemailer?${params}`;
}

async function report(page: import("@playwright/test").Page, tag: string) {
  const cards = await page.locator("svg[role='img']").all();
  for (const [i, svg] of cards.entries()) {
    const labels = await svg.locator("text.text-\\[9\\.5px\\]").allTextContents();
    const box = await svg.boundingBox();
    const dots = await svg.locator("circle").count();
    const chevrons = await svg.locator("path[stroke-linejoin='round'][fill]").count();
    console.log(
      `${tag} card ${i + 1}: svg ${box?.width.toFixed(0)}x${box?.height.toFixed(0)}`,
      `| dots ${dots} | clip marks ${chevrons}`,
      `| axis ${JSON.stringify(labels.filter((l) => l.includes(".")))}`
    );
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await phone.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });
  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/debug/team-focus`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await report(page, "phone");
  await page.screenshot({ path: `${OUT}/phone-full.png`, fullPage: true });

  const wide = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desk = await wide.newPage();
  await desk.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await desk.waitForTimeout(1200);
  await desk.goto(`${BASE}/debug/team-focus`, { waitUntil: "networkidle" });
  await desk.waitForTimeout(1500);
  await report(desk, "desk ");
  await desk.screenshot({ path: `${OUT}/desktop-full.png`, fullPage: true });

  // Each card on its own, so the three scales can be compared side by side.
  const cards = await desk.locator("section").all();
  for (const [i, card] of cards.entries()) {
    await card.screenshot({ path: `${OUT}/desktop-card-${i + 1}.png` });
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
