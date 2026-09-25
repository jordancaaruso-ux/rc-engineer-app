/**
 * Builds the bundle for the Claude Design design-system project "JRC Dynamics"
 * (claude.ai/design, projectId 6d4f2747-4d51-4d04-a89d-de20da5e1e7e) into `design-system/out/`.
 *
 *   npx tsx scripts/design-system/build.tsx
 *
 * Then push `design-system/out/` with Claude Code's DesignSync tool: list_files → finalize_plan
 * (localDir = design-system/out) → write_files → delete_files for anything the project holds that
 * the new bundle no longer does. DesignSync needs `/design-login` once from an interactive session.
 *
 * Nothing here is drawn by hand from memory. The app half comes from the code that ships:
 *   - tokens/app.css is `src/app/globals.css` compiled by the same Tailwind the app builds with,
 *     so every card below renders with the app's real classes.
 *   - tokens/app-colors.css is the paper values read out of globals.css.
 *   - the component cards render the real `src/components/ui/` components.
 * The website half is `public/landing/` copied as-is (paths made relative) into
 * ui_kits/website/, plus `design-system/website-tokens.css`, which is the one hand-kept file:
 * the landing page has no token source of its own, only inline styles.
 * `design-system/README.md` is the guide Claude Design reads first.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

import { Button } from "@/components/ui/Button";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PillToggle } from "@/components/ui/PillToggle";
import { Spinner } from "@/components/ui/Spinner";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";
import { SectionTitle } from "@/components/ui/SectionTitle";
import * as Icons from "@/components/icons/JRCIcons";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "design-system");
const OUT = path.join(SRC, "out");

const noop = () => {};
const html = (el: ReactElement) => renderToStaticMarkup(el);

function write(rel: string, data: string | Buffer) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

function copy(from: string, rel: string) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  copyFileSync(path.join(ROOT, from), file);
}

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────

/** See compile-app-css.mjs for why this runs in a separate plain-Node process. */
function compileAppCss(rel: string) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, "scripts/design-system/compile-app-css.mjs"), file], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

/** The custom properties of one top-level block of globals.css, in order, with their comments. */
function readBlock(css: string, selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`globals.css has no top-level "${selector} {" block`);
  const end = css.indexOf("\n}", start);
  const vars = new Map<string, string>();
  for (const line of css.slice(start, end).split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+):\s*([^;]+);\s*(\/\*.*\*\/)?/);
    if (m) vars.set(m[1], `${m[2].trim()};${m[3] ? ` ${m[3]}` : ""}`);
  }
  return vars;
}

function appColorsCss(globals: string) {
  const paper = new Map([...readBlock(globals, ":root"), ...readBlock(globals, ':root[data-theme="light"]')]);
  const lines = [...paper]
    .filter(([name]) => name.startsWith("--color-") || name === "--page-bg-rgb")
    .map(([name, value]) => `  ${name}: ${value}`);
  return [
    "/* JRC Trackside app colours, as they ship. Generated from src/app/globals.css by",
    "   scripts/design-system/build.tsx; do not edit by hand.",
    "",
    "   The app has one look, \"paper\" (html data-theme=\"light\"). Values are RGB triplets so",
    "   they take an alpha: rgb(var(--color-card) / 0.78). The page ground is --page-bg-rgb.",
    "   #FFD60A yellow is a FILL only on paper (buttons, the log-run circle); yellow words, ticks",
    "   and icons use --color-primary-ink (#8A6A00). */",
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n");
}

// ── Cards ───────────────────────────────────────────────────────────────────────────────────

const FONTS_APP =
  "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap";
const FONTS_WEB =
  "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

/** A card rendered with the app's real stylesheet on the paper ground. */
function appCard(group: string, title: string, body: string, extraCss = "") {
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${FONTS_APP}" />
<link rel="stylesheet" href="../tokens/app.css" />
<style>
  :root { --font-ui: "Sora"; --jrc-icon-cutout: rgb(var(--color-card)); }
  body { margin: 0; padding: 24px; background: rgb(var(--page-bg-rgb)); color: rgb(var(--color-foreground));
    font-family: "Sora", system-ui, sans-serif; font-size: 14px; }
  .ds-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .ds-stack { display: grid; gap: 20px; }
  .ds-note { font-size: 11px; color: rgb(var(--color-muted-foreground)); margin: 6px 0 0; }
  .ds-h { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: rgb(var(--color-muted-foreground)); margin: 0 0 8px; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** A card on the website's own dark ground and type. */
function webCard(group: string, title: string, body: string, extraCss = "") {
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${FONTS_WEB}" />
<link rel="stylesheet" href="../tokens/website.css" />
<style>
  body { margin: 0; padding: 28px; background: var(--web-ground); color: var(--web-text);
    font-family: var(--web-font-body); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .ds-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
  .ds-stack { display: grid; gap: 22px; }
  .ds-h { font-family: var(--web-font-label); font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--web-text-faint); margin: 0 0 10px; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function swatch(name: string, cssVar: string, note: string) {
  return `<div class="sw"><div class="chip" style="background: rgb(var(${cssVar}))"></div>
<div><div class="nm">${name}</div><div class="vr">${cssVar}</div><div class="nt">${note}</div></div></div>`;
}

const SWATCH_CSS = `
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .sw { display: flex; gap: 10px; align-items: center; }
  .chip { width: 44px; height: 44px; border-radius: 10px; border: 1px solid rgb(var(--color-elevate) / .09); flex: none; }
  .nm { font-weight: 600; font-size: 13px; }
  .vr { font-size: 11px; color: rgb(var(--color-muted-foreground)); }
  .nt { font-size: 11px; color: rgb(var(--color-faint)); }`;

function appColoursCard() {
  const groups: Array<[string, Array<[string, string, string]>]> = [
    [
      "Ground and surfaces",
      [
        ["Page", "--page-bg-rgb", "#F4F4F3 near-neutral paper"],
        ["Card", "--color-card", "#FFFFFF, lighter than the page"],
        ["Muted / inset", "--color-muted", "#FAFAFA"],
        ["Border", "--color-border", "#E5E5E3 hairline"],
      ],
    ],
    [
      "Ink",
      [
        ["Foreground", "--color-foreground", "#191815 warm ink, never black"],
        ["Muted text", "--color-muted-foreground", "#6B675F labels"],
        ["Faint", "--color-faint", "#959493 decoration only"],
      ],
    ],
    [
      "Yellow: action",
      [
        ["Primary fill", "--color-primary", "#FFD60A, fill under dark text only"],
        ["Primary ink", "--color-primary-ink", "#8A6A00 yellow words/icons on paper"],
      ],
    ],
    [
      "Meaning",
      [
        ["Gain (faster)", "--color-gain", "#07794D pace/quality only"],
        ["Destructive / slower", "--color-destructive", "#BE3F27"],
        ["Warning", "--color-warning", "#8C5400 attention, not error"],
        ["Best lap", "--color-best-lap", "#6D28D9"],
      ],
    ],
    [
      "Chart series",
      [
        ["Series 1", "--color-series-1", "#2A78D6"],
        ["Series 2", "--color-series-2", "#D95C28"],
        ["Series 3", "--color-series-3", "#8A5CD6"],
      ],
    ],
    [
      "Pace ramp (best → median)",
      [
        ["Pace 1 best lap", "--color-pace-1", "#2E2C28"],
        ["Pace 2 avg top 5", "--color-pace-2", "#5C584F"],
        ["Pace 3 avg top 10", "--color-pace-3", "#878276"],
        ["Pace 4 median", "--color-pace-4", "#ABA599"],
      ],
    ],
    [
      "Handling ratings",
      [
        ["Bad", "--color-rating-bad", "#BE3F27"],
        ["Workable", "--color-rating-workable", "#9E6238"],
        ["Good", "--color-rating-good", "#4A7F63"],
        ["Dialled", "--color-rating-dialled", "#07794D"],
      ],
    ],
  ];
  const body = `<div class="ds-stack">${groups
    .map(([h, items]) => `<section><p class="ds-h">${h}</p><div class="grid">${items.map((i) => swatch(...i)).join("")}</div></section>`)
    .join("")}</div>`;
  return appCard("App · Foundations", "App colours (paper)", body, SWATCH_CSS);
}

function appTypeCard() {
  const body = `<div class="ds-stack">
<div><p class="ds-h">Page title · 22–28px bold, −0.02em</p><h1 class="page-title" style="margin:0">Paddock</h1></div>
<div><p class="ds-h">Panel title · 20–22px bold</p>${html(<PanelTitle>Club round 4, Saturday</PanelTitle>)}
${html(<PanelSubtitle>Sentence case, 13px muted under a title.</PanelSubtitle>)}</div>
<div><p class="ds-h">Section title · 14px bold</p>${html(<SectionTitle>Best laps this meeting</SectionTitle>)}</div>
<div><p class="ds-h">Eyebrow label · 11px semibold uppercase, 0.04em</p>${html(<Eyebrow>Recent runs</Eyebrow>)}</div>
<div><p class="ds-h">Body · 13–14px</p><p style="margin:0;font-size:14px;max-width:56ch">Every run logged: setup, tyres, conditions, how the car felt and every lap time.</p></div>
<div><p class="ds-h">Figures · tabular Sora, no second typeface</p>${html(
    <StatStrip gridClassName="grid-cols-3">
      <StatTile label="Best lap" value="12.384" accent />
      <StatTile label="Avg top 5" value="12.471" />
      <StatTile label="Laps" value="27" />
    </StatStrip>
  )}</div>
<p class="ds-note">One typeface in the app: Sora (400/500/600/700). No monospace anywhere.</p>
</div>`;
  return appCard("App · Foundations", "App type (Sora only)", body);
}

function appButtonsCard() {
  const body = `<div class="ds-stack">
<div><p class="ds-h">Primary: yellow, lit from above. Doing something.</p><div class="ds-row">
${html(<Button>Save run</Button>)}${html(<Button>Log a run</Button>)}${html(<Button disabled>Saving…</Button>)}</div></div>
<div><p class="ds-h">Door: grey. Going somewhere.</p><div class="ds-row">
${html(<Button variant="door">Open the lab</Button>)}${html(<Button variant="door">View all 8 cars</Button>)}</div></div>
<div><p class="ds-h">Outline: secondary action</p><div class="ds-row">
${html(<Button variant="outline">Edit</Button>)}${html(<Button variant="outline">Compare</Button>)}</div></div>
<p class="ds-note">36px tall, 10px corners, 13.5px semibold. Words on every button, never icon-only. One or two yellows per screen.</p>
</div>`;
  return appCard("App · Actions", "App buttons", body);
}

function appSurfacesCard() {
  const body = `<div class="ds-stack" style="max-width:420px">
${html(
    <SurfaceCard>
      <Eyebrow>Today at Sandown</Eyebrow>
      <PanelTitle as="h3">Run 3 · 12.384 best</PanelTitle>
      <PanelSubtitle>A800RR · Sweep 32 · 24°C track</PanelSubtitle>
      <StatStrip className="mt-3" gridClassName="grid-cols-3">
        <StatTile label="Best" value="12.384" accent />
        <StatTile label="Avg top 5" value="12.471" />
        <StatTile label="vs field" value="−0.21" />
      </StatStrip>
      <div className="mt-3 flex gap-2">
        <Button>Log next run</Button>
        <Button variant="door">Open the day</Button>
      </div>
    </SurfaceCard>
  )}
${html(
    <SurfaceCard>
      <Eyebrow>Cars</Eyebrow>
      <p className="text-sm">Every card opens on its band: a faint ink tint and one full-width hairline.</p>
    </SurfaceCard>
  )}
<p class="ds-note">White frosted card on the #F4F4F3 page, 12px corners (16px for a hero card), 9% ink hairline, soft warm shadow.</p>
</div>`;
  return appCard("App · Surfaces", "App cards and bands", body);
}

function appControlsCard() {
  const body = `<div class="ds-stack" style="max-width:420px">
<div><p class="ds-h">Switch</p><div class="ds-row">${html(<Switch checked onChange={noop} ariaLabel="On" />)}${html(
    <Switch checked={false} onChange={noop} ariaLabel="Off" />
  )}</div></div>
<div><p class="ds-h">Segmented control: chosen = ink, never yellow</p>${html(
    <SegmentedControl
      value="practice"
      onChange={noop}
      options={[
        { value: "practice", label: "Practice" },
        { value: "qualifying", label: "Qualifying" },
        { value: "final", label: "Final" },
      ]}
    />
  )}</div>
<div><p class="ds-h">Pill toggle</p>${html(
    <PillToggle
      value="mine"
      onChange={noop}
      options={[
        { value: "mine", label: "Mine" },
        { value: "everyone", label: "Everyone" },
      ]}
    />
  )}</div>
<div><p class="ds-h">Text field · 36px, same height as a button</p>
<input class="ui-control w-full rounded-lg border border-border bg-input px-2.5 py-2 text-sm text-foreground" placeholder="Track name" /></div>
<div><p class="ds-h">Activity</p><div class="ds-row">${html(<Spinner size="sm" />)}${html(<Spinner />)}${html(<Spinner size="lg" />)}</div></div>
</div>`;
  return appCard("App · Controls", "App controls", body);
}

const ICONS: Array<[string, Icons.JrcIcon]> = [
  ["Dashboard", Icons.IconDashboard],
  ["Analysis", Icons.IconAnalysis],
  ["Events", Icons.IconEvents],
  ["Engineer", Icons.IconEngineer],
  ["Garage", Icons.IconGarage],
  ["Teams", Icons.IconTeams],
  ["Settings", Icons.IconSettings],
  ["Add run", Icons.IconAddRun],
  ["Tools", Icons.IconTools],
  ["More", Icons.IconMore],
];

function iconsCard() {
  const cell = (name: string, Icon: Icons.JrcIcon, cls: string) =>
    `<div class="ic ${cls}">${html(<Icon size={28} />)}<span>${name}</span></div>`;
  const body = `<div class="ds-stack">
<div><p class="ds-h">Solid Form nav icons · resting</p><div class="icons">${ICONS.map(([n, I]) => cell(n, I, "")).join("")}</div></div>
<div><p class="ds-h">Open tab: the icon turns ink, a yellow tick marks it</p><div class="icons">${cell("Dashboard", Icons.IconDashboard, "on")}</div></div>
<p class="ds-note">24px grid, solid fill in currentColor. Cut-outs take the colour of the surface under them (--jrc-icon-cutout). Resting vs open is a colour change, never outline vs filled.</p>
</div>`;
  const css = `
  .icons { display: flex; flex-wrap: wrap; gap: 8px; }
  .ic { width: 84px; padding: 12px 0 10px; display: grid; justify-items: center; gap: 6px; background: rgb(var(--color-card));
    border-radius: 12px; border: 1px solid rgb(var(--color-elevate) / .09); color: rgb(var(--color-muted-foreground)); font-size: 11px; position: relative; }
  .ic.on { color: rgb(var(--color-foreground)); }
  .ic.on::before { content: ""; position: absolute; top: 0; width: 22px; height: 3px; border-radius: 0 0 3px 3px; background: #FFD60A; }`;
  return appCard("Brand", "Icons", body, css);
}

function markCard() {
  const body = `<div class="marks">
<div class="m" style="background:#121110"><img src="../assets/brand/jrc-mark-yellow.svg" alt="" /><span>Yellow · brand and hero, on dark</span></div>
<div class="m" style="background:#121110"><img src="../assets/brand/jrc-mark-white.svg" alt="" /><span>White · working chrome, on dark</span></div>
<div class="m" style="background:#FFD60A"><img src="../assets/brand/jrc-mark-ink.svg" alt="" /><span style="color:#121110">Ink · on the yellow field (app icon, splash)</span></div>
<div class="m" style="background:#fff;border:1px solid #E5E5E3"><img src="../assets/brand/jrc-mark-ink.svg" alt="" /><span style="color:#6B675F">Ink · on paper</span></div>
<div class="m wide" style="background:#121110"><img src="../assets/brand/lockup-trackside-colour.svg" alt="" style="height:44px" /><span>Lockup · mark | rule | TRACKSIDE (dark grounds)</span></div>
<div class="m wide" style="background:#fff;border:1px solid #E5E5E3"><img src="../assets/brand/lockup-trackside-mono-black.svg" alt="" style="height:44px" /><span style="color:#6B675F">Lockup · mono black</span></div>
</div>
<p class="ds-note">The mark is one geometry (731 × 241) cut at −21°. Never redraw, recolour outside these four, stretch or outline it. Company: JRC Dynamics. Product: JRC Trackside (working name).</p>`;
  const css = `
  .marks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .m { border-radius: 14px; padding: 28px 20px 14px; display: grid; justify-items: center; gap: 16px; }
  .m.wide { grid-column: span 2; }
  .m img { height: 40px; }
  .m span { font-size: 11px; color: #A09D96; }`;
  return appCard("Brand", "JRC mark and lockups", body, css);
}

async function screens() {
  const dir = "marketing-shots/appstore-iphone";
  // 04-run-setup was shot before the sheet finished drawing ("Drawing your sheet…"); leave it out
  // until the App Store set is reshot.
  const skip = new Set(["04-run-setup.png"]);
  const files = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".png") && !skip.has(f)).sort();
  const names: string[] = [];
  for (const f of files) {
    const name = f.replace(/\.png$/, ".webp");
    const buf = await sharp(path.join(ROOT, dir, f)).resize({ width: 660 }).webp({ quality: 82 }).toBuffer();
    write(`assets/screens/${name}`, buf);
    names.push(name);
  }
  const body = `<div class="shots">${names
    .map((n) => `<figure><img src="../assets/screens/${n}" alt="" /><figcaption>${n.replace(/^\d+-|\.webp$/g, "").replace(/-/g, " ")}</figcaption></figure>`)
    .join("")}</div>
<p class="ds-note">Real app screens (demo data, iPhone 6.9"), in assets/screens/. For the website's 3D phone renders use ui_kits/website/assets/hero-phone-dashboard.webp and fan-*.webp.</p>`;
  const css = `
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  figure { margin: 0; } figure img { width: 100%; border-radius: 14px; display: block; box-shadow: 0 8px 20px -14px rgb(0 0 0 / .5); }
  figcaption { font-size: 11px; color: rgb(var(--color-muted-foreground)); margin-top: 6px; text-transform: capitalize; }`;
  return appCard("App · Screens", "App screens", body, css);
}

// ── Website ─────────────────────────────────────────────────────────────────────────────────

function websiteKit() {
  const landing = path.join(ROOT, "public/landing");
  const page = readFileSync(path.join(landing, "index.html"), "utf8")
    .replaceAll("/landing/", "")
    // Vercel's visit counter only exists on the live site.
    .replace(/<script[^>]*src="\/_vercel\/insights\/script\.js"[^>]*><\/script>\s*/g, "");
  write("ui_kits/website/index.html", page);
  copy("public/landing/support.js", "ui_kits/website/support.js");
  const used = new Set([...page.matchAll(/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]));
  // The page's own pictures, plus the photos and share card a new section may want.
  for (const extra of ["bench-chassis.jpg", "drivers-meeting.jpg", "track-spiral.jpg", "track-sunset.jpg", "og-card-v4.jpg"]) {
    used.add(extra);
  }
  for (const f of readdirSync(path.join(landing, "assets"))) {
    if (used.has(f)) copy(`public/landing/assets/${f}`, `ui_kits/website/assets/${f}`);
  }
}

function webFullPageCard() {
  const body = `<div class="frame"><iframe src="../ui_kits/website/index.html" title="jrcdynamics.com as it is live" loading="lazy"></iframe></div>`;
  const css = `
  body { padding: 0; }
  .frame { width: 100%; height: 900px; overflow: hidden; }
  iframe { width: 1440px; height: 3000px; border: 0; transform: scale(.5); transform-origin: 0 0; }`;
  return webCard("Website", "Website · the live page", body, css);
}

// ── Assemble ────────────────────────────────────────────────────────────────────────────────

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  compileAppCss("tokens/app.css");
  write("tokens/app-colors.css", appColorsCss(globals));
  copy("design-system/website-tokens.css", "tokens/website.css");
  copy("design-system/README.md", "README.md");

  for (const f of ["jrc-mark-yellow.svg", "jrc-mark-white.svg", "jrc-mark-ink.svg", "jrc-mark.svg"]) {
    copy(`public/brand/${f}`, `assets/brand/${f}`);
  }
  for (const f of readdirSync(path.join(ROOT, "public/brand")).filter((f) => f.startsWith("lockup-trackside-"))) {
    copy(`public/brand/${f}`, `assets/brand/${f}`);
  }
  copy("public/icons/icon-512.png", "assets/brand/app-icon-512.png");
  for (const [name, Icon] of ICONS) {
    const svg = html(<Icon size={24} />);
    write(`assets/icons/${name.toLowerCase().replace(/\s+/g, "-")}.svg`, svg);
  }

  websiteKit();

  write("preview/brand-mark.html", markCard());
  write("preview/brand-icons.html", iconsCard());
  write("preview/app-colours.html", appColoursCard());
  write("preview/app-type.html", appTypeCard());
  write("preview/app-buttons.html", appButtonsCard());
  write("preview/app-surfaces.html", appSurfacesCard());
  write("preview/app-controls.html", appControlsCard());
  write("preview/app-screens.html", await screens());
  write("preview/web-page.html", webFullPageCard());
  for (const f of readdirSync(path.join(SRC, "cards"))) {
    copy(`design-system/cards/${f}`, `preview/${f}`);
  }

  const count = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce(
      (n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1),
      0
    );
  console.log(`design-system/out: ${count(OUT)} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
