/**
 * Dev only: how fast does a Playwright-driven Edge actually HAND OVER frames of this video?
 *
 * dev-probe-hevc.mjs answers "can it decode at all"; this answers the question the sector scan
 * lives on — at a given playback rate, what is the gap between consecutive frames in media
 * time? The scan calls a stretch starved when the median gap is over 100ms (three frames of a
 * 30fps file), which is what "Too quick to read" means. Run this before blaming the app.
 *
 *   VIDEO_PATH=... node scripts/dev-probe-frames.mjs [startSec=80] [spanSec=2]
 */
import { chromium } from "@playwright/test";
const VIDEO = process.env.VIDEO_PATH;
const START = Number(process.argv[2] ?? 80);
const SPAN = Number(process.argv[3] ?? 2);

const browser = await chromium.launch({
  channel: "msedge",
  // HEADLESS=1 runs the branded Edge in its new headless mode — no window on the desktop for a
  // person to minimise. Whether it still decodes HEVC is exactly what this probe is for.
  headless: process.env.HEADLESS === "1",
  args: [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
process.on("uncaughtException", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });
try {
  const page = await browser.newPage();
  await page.setContent(`<input type="file" id="f"><video id="v" muted playsinline style="width:688px"></video>
    <script>
      document.getElementById("f").addEventListener("change", (e) => {
        const v = document.getElementById("v");
        v.src = URL.createObjectURL(e.target.files[0]);
        v.load();
      });
      window.probe = (start, span, rate) => new Promise((resolve) => {
        const v = document.getElementById("v");
        const media = [], wall = [];
        let lastT = null, lastW = null, done = false;
        const finish = () => { if (done) return; done = true; v.pause(); resolve({ media, wall }); };
        const tick = (now, meta) => {
          const t = meta.mediaTime;
          if (lastT != null && t > lastT) media.push(Math.round((t - lastT) * 1000));
          if (lastW != null) wall.push(Math.round(now - lastW));
          lastT = t; lastW = now;
          if (t >= start + span) return finish();
          v.requestVideoFrameCallback(tick);
        };
        v.onseeked = () => { v.onseeked = null; v.playbackRate = rate; v.requestVideoFrameCallback(tick); v.play(); };
        v.currentTime = start;
        setTimeout(finish, (span / rate) * 1000 + 8000);
      });
    </script>`);
  await page.locator("#f").setInputFiles(VIDEO);
  await page.waitForFunction(() => { const v = document.getElementById("v"); return v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 60000 });
  console.log(`edge ${await browser.version()} ${process.env.HEADLESS === "1" ? "headless" : "headed"} · ${await page.evaluate(() => { const v = document.getElementById("v"); return `${v.videoWidth}x${v.videoHeight}`; })}`);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  for (const rate of [1, 0.5, 0.25]) {
    const r = await page.evaluate(([s, sp, rt]) => window.probe(s, sp, rt), [START, SPAN, rate]);
    console.log(`rate ${rate}: ${r.media.length + 1} frames over ${SPAN}s of video · median media gap ${med(r.media)}ms (starved if >100) · median wall gap ${med(r.wall)}ms · worst media gap ${Math.max(...r.media, 0)}ms`);
  }
} finally {
  await browser.close();
}
