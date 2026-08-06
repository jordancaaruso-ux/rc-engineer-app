/**
 * dev-layout-probe.ts — DEV ONLY. Dump the app's layout GEOMETRY at a given viewport width.
 *
 *   npm run layout:probe -- --width=390 --out=before.json
 *   npm run layout:probe -- --width=390 --out=after.json
 *   npm run layout:probe -- --compare=before.json,after.json
 *
 * Why geometry and not screenshots: the obvious way to prove "desktop work did not touch mobile" is
 * to diff 390px screenshots, and it does not work. Captured twice from IDENTICAL code, these pages
 * differ by up to 98% — async content, staggered reveal animations and loading states all land
 * differently run to run, so a pixel diff reports enormous changes that mean nothing and would hide
 * a real one-pixel shift in the noise.
 *
 * Bounding boxes are stable across those same runs because they are a property of the LAYOUT, not
 * of what happened to be painted. "Did the mobile layout move?" is exactly the question, and this
 * answers it directly.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (process.env.AUTH_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
const WIDTH = Number(argValue("width") ?? 390);
const HEIGHT = Number(argValue("height") ?? 844);
const EMAIL = argValue("email") ?? "demo@jrcdynamics.com";

const ROUTES = [
  "/", "/engineer", "/runs/history", "/analysis", "/cars", "/events", "/settings", "/teams",
];

/** Structural elements whose box IS the layout. Content inside them may vary; these should not. */
const SELECTORS = [".page", ".page-header", ".page-body", ".sidebar", ".app-shell"];

const PROBE = `(() => {
  const out = {};
  const sels = ${JSON.stringify(SELECTORS)};
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[sel] = {
      x: Math.round(r.x), width: Math.round(r.width),
      marginLeft: cs.marginLeft, marginRight: cs.marginRight,
      paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
      maxWidth: cs.maxWidth,
    };
  }
  // Direct children of the content column: their left/right edges are what a reader actually sees.
  const body = document.querySelector(".page-body");
  out["__cards"] = body
    ? Array.from(body.children).slice(0, 6).map(function (c) {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width) };
      })
    : [];
  return out;
})()`;

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via npm so .env.local loads.");
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

function compare(aPath: string, bPath: string): void {
  const a = JSON.parse(readFileSync(aPath, "utf8"));
  const b = JSON.parse(readFileSync(bPath, "utf8"));
  let diffs = 0;
  for (const route of Object.keys(a)) {
    const ja = JSON.stringify(a[route]);
    const jb = JSON.stringify(b[route]);
    if (ja === jb) {
      console.log(`  same   ${route}`);
      continue;
    }
    diffs++;
    console.log(`  MOVED  ${route}`);
    for (const key of Object.keys(a[route] ?? {})) {
      const ka = JSON.stringify(a[route][key]);
      const kb = JSON.stringify(b[route]?.[key]);
      if (ka !== kb) console.log(`           ${key}\n             before ${ka}\n             after  ${kb}`);
    }
  }
  console.log(
    diffs === 0
      ? `\n>>> LAYOUT UNCHANGED across ${Object.keys(a).length} routes`
      : `\n>>> ${diffs} route(s) MOVED`,
  );
  process.exit(diffs === 0 ? 0 : 1);
}

async function main() {
  const cmp = argValue("compare");
  if (cmp) {
    const [x, y] = cmp.split(",");
    compare(x, y);
    return;
  }

  const outPath = argValue("out") ?? `layout-${WIDTH}.json`;
  const signInUrl = await mintSignInUrl(EMAIL);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    // Kills the staggered `.page-body > *` reveal animations, so a box is measured at its resting
    // position rather than mid-transform — the single biggest source of run-to-run wobble.
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(signInUrl, { waitUntil: "networkidle" });

  const result: Record<string, unknown> = {};
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800);
    result[route] = await page.evaluate(PROBE);
    console.log(`  probed ${route}`);
  }

  writeFileSync(outPath, JSON.stringify(result, null, 2));
  await browser.close();
  await prisma.$disconnect();
  console.log(`\nWrote ${outPath} (${WIDTH}x${HEIGHT})`);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
