import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { LAB_DEFAULT_FIELDS, encodeLabFields } from "../src/lib/rollCenter/labState";

/**
 * The drawing must be framed by the car, never by the roll-centre marker.
 *
 * The roll centre is the intersection of the two force lines. As it approaches ground level
 * those lines approach parallel, so the intersection runs away sideways — measured at +163mm
 * lateral on a 94mm contact patch (under lower arm 3.0, bump +2.5, roll 3°). Folding that into
 * the horizontal extents shrinks the car and slides it off centre, which is what this locks out.
 */

const OUT = "roll-center-lab-shots";
mkdirSync(OUT, { recursive: true });

const BUMP = /Chassis bump/;
const ROLL = /Chassis roll angle/;

/**
 * What the driver actually sees: how wide the car is drawn, where its centre sits, and how tall
 * the frame is. Measured off the tyre polygons, in viewBox units.
 *
 * A setup change (a shim) may legitimately reframe the drawing. A POSE change — roll, bump —
 * must not: the car is the same car, just standing differently.
 */
async function drawn(page: Page): Promise<{ span: number; centre: number; frameH: number }> {
  return page.evaluate(() => {
    const svg = document.querySelector("svg[role='img']") as SVGSVGElement | null;
    if (!svg) return { span: NaN, centre: NaN, frameH: NaN };
    const xs = [...svg.querySelectorAll("polygon")].flatMap((p) =>
      (p.getAttribute("points") ?? "").split(" ").filter(Boolean).map((pt) => Number(pt.split(",")[0])),
    );
    const vb = (svg.getAttribute("viewBox") ?? "0 0 360 0").split(" ").map(Number);
    return {
      span: Math.max(...xs) - Math.min(...xs),
      centre: (Math.min(...xs) + Math.max(...xs)) / 2,
      frameH: vb[3],
    };
  });
}

async function setPose(page: Page, bump: number, roll: number) {
  await page.getByLabel(BUMP).fill(String(bump));
  await page.getByLabel(ROLL).fill(String(roll));
  await page.waitForTimeout(220);
}

/*
 * 3mm under the lower arm puts the roll centre near ground level, which is where the force lines
 * go near-parallel and the marker runs away laterally. Seeded through the Lab's own URL codec
 * rather than typed into a knob: a fill that lands before React owns the controlled input is
 * silently discarded, and this test fooled itself that way once already. The seed is server-side,
 * so the shim is in the state before the first paint and cannot race anything.
 */
const SHIMMED = encodeLabFields({
  ...LAB_DEFAULT_FIELDS,
  under_lower_arm_shims_ff: "3",
  under_lower_arm_shims_fr: "3",
});

test("a runaway roll centre must not resize or off-centre the car", async ({ page }) => {
  await page.goto(`/analysis/roll-center?s=${SHIMMED}`);
  await expect(page.getByLabel(BUMP)).toBeVisible({ timeout: 30_000 });

  // Prove the precondition: without the shim this test would pass while exercising nothing.
  await expect(
    page.locator("div.grid.grid-cols-3").first(),
    "the shim must actually be applied",
  ).toContainText(/RC front\s*-2\.\d/, { timeout: 15_000 });

  await setPose(page, 5, 0);
  const rest = await drawn(page);
  await page.screenshot({ path: `${OUT}/10-framing-rest.png` });

  const poses: { label: string; bump: number; roll: number }[] = [
    { label: "bump 2.5, roll 3 (RC lateral ~+163mm)", bump: 2.5, roll: 3 },
    { label: "bump 0,   roll 3", bump: 0, roll: 3 },
    { label: "bump 10,  roll 3", bump: 10, roll: 3 },
    { label: "bump 2.5, roll 1.5", bump: 2.5, roll: 1.5 },
  ];

  console.log(`  rest: car span ${rest.span.toFixed(1)}, centre ${rest.centre.toFixed(1)}, frame h ${rest.frameH}`);
  const worst = { span: 0, centre: 0, frameH: 0 };
  for (const [i, p] of poses.entries()) {
    await setPose(page, p.bump, p.roll);
    const d = await drawn(page);
    const dSpan = Math.abs(d.span - rest.span) / rest.span;
    const dCentre = Math.abs(d.centre - rest.centre);
    const dFrame = Math.abs(d.frameH - rest.frameH) / rest.frameH;
    worst.span = Math.max(worst.span, dSpan);
    worst.centre = Math.max(worst.centre, dCentre);
    worst.frameH = Math.max(worst.frameH, dFrame);
    console.log(
      `  ${p.label.padEnd(38)} span ${d.span.toFixed(1)} (${(dSpan * 100).toFixed(2)}%)  ` +
        `centre ${d.centre.toFixed(1)} (${dCentre.toFixed(2)}u)  frame h ${d.frameH} (${(dFrame * 100).toFixed(2)}%)`,
    );
    await page.screenshot({ path: `${OUT}/1${i + 1}-framing-${p.bump}-${p.roll}.png` });
  }

  expect(worst.span, "the car must keep its drawn width through any pose").toBeLessThan(0.02);
  expect(worst.centre, "the car must stay put horizontally through any pose").toBeLessThan(2);
  expect(worst.frameH, "the frame must keep its height through any pose").toBeLessThan(0.02);
});
