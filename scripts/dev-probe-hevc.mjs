/**
 * Dev only: can a Playwright-driven browser decode this video at all?
 *
 * Loads the file into a bare <video> in each channel and reports what the element says. Run
 * before blaming the app or the machine: the sector scan needs decoded frames, and a browser
 * that cannot decode HEVC reports nothing wrong — it just never presents a frame.
 */
import { chromium } from "@playwright/test";
const VIDEO = process.env.VIDEO_PATH;

for (const channel of ["msedge", "chrome"]) {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: false });
    const page = await browser.newPage();
    await page.setContent(`<input type="file" id="f"><video id="v" muted playsinline></video>
      <script>
        document.getElementById("f").addEventListener("change", (e) => {
          const v = document.getElementById("v");
          v.src = URL.createObjectURL(e.target.files[0]);
          v.load();
        });
      </script>`);
    const t0 = Date.now();
    await page.locator("#f").setInputFiles(VIDEO);
    const attachedMs = Date.now() - t0;
    const state = await page.waitForFunction(
      () => {
        const v = document.getElementById("v");
        if (v.error) return { error: v.error.code, message: v.error.message };
        if (v.readyState >= 1 && v.videoWidth > 0) return { w: v.videoWidth, h: v.videoHeight, duration: Math.round(v.duration) };
        return null;
      },
      null,
      { timeout: 60000 }
    ).then((h) => h.jsonValue()).catch(() => ({ timeout: true }));
    const ver = await browser.version();
    console.log(`${channel} ${ver}: attached in ${attachedMs}ms → ${JSON.stringify(state)}`);
  } catch (e) {
    console.log(`${channel}: ${e?.message?.split("\n")[0]}`);
  } finally {
    try { await browser?.close(); } catch {}
  }
}
