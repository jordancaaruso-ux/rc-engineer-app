/**
 * typography-audit — the regression net for the 2026-08-14 one-voice pass.
 *
 * `light-mode-audit.spec.ts` is the colour net; this is the type one. It exists because every
 * drifted row listed at the top of VISUAL_NORTH_STAR.md drifted for the same reason: nothing
 * failed when it did. A rule written only in prose is a rule that decays. Four assertions:
 *
 *   1. ONE FACE      — every visible element resolves to Sora, or Space Grotesk inside the
 *                      three title selectors, or the platform mono stack inside `.type-machine`
 *                      / <pre> / <code>. Catches a reintroduced webfont, a stray `font-mono`,
 *                      and display-face creep onto cards.
 *   2. FIGURES ARE   — any element whose own text reads as a figure must compute
 *      TABULAR         `tabular-nums`. Sora's digits are proportional without it, so this is
 *                      the assertion that keeps columns straight.
 *   3. NO RE-DRIFT   — the seven sizes the ramp absorbed (9.5, 10.5, 11.5, 12.5, 14, 17, 19)
 *                      must not reappear on a figure. The full size histogram is always
 *                      written to the report, pass or fail.
 *   4. tnum IS REAL  — measures digit widths in the live page. Google's subsetter does not
 *                      keep `tnum` by default; if it ever stops shipping it, this goes red
 *                      instead of every column silently starting to wobble.
 *
 * Second axis is VIEWPORT, not theme: the micro-caps labels and everything under
 * dashboard/desktop and events/desktop sit behind md:/lg: and are invisible at 390 alone.
 *
 *   npx playwright test e2e/typography-audit.spec.ts --project=mobile-chromium
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { withDetailSurfaces } from "./surfaces";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(3_600_000);

const OUT = "typography-audit";

/** Widths the ramp deliberately absorbed. Their return means the ramp is leaking. */
const RETIRED_SIZES = [9.5, 10.5, 11.5, 12.5, 14, 17, 19];

/** Sizes a figure is allowed to be: the six ramp steps, plus documented exceptions. */
const RAMP = [10, 11, 13, 18, 26];
/**
 * Off-ramp by design, each with a reason:
 *  30 — CarHandlingRatingQuickPick's 1–10 readout: one-glyph labels on a control, not a column.
 *  56 / 66.24 — `.fig-display`'s clamp resolved at 390px (floors to 3.5rem) and at 1440px (4.6vw).
 */
const DOCUMENTED_EXCEPTIONS = [30, 56, 66.24];

test("one face, tabular figures, and a closed ramp on every page", async ({ page, baseURL }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // ── Sign in as the demo account (a full anonymised season, so pages have content) ──
  const out = execFileSync(
    "npx",
    [
      "dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server",
      "--import", "tsx", "scripts/dev-demo-signin.ts",
    ],
    { encoding: "utf8", shell: true, timeout: 180_000 },
  );
  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  // Same guard as the colour audit — this walks every page of a real account.
  if (/ep-hidden-rice/.test(dbHost)) throw new Error(`REFUSING: pointed at PRODUCTION (${dbHost})`);
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);
  const ids: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+_ID)=(\S*)$/gm)) if (m[2]) ids[m[1]] = m[2];

  await page.context().addCookies([
    { name: "rc_tz", value: "Australia/Melbourne", domain: "localhost", path: "/" },
  ]);
  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  const SURFACES = withDetailSurfaces(ids);

  const load = async (path: string) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (document.querySelector("main, body")?.textContent?.trim().length ?? 0) > 40,
      undefined,
      { timeout: 45_000 },
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1200);
  };

  type Violation = { slug: string; width: number; kind: string; detail: string };
  const violations: Violation[] = [];
  const sizeHistogram: Record<string, number> = {};
  const sizeExamples: Record<string, string> = {};
  const failedPages: string[] = [];
  let elementsChecked = 0;
  let tnumChecks = 0;

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });

    for (const s of SURFACES) {
      try {
        await load(s.path);

        const result = await page.evaluate(() => {
          const visible = (el: Element) => {
            const st = getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
              return false;
            }
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          /** Text belonging to THIS element, not inherited from descendants. */
          const ownText = (el: Element) =>
            Array.from(el.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent ?? "")
              .join("")
              .trim();

          const faceProblems: { detail: string }[] = [];
          const tabProblems: { detail: string }[] = [];
          const sizes: Record<string, number> = {};
          const examples: Record<string, string> = {};
          let checked = 0;

          /**
           * Two regions are deliberately not app type:
           *  · `[data-sheet-box]` — the setup-sheet fill surface draws values over a rendered
           *    picture of the PDF page, using that PDF's OWN field fonts (Helvetica, Verdana…)
           *    from `pdfFieldAppearance.ts`. It is a facsimile of the printed sheet, so making
           *    it match the app's face would make it stop matching the paper.
           *  · Next.js's built-in error page (`.next-error-h1`) ships its own inline styles.
           */
          const onNextErrorPage = document.querySelector(".next-error-h1") !== null;
          const exempt = (el: Element) =>
            onNextErrorPage || el.closest("[data-sheet-box]") !== null;

          for (const el of Array.from(document.querySelectorAll("body *"))) {
            const text = ownText(el);
            if (!text || !visible(el) || exempt(el)) continue;
            checked++;
            const st = getComputedStyle(el);
            const firstFamily = st.fontFamily.split(",")[0].replace(/["']/g, "").trim();

            // ── 1. one face ──
            const isSora = /Sora/i.test(firstFamily);
            // next/font mangles the family name ("__Space_Grotesk_abc123"), but a plain
            // build reports "Space Grotesk" — allow both spellings.
            const isDisplay = /Space[\s_]?Grotesk/i.test(firstFamily);
            const isMono = /mono|consolas|menlo|courier/i.test(firstFamily);
            if (isDisplay) {
              if (!el.closest(".page-title, .page-title-condensed, .demo-door-title")) {
                faceProblems.push({
                  detail: `Space Grotesk outside a title selector: <${el.tagName.toLowerCase()} class="${el.className}"> "${text.slice(0, 40)}"`,
                });
              }
            } else if (isMono) {
              if (!el.closest(".type-machine, pre, code, kbd, samp")) {
                faceProblems.push({
                  detail: `monospace outside .type-machine: <${el.tagName.toLowerCase()} class="${el.className}"> "${text.slice(0, 40)}"`,
                });
              }
            } else if (!isSora) {
              faceProblems.push({
                detail: `unexpected face "${firstFamily}": <${el.tagName.toLowerCase()} class="${el.className}"> "${text.slice(0, 40)}"`,
              });
            }

            // ── 2 + 3. figures ──
            // A "figure" is text made only of digits and numeric punctuation — deliberately
            // strict, so a sentence that happens to contain a number isn't dragged in.
            const isFigure = /\d/.test(text) && /^[\s\d.,:+\-–—%°/]+$/.test(text);
            if (isFigure) {
              if (!st.fontVariantNumeric.includes("tabular-nums")) {
                tabProblems.push({
                  detail: `figure without tabular-nums: "${text.slice(0, 24)}" <${el.tagName.toLowerCase()} class="${el.className}">`,
                });
              }
              // Only DOM text is measured against the ramp. Inside an <svg> the computed
              // font-size is in viewBox user units, which the viewport scales by an
              // arbitrary factor — 7.5 user units can render as anything. Those labels
              // are still checked for face and tabular-nums above; their size is governed
              // by the rendered-pixel rule in chartAxis.ts, not by this histogram.
              if (!el.closest("svg")) {
                const px = Math.round(parseFloat(st.fontSize) * 100) / 100;
                sizes[String(px)] = (sizes[String(px)] ?? 0) + 1;
                // Keep one example per size so a ramp failure names an element to go fix,
                // rather than just a count nobody can act on.
                examples[String(px)] ??=
                  `"${text.slice(0, 18)}" <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}">`;
              }
            }
          }

          // ── 4. is tnum actually applied by the browser, in the real page? ──
          const probe = document.createElement("span");
          probe.style.cssText =
            "position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-variant-numeric:tabular-nums";
          document.body.appendChild(probe);
          const tabularWidths = [..."0123456789"].map((d) => {
            probe.textContent = d;
            return Math.round(probe.getBoundingClientRect().width * 100) / 100;
          });
          probe.style.fontVariantNumeric = "normal";
          const propWidths = [..."0123456789"].map((d) => {
            probe.textContent = d;
            return Math.round(probe.getBoundingClientRect().width * 100) / 100;
          });
          const bodyFamily = getComputedStyle(document.body).fontFamily;
          probe.remove();

          return { faceProblems, tabProblems, sizes, examples, checked, tabularWidths, propWidths, bodyFamily };
        });

        elementsChecked += result.checked;
        for (const [px, n] of Object.entries(result.sizes)) {
          sizeHistogram[px] = (sizeHistogram[px] ?? 0) + n;
        }
        for (const [px, ex] of Object.entries(result.examples)) {
          sizeExamples[px] ??= `${s.slug}: ${ex}`;
        }
        for (const p of result.faceProblems) {
          violations.push({ slug: s.slug, width, kind: "face", detail: p.detail });
        }
        for (const p of result.tabProblems) {
          violations.push({ slug: s.slug, width, kind: "tabular", detail: p.detail });
        }

        // tnum probe — must collapse to a single width, and must not be a fallback measurement
        tnumChecks++;
        const uniqTab = new Set(result.tabularWidths);
        const identical =
          JSON.stringify(result.tabularWidths) === JSON.stringify(result.propWidths);
        if (!/Sora/i.test(result.bodyFamily)) {
          violations.push({
            slug: s.slug, width, kind: "tnum",
            detail: `body is not Sora (${result.bodyFamily}) — font failed to load`,
          });
        } else if (identical || uniqTab.size !== 1) {
          violations.push({
            slug: s.slug, width, kind: "tnum",
            detail: `tabular-nums not applied — widths ${result.tabularWidths.join(", ")}`,
          });
        }
      } catch (err) {
        failedPages.push(`${s.slug} @${width}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }

  // ── 3. retired sizes must not reappear on a figure ──
  const reDrift = Object.keys(sizeHistogram)
    .map(Number)
    .filter((px) => RETIRED_SIZES.includes(px));
  for (const px of reDrift) {
    violations.push({
      slug: "(any)", width: 0, kind: "ramp",
      detail: `retired size ${px}px is back on ${sizeHistogram[String(px)]} figure(s) — absorbed by the ramp. e.g. ${sizeExamples[String(px)] ?? "(no example)"}`,
    });
  }

  const offRamp = Object.keys(sizeHistogram)
    .map(Number)
    .filter((px) => !RAMP.includes(px) && !DOCUMENTED_EXCEPTIONS.some((e) => Math.abs(e - px) < 1.5));

  // ── report, written pass or fail ──
  const byKind = (k: string) => violations.filter((v) => v.kind === k);
  const md = [
    "# Typography audit",
    "",
    `${SURFACES.length} pages × 2 viewports · ${elementsChecked} text elements · ${tnumChecks} tnum probes.`,
    "",
    "## Figure size histogram",
    "",
    "| size | figures | on the ramp? |",
    "|---|---:|---|",
    ...Object.keys(sizeHistogram)
      .map(Number)
      .sort((a, b) => a - b)
      .map((px) => {
        const on = RAMP.includes(px)
          ? "ramp step"
          : DOCUMENTED_EXCEPTIONS.some((e) => Math.abs(e - px) < 1.5)
            ? "documented exception"
            : RETIRED_SIZES.includes(px)
              ? "**RETIRED — re-drift**"
              : "off-ramp";
        return `| ${px}px | ${sizeHistogram[String(px)]} | ${on} |`;
      }),
    "",
    ...(offRamp.length
      ? ["> Off-ramp sizes present (not a failure, but worth a look): " + offRamp.join(", "), ""]
      : []),
    "## Violations",
    "",
    ...(violations.length
      ? (["face", "tabular", "ramp", "tnum"] as const).flatMap((k) =>
          byKind(k).length
            ? [`### ${k} (${byKind(k).length})`, "", ...byKind(k).slice(0, 60).map((v) => `- \`${v.slug}\` @${v.width}: ${v.detail}`), ""]
            : [],
        )
      : ["None. One face, every figure tabular, ramp closed.", ""]),
    ...(failedPages.length ? ["## Pages that failed to load", "", ...failedPages.map((f) => `- ${f}`)] : []),
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, md, "utf8");

  if (failedPages.length) throw new Error(`pages failed to load:\n${failedPages.join("\n")}`);
  expect(violations, `see ${OUT}/report.md`).toEqual([]);
});
