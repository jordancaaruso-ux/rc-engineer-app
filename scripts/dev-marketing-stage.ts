/**
 * dev-marketing-stage.ts — DEV ONLY. Dress the raw screenshots for the website.
 *
 *   npm run shots:stage                 # everything under marketing-shots/{phone,desktop}
 *   npm run shots:stage -- --only=hero  # just the staged hero composites
 *
 * Takes what `dev-marketing-shots.ts` photographed and produces three kinds of file:
 *
 *   marketing-shots/framed/phone/<name>.png    the app screen inside an iPhone 15 Pro screen: the
 *                                              iOS status bar (9:41, full signal, full battery), the
 *                                              Dynamic Island, the home indicator, the 55pt corners.
 *                                              1179×2556, transparent outside the corners.
 *   marketing-shots/framed/desktop/<name>.png  the desktop screen as a bare window: 12px corners, a
 *                                              hairline, a soft shadow, transparent around it.
 *   marketing-shots/staged/<name>.png          the hero: a phone and a desktop window together on a
 *                                              dark stage, a few degrees of tilt, one warm edge light
 *                                              in the brand yellow, a faint reflection. Real pixels
 *                                              lit and posed — nothing in the picture is invented.
 *
 * Why a web page and not an image library: the framing is CSS (rounded corners, shadows, 3D
 * perspective, reflections), which Chromium renders exactly and which is easy to re-tune. The
 * status bar is drawn as inline SVG so it stays crisp at 3x. Everything is regenerated from the raw
 * shots in one command, so re-shooting the app re-dresses the site.
 *
 * Founder rules (2026-09-04): ash and brand yellow only, no blue/orange neon, no carbon fibre, no
 * lens flares, tilt ≤ 15°, one light source, a reflection you barely notice.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const ONLY = argValue("only"); // phone | desktop | hero

const IN = "marketing-shots";
const OUT_FRAMED = `${IN}/framed`;
const OUT_STAGED = `${IN}/staged`;

// iPhone 15 Pro, in points. The raw phone shots are 393×793 so the band fits above them.
const PHONE = { w: 393, h: 852, statusBar: 59, radius: 55, island: { w: 126, h: 37, top: 11 }, home: { w: 134, h: 5, bottom: 8 } };
const DESKTOP = { w: 1440, h: 900, radius: 12 };
const YELLOW = "#FFD60A";

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

/** Top-left pixel of a PNG, so the status-bar band matches whatever the app painted up there. */
function topLeftColour(file: string): string {
  const b = readFileSync(file);
  const zlib = require("node:zlib") as typeof import("node:zlib");
  let i = 8;
  const idat: Buffer[] = [];
  let w = 0;
  let bpp = 3;
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString();
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); bpp = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 1; }
    if (type === "IDAT") idat.push(data);
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // First scanline: filter byte then pixels; filter 0 or a "sub" filter leaves pixel 0 verbatim.
  const px = raw.subarray(1, 1 + Math.max(3, bpp));
  return `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** iOS status bar, in points, drawn to match Apple's marketing convention (9:41, everything full). */
function statusBarSvg(width: number, height: number, ink: string): string {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0">
    <text x="52" y="38" font-family="-apple-system, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', Inter, system-ui, sans-serif" font-size="17" font-weight="600" fill="${ink}" text-anchor="middle" letter-spacing="-0.2">9:41</text>
    <!-- signal -->
    <g fill="${ink}" transform="translate(${width - 96}, 19)">
      <rect x="0" y="9" width="3.5" height="4" rx="0.8"/><rect x="5.5" y="6.5" width="3.5" height="6.5" rx="0.8"/>
      <rect x="11" y="4" width="3.5" height="9" rx="0.8"/><rect x="16.5" y="1" width="3.5" height="12" rx="0.8"/>
    </g>
    <!-- wifi -->
    <g fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" transform="translate(${width - 70}, 20)">
      <path d="M1.5 4.6a11.5 11.5 0 0 1 15 0"/><path d="M4.6 8.1a7.2 7.2 0 0 1 8.8 0"/>
    </g>
    <circle cx="${width - 61}" cy="31.6" r="1.7" fill="${ink}"/>
    <!-- battery -->
    <g transform="translate(${width - 41}, 20)">
      <rect x="0.5" y="0.5" width="24" height="12" rx="3.5" fill="none" stroke="${ink}" stroke-opacity="0.4"/>
      <rect x="2.5" y="2.5" width="20" height="8" rx="2" fill="${ink}"/>
      <path d="M26.5 4.3v4.4a2.4 2.4 0 0 0 0-4.4z" fill="${ink}" fill-opacity="0.4"/>
    </g>
  </svg>`;
}

function phoneHtml(shot: string): string {
  const band = topLeftColour(shot);
  const { w, h, statusBar, radius, island, home } = PHONE;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .screen{position:relative;width:${w}px;height:${h}px;border-radius:${radius}px;overflow:hidden;background:${band}}
    .app{position:absolute;left:0;top:${statusBar}px;width:${w}px;height:${h - statusBar}px;display:block}
    .island{position:absolute;left:${(w - island.w) / 2}px;top:${island.top}px;width:${island.w}px;height:${island.h}px;border-radius:${island.h / 2}px;background:#000}
    .home{position:absolute;left:${(w - home.w) / 2}px;bottom:${home.bottom}px;width:${home.w}px;height:${home.h}px;border-radius:${home.h / 2}px;background:#000;opacity:.9}
  </style></head><body>
    <div class="screen">
      <img class="app" src="${dataUrl(shot)}">
      ${statusBarSvg(w, statusBar, "#111")}
      <div class="island"></div>
      <div class="home"></div>
    </div>
  </body></html>`;
}

const DESKTOP_PAD = 120;
function desktopHtml(shot: string): string {
  const { w, h, radius } = DESKTOP;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .stage{padding:${DESKTOP_PAD}px;display:inline-block}
    .win{width:${w}px;height:${h}px;border-radius:${radius}px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.10),0 40px 90px rgba(0,0,0,.28),0 12px 28px rgba(0,0,0,.14)}
    .win img{display:block;width:${w}px;height:${h}px}
  </style></head><body><div class="stage"><div class="win"><img src="${dataUrl(shot)}"></div></div></body></html>`;
}

/**
 * The stage. One dark room, a glossy floor, one warm key light from the upper right in the brand
 * yellow. Devices stand on the floor and reflect in it. Dramatic, not neon: no blue, no orange,
 * no carbon fibre, no flares — the drama comes from scale, a low camera and one light.
 */
function stageCss(w: number, h: number): string {
  return `
    html,body{margin:0;background:#0a0a09}
    .stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#0d0c0b;color:#fff}
    .wall{position:absolute;inset:0;background:
      radial-gradient(70% 60% at 78% 22%, rgba(255,214,10,.20), transparent 62%),
      radial-gradient(50% 40% at 20% 30%, rgba(255,255,255,.035), transparent 70%),
      linear-gradient(180deg,#141311 0%,#0d0c0b 100%)}
    .floor{position:absolute;left:-30%;right:-30%;top:66%;height:60%;transform:perspective(900px) rotateX(58deg);transform-origin:50% 0;
      background:
        linear-gradient(180deg, rgba(255,214,10,.10), transparent 22%),
        repeating-linear-gradient(90deg, rgba(255,255,255,.055) 0 1px, transparent 1px 64px),
        repeating-linear-gradient(0deg, rgba(255,255,255,.045) 0 1px, transparent 1px 64px),
        linear-gradient(180deg,#161513,#0b0b0a)}
    .horizon{position:absolute;left:8%;right:8%;top:66%;height:2px;background:linear-gradient(90deg,transparent,rgba(255,214,10,.55) 35%,rgba(255,214,10,.75) 60%,transparent);filter:blur(1.5px)}
    .haze{position:absolute;left:0;right:0;top:56%;height:20%;background:linear-gradient(180deg,transparent,rgba(255,214,10,.06) 50%,transparent)}
    .vignette{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,.72) 100%);pointer-events:none}
    .scene{position:absolute;inset:0;perspective:2200px;perspective-origin:55% 40%}
    .desk,.phone{position:absolute;padding:240px;margin:-240px;box-sizing:content-box}
    .device{position:relative}
    /* ── The iPhone body: titanium band, black inner bezel, side buttons ── */
    .iphone{position:relative;border-radius:18.2%/8.4%;padding:6px;background:linear-gradient(160deg,#7d7b77 0%,#3a3936 18%,#26251f 50%,#4a4844 82%,#8a8884 100%);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.28), inset 0 0 0 2px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.9), 0 80px 110px rgba(0,0,0,.8), 0 0 70px rgba(255,214,10,.14)}
    .iphone .bezel{border-radius:17%/7.8%;padding:5px;background:#050505}
    .iphone .face{display:block;width:100%;border-radius:${PHONE.radius * 100 / 393 * 0.92}%/${PHONE.radius * 100 / 852 * 0.92}%}
    .iphone .btn{position:absolute;background:linear-gradient(90deg,#8d8b87,#3c3b38 40%,#5a5955);border-radius:2px}
    .iphone .btn.action{left:-3px;top:15.5%;width:3px;height:3.6%}
    .iphone .btn.volup{left:-3px;top:21.5%;width:3px;height:7.2%}
    .iphone .btn.voldn{left:-3px;top:30%;width:3px;height:7.2%}
    .iphone .btn.power{right:-3px;top:24%;width:3px;height:11%;background:linear-gradient(270deg,#8d8b87,#3c3b38 40%,#5a5955)}
    /* ── The laptop: aluminium lid, black bezel with a camera, a keyboard deck receding toward the viewer ── */
    .laptop{position:relative;transform-style:preserve-3d}
    .laptop .lid{position:relative;border-radius:16px 16px 6px 6px;padding:9px 9px 12px;background:linear-gradient(180deg,#e2e1dd 0%,#c4c3bf 55%,#a9a8a4 100%);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.6), inset 0 0 0 2px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.85), 0 70px 100px rgba(0,0,0,.7), 0 24px 40px rgba(0,0,0,.55)}
    .laptop .bezel{position:relative;border-radius:9px 9px 3px 3px;padding:16px 14px 18px;background:#080808;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
    .laptop .cam{position:absolute;top:5px;left:50%;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:#182022;box-shadow:0 0 0 1px #2c3436, inset 0 0 1px #6c8}
    .laptop .face{display:block;width:100%;border-radius:2px}
    .laptop .deck{position:relative;transform-origin:50% 0;transform:rotateX(78deg);height:340px;width:118%;margin-left:-9%;border-radius:0 0 26px 26px;
      background:linear-gradient(180deg,#a9a8a4 0%,#c6c5c1 30%,#cfcecA 70%,#b5b4b0 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.5), inset 0 -2px 0 rgba(0,0,0,.15)}
    .laptop .deck::before{content:"";position:absolute;left:0;right:0;top:0;height:10px;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent)}
    .laptop .deck::after{content:"";position:absolute;left:0;right:0;top:100%;height:14px;transform-origin:50% 0;transform:rotateX(-78deg);border-radius:0 0 26px 26px;background:linear-gradient(180deg,#a3a29e,#77766f)}
    .laptop .keys{position:absolute;left:12%;right:12%;top:10%;height:44%}
    .laptop .keys svg{display:block;width:100%;height:100%}
    .laptop .trackpad{position:absolute;left:37%;right:37%;top:60%;height:32%;border-radius:10px;border:1px solid rgba(0,0,0,.2);background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(0,0,0,.04))}
    .reflect .deck{display:none}
    .sheen{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(112deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,.05) 26%, transparent 44%, transparent 70%, rgba(255,214,10,.06) 100%)}
    .screen{position:relative}
    .reflect{position:absolute;left:0;top:100%;width:100%;margin-top:4px;transform:scaleY(-1);opacity:.24;pointer-events:none;filter:blur(1.5px);
      -webkit-mask-image:linear-gradient(rgba(0,0,0,.9), transparent 50%);mask-image:linear-gradient(rgba(0,0,0,.9), transparent 50%)}
    .contact{position:absolute;left:10%;right:10%;top:100%;height:40px;margin-top:-10px;background:radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.9), transparent);filter:blur(14px)}
  `;
}

/** A keyboard drawn as real keys, so the perspective foreshortens it like one. */
function keyboardSvg(): string {
  const cols = 14, rows = 6, kw = 64, kh = 46, gap = 7;
  const W = cols * kw + (cols - 1) * gap, H = rows * kh + (rows - 1) * gap;
  const keys: string[] = [];
  for (let r = 0; r < rows; r++) {
    if (r === rows - 1) {
      // bottom row: a few modifiers, a wide space bar, a few more
      const widths = [1, 1, 1, 1, 5, 1, 1, 1, 1, 1];
      let x = 0;
      for (const wv of widths) { const w = wv * kw + (wv - 1) * gap; keys.push(`<rect x="${x}" y="${r * (kh + gap)}" width="${w}" height="${kh}" rx="6" fill="#2a2a2a"/>`); x += w + gap; }
      continue;
    }
    for (let c = 0; c < cols; c++) keys.push(`<rect x="${c * (kw + gap)}" y="${r * (kh + gap)}" width="${kw}" height="${kh}" rx="6" fill="#2a2a2a"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${keys.join("")}</svg>`;
}

function frame(kind: "desk" | "phone", src: string): string {
  if (kind === "phone") {
    return `<div class="iphone"><div class="btn action"></div><div class="btn volup"></div><div class="btn voldn"></div><div class="btn power"></div>
      <div class="bezel"><div class="screen"><img class="face" src="${src}"><div class="sheen" style="border-radius:${PHONE.radius * 100 / 393 * 0.92}%/${PHONE.radius * 100 / 852 * 0.92}%"></div></div></div></div>`;
  }
  return `<div class="laptop"><div class="lid"><div class="bezel"><div class="cam"></div><div class="screen"><img class="face" src="${src}"><div class="sheen" style="border-radius:2px"></div></div></div></div><div class="deck"><div class="keys">${keyboardSvg()}</div><div class="trackpad"></div></div></div>`;
}

function device(kind: "desk" | "phone", src: string, style: string): string {
  return `<div class="${kind}" style="${style}"><div class="device">${frame(kind, src)}<div class="contact"></div><div class="reflect">${frame(kind, src)}</div></div></div>`;
}

function stageHtml(w: number, h: number, devices: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${stageCss(w, h)}</style></head><body>
    <div class="stage"><div class="wall"></div><div class="floor"></div><div class="horizon"></div><div class="haze"></div>
      <div class="scene">${devices}</div><div class="vignette"></div></div></body></html>`;
}

/** Desktop back-left, phone front-right — the pair. */
function heroHtml(desktopRaw: string, phoneFramed: string, opts: { w: number; h: number }): string {
  const { w, h } = opts;
  const desk = device("desk", dataUrl(desktopRaw), `left:${Math.round(w * 0.06)}px;top:${Math.round(h * 0.09)}px;width:${Math.round(w * 0.60)}px;transform:rotateY(12deg) rotateX(6deg);transform-origin:50% 60%`);
  const phone = device("phone", dataUrl(phoneFramed), `right:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.12)}px;width:${Math.round(h * 0.70 * 393 / 852)}px;transform:rotateY(-14deg) rotateX(5deg) rotateZ(-3deg);transform-origin:50% 60%`);
  return stageHtml(w, h, desk + phone);
}

/** One phone, big, standing on the floor. Portrait canvas. */
function soloPhoneHtml(phoneFramed: string, opts: { w: number; h: number }): string {
  const { w, h } = opts;
  const width = Math.round(h * 0.72 * 393 / 852);
  const phone = device("phone", dataUrl(phoneFramed), `left:${Math.round((w - width) / 2)}px;top:${Math.round(h * 0.08)}px;width:${width}px;transform:rotateY(-12deg) rotateX(6deg) rotateZ(-2deg);transform-origin:50% 60%`);
  return stageHtml(w, h, phone);
}

/** One desktop window, low camera, filling the frame. */
function soloDesktopHtml(desktopRaw: string, opts: { w: number; h: number }): string {
  const { w, h } = opts;
  const desk = device("desk", dataUrl(desktopRaw), `left:${Math.round(w * 0.15)}px;top:${Math.round(h * 0.08)}px;width:${Math.round(w * 0.70)}px;transform:rotateY(-8deg) rotateX(7deg);transform-origin:50% 60%`);
  return stageHtml(w, h, desk);
}

async function render(page: Page, html: string, out: string, opts: { width: number; height: number; scale: number; transparent: boolean }) {
  await page.setViewportSize({ width: opts.width, height: opts.height });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, omitBackground: opts.transparent, clip: { x: 0, y: 0, width: opts.width, height: opts.height } });
  console.log(`  ${out}`);
}

function rawShots(kind: "phone" | "desktop"): string[] {
  const dir = `${IN}/${kind}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".png") && !f.endsWith("-full.png")).map((f) => path.join(dir, f));
}

const stem = (file: string) => path.basename(file, ".png").replace(/^\d+-/, "");

async function main() {
  const browser = await chromium.launch();
  const phones = rawShots("phone");
  const desktops = rawShots("desktop");
  if (phones.length + desktops.length === 0) throw new Error("No raw shots — run `npm run shots:marketing` first.");

  if (!ONLY || ONLY === "phone") {
    mkdirSync(`${OUT_FRAMED}/phone`, { recursive: true });
    const ctx = await browser.newContext({ deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    console.log("phone frames:");
    for (const shot of phones) await render(page, phoneHtml(shot), `${OUT_FRAMED}/phone/${stem(shot)}.png`, { width: PHONE.w, height: PHONE.h, scale: 3, transparent: true });
    await ctx.close();
  }
  if (!ONLY || ONLY === "desktop") {
    mkdirSync(`${OUT_FRAMED}/desktop`, { recursive: true });
    const ctx = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    console.log("desktop windows:");
    for (const shot of desktops) await render(page, desktopHtml(shot), `${OUT_FRAMED}/desktop/${stem(shot)}.png`, { width: DESKTOP.w + DESKTOP_PAD * 2, height: DESKTOP.h + DESKTOP_PAD * 2, scale: 2, transparent: true });
    await ctx.close();
  }
  if (!ONLY || ONLY === "hero") {
    mkdirSync(OUT_STAGED, { recursive: true });
    const ctx = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    console.log("staged:");
    // Pairs that tell one story each: what the desktop shows, what the phone shows.
    const pairs: Array<[string, string, string]> = [
      ["hero", "run-laps", "run-laps-chart"],
      ["hero-dashboard", "dashboard", "engineer"],
            ["hero-setup", "setup-sheet", "run-setup"],
      ["hero-analysis", "analysis", "dashboard"],
    ];
    const solos: Array<["phone" | "desk", string]> = [["phone", "engineer"], ["phone", "dashboard"], ["phone", "run-laps-chart"], ["phone", "setup-sheet"], ["desk", "run-laps"], ["desk", "analysis"], ["desk", "dashboard"]];
    for (const [kind, name] of solos) {
      if (kind === "phone") {
        const p = `${OUT_FRAMED}/phone/${name}.png`;
        if (!existsSync(p)) { console.warn(`  ! solo phone ${name}: missing`); continue; }
        await render(page, soloPhoneHtml(p, { w: 1100, h: 1400 }), `${OUT_STAGED}/phone-${name}.png`, { width: 1100, height: 1400, scale: 2, transparent: false });
      } else {
        const d = desktops.find((f) => stem(f) === name);
        if (!d) { console.warn(`  ! solo desktop ${name}: missing`); continue; }
        await render(page, soloDesktopHtml(d, { w: 1600, h: 1000 }), `${OUT_STAGED}/desktop-${name}.png`, { width: 1600, height: 1000, scale: 2, transparent: false });
      }
    }
    for (const [name, desk, phone] of pairs) {
      // The RAW desktop shot, not the framed one: the framed file carries 120px of transparent
      // padding and its own baked shadow, and a box-shadow around that box drew a ghost rectangle.
      const d = desktops.find((f) => stem(f) === desk) ?? "";
      const p = `${OUT_FRAMED}/phone/${phone}.png`;
      if (!d || !existsSync(p)) { console.warn(`  ! ${name}: missing ${!d ? desk : p}`); continue; }
      await render(page, heroHtml(d, p, { w: 1600, h: 1000 }), `${OUT_STAGED}/${name}.png`, { width: 1600, height: 1000, scale: 2, transparent: false });
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
