/**
 * Does the card's height estimate actually fit the card?
 *
 * Satori lays out into a fixed box and CLIPS the overflow — silently, with no error anywhere — so
 * an under-estimate in `estimateCardHeight` eats the footer and nothing but a rendered picture
 * will say so. `npm run test:share` pins the arithmetic; this measures the arithmetic against
 * pixels.
 *
 * How it works: render each card 2000px taller than its estimate and find the last row that isn't
 * bare card ground. That is where the footer's mark ends; add the footer's own bottom padding and
 * you have the card's TRUE natural height.
 *
 * `slack` is `estimate − natural`. A small positive number is right: a few pixels of ground under
 * the footer read as breathing room. A NEGATIVE slack means the card is clipped in production —
 * the footer is off the bottom of the real picture. A LARGE positive one is a dead band of empty
 * charcoal hanging off the end of every share, which is just as wrong and much easier to miss.
 *
 * Note the renderer does NOT use `margin-top: auto` on the footer: satori ignores auto margins, so
 * the footer would simply sit wherever the content left it and the padding would be a lie.
 *
 *   node --conditions=react-server --import tsx scripts/dev-share-card-fit.ts
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  allSectionsOn,
  buildShareRunCard,
  type BuildShareCardParams,
  type ShareCardStyle,
  type ShareRunInput,
} from "@/lib/share/shareCardModel";
import { renderRunCard } from "@/lib/share/renderRunCard";
import { SHARE_DARK } from "@/lib/share/shareTheme";

const HEADROOM = 2000;
/** `Footer`, measured from its own rule: 1px rule + 44 padding + a 38px mark + 44 padding. */
const FOOTER_FROM_RULE = 1 + 44 + 38 + 44;

const LAPS = [
  15.612, 15.388, 15.201, 15.114, 15.276, 15.198, 15.34, 15.402, 15.887, 15.455,
  15.298, 15.221, 15.377, 15.509, 15.664, 15.812, 16.104, 16.398, 15.744,
];

const RUN: ShareRunInput = {
  sessionType: "RACE_MEETING",
  meetingSessionType: "QUALIFYING",
  sessionLabel: "Q2",
  lapTimes: LAPS,
  notes:
    "Loose on entry from the second lap once the fronts came in. Mid corner is fine. Rear steps out under brakes into 1 and 3 — had to be gentle with it. Traction rolled away in the last ninety seconds and I couldn't hold the line through the sweeper.",
  carRating: 7,
  tireRunNumber: 3,
  warmerTimingMinutes: 12,
  conditionsAirTempC: 24,
  conditionsTrackTempC: 31,
  conditionsWindKph: 11,
  car: { name: "Awesomatix A800RR" },
  track: { name: "Barton Park Raceway" },
  tireType: { displayName: "Volante VT-R2" },
  additiveType: { displayName: "Trinity Death Row" },
  event: { name: "Round 4 — NSW State Series" },
  handlingAssessmentJson: {
    version: 6,
    balanceByPhase: { entry: -2, mid: 0, exit: 1 },
    feelSteering: 1,
    onPower: -1,
    braking: -2,
    driveEase: -1,
    tractionRoll: 0,
  },
};

const SETUP = { ride_height_rear: "5.5", toe_rear: "2.5" };
const PREVIOUS_SETUP = { ride_height_rear: "5.0", toe_rear: "2.0" };

const BARE = { details: false, laps: false, graph: false, setup: false, notes: false, feel: false };

/**
 * The y of the footer's own rule — the last hairline that spans the full 1080.
 *
 * Anchoring on the rule rather than on the last inked pixel because the JRC mark's glyph does not
 * reach the bottom of its box: measuring ink read ~19px short on every card, which is exactly the
 * kind of quiet bias that would have me "fixing" a constant that was already right.
 */
async function footerRuleY(png: Buffer, width: number, height: number): Promise<number> {
  const image = await loadImage(png);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const bg = SHARE_DARK.bg.replace("#", "");
  const [br, bg2, bb] = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];

  // Anti-aliasing means "bare" cannot be exact; 6 levels is well inside one hairline's contrast.
  const inked = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    return (
      Math.abs(data[i]! - br) > 6 ||
      Math.abs(data[i + 1]! - bg2) > 6 ||
      Math.abs(data[i + 2]! - bb) > 6
    );
  };

  // Full width, not merely wide: every well and lap block is inset by the 56px page padding, so
  // reaching x = 4 and x = width − 4 is what makes a row the footer's rule and nothing else.
  for (let y = height - 1; y >= 0; y--) {
    if (!inked(4, y) || !inked(width - 5, y)) continue;
    let lit = 0;
    for (let x = 0; x < width; x += 8) if (inked(x, y)) lit++;
    if (lit > width / 8 - 4) return y;
  }
  return -1;
}

async function measure(name: string, style: ShareCardStyle, overrides: Partial<BuildShareCardParams>) {
  const card = buildShareRunCard({
    run: RUN,
    style,
    sections: allSectionsOn(),
    dateTimeLabel: "Sun 9 Aug · 10:42",
    dateStamp: "SUN 9 AUG 2026",
    driverName: "Jordan Caruso",
    setupData: SETUP,
    previousSetupData: PREVIOUS_SETUP,
    ...overrides,
  });

  const estimate = card.height;
  const tall = { ...card, height: estimate + HEADROOM };
  const png = Buffer.from(await renderRunCard(tall).arrayBuffer());
  const natural = (await footerRuleY(png, 1080, tall.height)) + FOOTER_FROM_RULE;
  const slack = estimate - natural;

  const verdict = slack < 0 ? `CLIPPED by ${-slack}px` : `${slack}px spare`;
  console.log(
    `${name.padEnd(14)} estimate ${String(estimate).padStart(5)}  natural ${String(natural).padStart(5)}  ${verdict}`
  );
  return slack;
}

async function main() {
  const long: Partial<BuildShareCardParams> = {
    run: { ...RUN, lapTimes: [...LAPS, ...LAPS, 15.9], notes: `${RUN.notes} ${RUN.notes}` },
  };

  const slacks = [
    await measure("hero", "hero", {}),
    await measure("report", "report", {}),
    await measure("hero-bare", "hero", { sections: BARE }),
    await measure("report-bare", "report", { sections: BARE }),
    await measure("hero-long", "hero", long),
    await measure("report-long", "report", long),
    await measure("hero-nofeel", "hero", { sections: { ...allSectionsOn(), feel: false } }),
    await measure("report-nolaps", "report", { sections: { ...allSectionsOn(), laps: false } }),
  ];

  const worst = Math.min(...slacks);
  console.log(`\nworst case: ${worst < 0 ? `CLIPPED by ${-worst}px` : `${worst}px spare`}`);
  if (worst < 0) process.exitCode = 1;
}

void main();
