/**
 * Dev only: are the sector lines drawn in the SAME place in the editor and in the viewer?
 *
 * Opens a job, goes to the Lines step, seeks the video to one frame, and reads where every line
 * lands on screen (client pixels) — then opens the line editor on the same frame and reads
 * again. Also reads where the painted video sits inside its box, because a line is only "where
 * it was drawn" if both views paint it over the same pixels of the picture.
 *
 *   JOB=<jobId> VIDEO_PATH=<file> node scripts/dev-line-placement.mjs [seekSec=200] [width=1280]
 */
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;
const SEEK = Number(process.argv[2] ?? 200);
const WIDTH = Number(process.argv[3] ?? 1280);

const browser = await chromium.launch({ channel: "msedge", headless: true });
process.on("uncaughtException", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });

const measure = () => {
  const v = document.querySelector("video");
  const vr = v.getBoundingClientRect();
  // Where the picture itself is painted inside the element (object-contain letterboxing).
  const va = v.videoWidth / v.videoHeight, ea = vr.width / vr.height;
  const pic = va >= ea
    ? { left: vr.left, top: vr.top + (vr.height - vr.width / va) / 2, width: vr.width, height: vr.width / va }
    : { left: vr.left + (vr.width - vr.height * va) / 2, top: vr.top, width: vr.height * va, height: vr.height * va / va * 1 };
  const svg = document.querySelector("svg[viewBox='0 0 1000 1000']");
  const sr = svg?.getBoundingClientRect();
  const lines = [...(svg?.querySelectorAll("line") ?? [])].map((l) => {
    const n = (a) => Number(l.getAttribute(a)) / 1000;
    return {
      key: l.parentElement?.querySelector ? null : null,
      x1: sr.left + n("x1") * sr.width, y1: sr.top + n("y1") * sr.height,
      x2: sr.left + n("x2") * sr.width, y2: sr.top + n("y2") * sr.height,
      nx1: n("x1"), ny1: n("y1"), nx2: n("x2"), ny2: n("y2"),
    };
  });
  const labels = [...document.querySelectorAll("svg[viewBox='0 0 1000 1000'] ~ span")].map((s) => s.textContent);
  return { t: v.currentTime, video: { w: v.videoWidth, h: v.videoHeight }, box: { l: vr.left, t: vr.top, w: vr.width, h: vr.height }, pic, overlay: sr ? { l: sr.left, t: sr.top, w: sr.width, h: sr.height } : null, lines, labels };
};

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(1) : v}`).join(" ");

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 950 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator('input[type="file"]').first().setInputFiles(VIDEO);
  await page.waitForTimeout(1500);
  await page.locator("button:visible", { hasText: /^Lines$/ }).first().click({ timeout: 20000 });
  await page.waitForFunction(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 60000 });
  await page.evaluate((t) => { document.querySelector("video").currentTime = t; }, SEEK);
  await page.waitForTimeout(1500);
  const viewer = await page.evaluate(measure);
  await page.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/placement-viewer.png` });

  // Open the editor on the same frame.
  const openBtn = page.locator("button:visible", { hasText: /Draw sector lines|Edit lines|Edit the lines|Adjust/i }).first();
  if (!(await openBtn.count())) throw new Error("no editor button found on the Lines step");
  await openBtn.click();
  await page.waitForTimeout(1500);
  const editor = await page.evaluate(measure);
  await page.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/placement-editor.png` });

  for (const [name, m] of [["viewer", viewer], ["editor", editor]]) {
    console.log(`\n== ${name} @ t=${m.t.toFixed(3)} video ${m.video.w}x${m.video.h}`);
    console.log(`  box     ${fmt(m.box)}`);
    console.log(`  picture ${fmt(m.pic)}`);
    console.log(`  overlay ${m.overlay ? fmt(m.overlay) : "none"}`);
    m.lines.forEach((l, i) => console.log(`  line ${String(m.labels[i] ?? i).padEnd(14)} (${l.x1.toFixed(1)},${l.y1.toFixed(1)})→(${l.x2.toFixed(1)},${l.y2.toFixed(1)})  norm (${l.nx1.toFixed(4)},${l.ny1.toFixed(4)})→(${l.nx2.toFixed(4)},${l.ny2.toFixed(4)})`));
  }
  console.log("\n== editor minus viewer, client px");
  const byKey = new Map(viewer.labels.map((k, i) => [k, viewer.lines[i]]));
  editor.labels.forEach((k, i) => {
    const a = byKey.get(k), b = editor.lines[i];
    if (!a || !b) { console.log(`  ${k}: only in ${a ? "viewer" : "editor"}`); return; }
    console.log(`  ${String(k).padEnd(14)} Δ(${(b.x1 - a.x1).toFixed(1)},${(b.y1 - a.y1).toFixed(1)}) Δ(${(b.x2 - a.x2).toFixed(1)},${(b.y2 - a.y2).toFixed(1)})`);
  });
  console.log(`  overlay vs picture (viewer): Δleft ${(viewer.overlay.l - viewer.pic.left).toFixed(1)} Δtop ${(viewer.overlay.t - viewer.pic.top).toFixed(1)} Δw ${(viewer.overlay.w - viewer.pic.width).toFixed(1)} Δh ${(viewer.overlay.h - viewer.pic.height).toFixed(1)}`);
  console.log(`  overlay vs picture (editor): Δleft ${(editor.overlay.l - editor.pic.left).toFixed(1)} Δtop ${(editor.overlay.t - editor.pic.top).toFixed(1)} Δw ${(editor.overlay.w - editor.pic.width).toFixed(1)} Δh ${(editor.overlay.h - editor.pic.height).toFixed(1)}`);
} finally {
  await browser.close();
}
