/**
 * Dev only: do the sector lines land on the same bit of PICTURE at every step of the analyze flow?
 *
 *   JOB=<jobId> VIDEO_PATH=<file> [VIEWPORT=390x844] [HEADED=1] node scripts/dev-measure-lines.mjs
 *
 * Walks Lines → Edit lines → Save → Sync → Mark on a job and, at each stop, measures two things
 * straight out of the DOM: the box the line overlay is normalised to, and the rectangle the video
 * is actually painted in (its element rect, then object-contain maths on videoWidth/videoHeight).
 * If those two disagree the lines are being drawn against black bars, and every line's position
 * ON THE PICTURE is printed as a fraction so a shift between steps shows as a number, not a feeling.
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;
const [vw, vh] = (process.env.VIEWPORT ?? "1280x950").split("x").map(Number);
const phone = vw < 700;

const browser = await chromium.launch({
  channel: "msedge",
  headless: process.env.HEADED !== "1",
  args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-features=CalculateNativeWinOcclusion"],
});
const ctx = await browser.newContext(
  phone
    ? { ...devices["iPhone 13"], viewport: { width: vw, height: vh }, deviceScaleFactor: 2 }
    : { viewport: { width: vw, height: vh } }
);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [err]", m.text().slice(0, 160)); });

for (let i = 0; i < 4; i++) { try { await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded", timeout: 20000 }); break; } catch (e) { console.log("  sign-in retry", i + 1); await page.waitForTimeout(3000); } }
await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.locator('input[type="file"]').first().setInputFiles(VIDEO);
await page.waitForTimeout(1500);

async function measure(label) {
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return { noVideo: true };
    // Remount + event bookkeeping: a tag on the element survives only if React kept the node.
    window.__vid = window.__vid ?? { mounts: 0, meta: 0, resize: 0 };
    if (!v.__tagged) { v.__tagged = true; window.__vid.mounts++; v.addEventListener("loadedmetadata", () => window.__vid.meta++); v.addEventListener("resize", () => window.__vid.resize++); }
    const vr = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    // object-contain: the painted picture inside the element box
    let painted = null;
    if (vw && vh && vr.width && vr.height) {
      const ea = vr.width / vr.height, va = vw / vh;
      if (va >= ea) { const h = vr.width / va; painted = { left: vr.left, top: vr.top + (vr.height - h) / 2, width: vr.width, height: h }; }
      else { const w = vr.height * va; painted = { left: vr.left + (vr.width - w) / 2, top: vr.top, width: w, height: vr.height }; }
    }
    const svg = document.querySelector('svg[viewBox="0 0 1000 1000"]');
    const overlay = svg?.parentElement;
    const or = overlay?.getBoundingClientRect();
    const lines = svg
      ? [...svg.querySelectorAll("line")].filter((l) => !(l.getAttribute("key") ?? "").startsWith("band")).map((l) => ({
          x1: Number(l.getAttribute("x1")) / 1000, y1: Number(l.getAttribute("y1")) / 1000,
          x2: Number(l.getAttribute("x2")) / 1000, y2: Number(l.getAttribute("y2")) / 1000,
          dashed: !!l.getAttribute("stroke-dasharray"), w: Number(l.getAttribute("stroke-width")),
        }))
      : [];
    const box = v.parentElement?.getBoundingClientRect();
    return {
      video: { w: vw, h: vh, rect: { l: vr.left, t: vr.top, w: vr.width, h: vr.height } },
      box: box ? { l: box.left, t: box.top, w: box.width, h: box.height, aspect: box.width / box.height } : null,
      painted,
      overlay: or ? { l: or.left, t: or.top, w: or.width, h: or.height } : null,
      lines,
      readyState: v.readyState,
      life: { ...window.__vid, sameNode: !!v.__tagged },
    };
  });
  console.log(`\n== ${label}`);
  if (m.noVideo) { console.log("   no <video> on this step"); return; }
  const f = (n) => n.toFixed(1);
  console.log(`   element mounts so far ${m.life.mounts} · loadedmetadata since tag ${m.life.meta} · resize ${m.life.resize}`);
  console.log(`   video ${m.video.w}x${m.video.h} rs${m.readyState}  box ${f(m.box.w)}x${f(m.box.h)} (aspect ${m.box.aspect.toFixed(3)} vs frame ${(m.video.w / m.video.h).toFixed(3)})`);
  if (!m.painted || !m.overlay) { console.log("   painted/overlay missing", JSON.stringify({ painted: m.painted, overlay: m.overlay })); return; }
  const p = m.painted, o = m.overlay;
  console.log(`   painted ${f(p.left)},${f(p.top)} ${f(p.width)}x${f(p.height)}   overlay ${f(o.l)},${f(o.t)} ${f(o.w)}x${f(o.h)}   mismatch dx ${f(o.l - p.left)} dy ${f(o.t - p.top)} dw ${f(o.w - p.width)} dh ${f(o.h - p.height)}`);
  // Where each drawn line lands ON THE PICTURE, as fractions of the painted frame.
  const onPic = (x, y) => [((o.l + x * o.w) - p.left) / p.width, ((o.t + y * o.h) - p.top) / p.height];
  const wide = m.lines.filter((l) => l.w > 2).length;
  for (const l of m.lines.filter((l) => l.w <= 2)) {
    const a = onPic(l.x1, l.y1), b = onPic(l.x2, l.y2);
    console.log(`   line${l.dashed ? " (sf)" : ""}: overlay (${l.x1.toFixed(3)},${l.y1.toFixed(3)})→(${l.x2.toFixed(3)},${l.y2.toFixed(3)})   on picture (${a[0].toFixed(3)},${a[1].toFixed(3)})→(${b[0].toFixed(3)},${b[1].toFixed(3)})`);
  }
  if (wide) console.log(`   (+${wide} band strokes)`);
}

const dismissInstall = () => page.evaluate(() => document.querySelectorAll("[role=dialog][aria-label=\"Install JRC Trackside\"]").forEach((d) => d.remove()));
const clickStep = async (name) => {
  await dismissInstall();
  await page.locator("button:visible", { hasText: new RegExp(`^${name}$`) }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
};

await clickStep("Lines");
await page.waitForFunction(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 120000 });
await measure("Lines step (preview of the set)");
await dismissInstall();
await page.getByRole("button", { name: /Edit lines/ }).first().click({ timeout: 10000 });
await measure("Lines step, editing (draft)");
// Nudge one endpoint by a known amount so a real edit is in the saved set, then save.
const handle = page.locator("button[aria-label*='S1'], button[aria-label*='s1']").first();
if (await handle.count()) {
  const hb = await handle.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2 + 12, hb.y + hb.height / 2 + 6, { steps: 6 }); await page.mouse.up();
    await measure("Lines step, after dragging an S1 end +12,+6px");
  }
} else console.log("   (no S1 handle found by aria-label — skipping the drag)");
// The PWA install prompt sits over the rail on a phone and eats the click.
await page.evaluate(() => document.querySelectorAll("[role=dialog][aria-label=\"Install JRC Trackside\"]").forEach((d) => d.remove()));
await page.getByRole("button", { name: /^Save lines$/ }).first().click({ timeout: 10000 });
await page.waitForTimeout(1500);
// Answer the new-set / this-set question if it appears.
const thisSet = page.getByRole("button", { name: /this set|Update/i }).first();
if (await thisSet.count()) { await thisSet.click(); await page.waitForTimeout(1500); }
await measure("Lines step, after Save");
await clickStep("Sync");
await measure("Sync step");
await clickStep("Mark");
await measure("Mark step");
await page.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/measure-${vw}x${vh}.png`, fullPage: false });
await browser.close();
