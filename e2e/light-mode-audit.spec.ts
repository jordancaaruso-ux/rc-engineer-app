/**
 * Light-mode audit — every user-facing page, rendered in both themes, compared.
 *
 * The point is not "is this text 4.5:1 in light mode". Plenty of the app is
 * deliberately below that (`--color-faint` is 2.9:1 in BOTH themes, by design, for
 * decorative micro-labels), so an absolute threshold produces a wall of noise and
 * hides the four things that actually broke.
 *
 * So it renders each page TWICE — same URL, same data, same DOM — and diffs the
 * measured contrast of every text node and every SVG stroke between the themes.
 * A regression is an element that was legible on charcoal and is not on paper.
 * That signal is specific, and it is exactly the failure mode a theme introduces.
 *
 *   npx playwright test e2e/light-mode-audit.spec.ts --no-deps --project=mobile-chromium
 *
 * Screenshots land in light-mode-audit/ (untracked); the findings table is written
 * to light-mode-audit/report.md and echoed to stdout.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: "Australia/Melbourne",
});
test.setTimeout(3_600_000);

const OUT = "light-mode-audit";

/** Below this, text is not readable by anyone. Above it we only care about the delta. */
const ILLEGIBLE = 3.0;
/** What counts as "was fine before": WCAG AA for normal text. */
const WAS_FINE = 4.5;

type Surface = { slug: string; path: string };

type Sample = {
  key: string;
  role: "text" | "stroke" | "fill";
  contrast: number;
  fg: string;
  bg: string;
  text: string;
  cls: string;
  approx: boolean;
};

/**
 * Measures every legible-intent colour on the page against what is actually behind
 * it. Runs in the browser; returns one row per element.
 *
 * Effective background means walking ancestors until something opaque turns up,
 * compositing each translucent layer on the way — `bg-card/60` over the page is a
 * different colour from `bg-card`, and the glass surfaces are all translucent.
 */
const AUDIT = () => {
  /*
   * Colour handling is done by the browser, on a 1×1 canvas, rather than by
   * parsing the computed string.
   *
   * Tailwind 4 serialises every alpha'd colour as `oklab(L a b / α)`, so
   * `bg-card/70` comes back as `oklab(0.988 -0.00005 0.0041 / 0.7)`. A regex that
   * grabs the first three numbers reads that as rgb(0.988, 0, 0.004) — near-black
   * — which silently turned every pale translucent surface in the app into a dark
   * one and invented ~40 contrast "regressions" on the first run of this audit.
   *
   * Painting the stack instead means the browser does the colour-space conversion
   * AND the compositing, exactly as it does when it renders the page. The first
   * entry is always opaque, so there is no premultiplication error on read-back.
   */
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx2d = cv.getContext("2d", { willReadFrequently: true })!;

  /** Paint bottom-first; return the resulting pixel. */
  const composite = (layers: string[]): [number, number, number, number] => {
    ctx2d.clearRect(0, 0, 1, 1);
    for (const c of layers) {
      ctx2d.fillStyle = c;
      ctx2d.fillRect(0, 0, 1, 1);
    }
    const d = ctx2d.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };

  /** Is this colour string invisible? Cheap pre-filter before the canvas. */
  const isTransparent = (c: string) => {
    if (!c || c === "none" || c === "transparent") return true;
    const m = c.match(/\/\s*([\d.]+)\s*\)/) ?? c.match(/,\s*([\d.]+)\s*\)$/);
    return m ? parseFloat(m[1]) === 0 : false;
  };

  const alphaOf = (c: string): number => {
    const m = c.match(/\/\s*([\d.]+)\s*\)/) ?? c.match(/,\s*([\d.]+)\s*\)$/);
    return m ? parseFloat(m[1]) : 1;
  };

  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (c: [number, number, number, number]) =>
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  /**
   * Composite every ancestor background down to something opaque.
   *
   * `approx` marks a result that passed under a background-image on the way — a
   * gradient or photo can't be reduced to one colour, so the number is an estimate.
   * It is NOT a reason to skip the sample: `body` carries a (fully transparent)
   * repeating-linear-gradient app-wide, so bailing on any image meant bailing on
   * essentially every element, which is what the first run of this audit did.
   *
   * The final fallback is the page ground rather than `documentElement`'s own
   * background: `.page-bg` is a fixed full-viewport fill that everything is drawn
   * over but nothing is a child of, so it is the real backdrop for loose content.
   */
  const effectiveBg = (
    el: Element,
  ): { c: [number, number, number, number]; layers: string[]; approx: boolean } => {
    const stack: string[] = []; // top-first while walking up
    let approx = false;
    let node: Element | null = el;
    let opaque = false;

    while (node) {
      const cs = getComputedStyle(node);
      // `body` carries an app-wide repeating-linear-gradient whose stops are all
      // fully transparent (the retired stripe layer), and `html` paints the ground.
      // Neither is an unknown, so neither makes a measurement approximate.
      if (
        cs.backgroundImage &&
        cs.backgroundImage !== "none" &&
        node !== document.body &&
        node !== document.documentElement
      ) {
        approx = true;
      }
      const bg = cs.backgroundColor;
      if (!isTransparent(bg)) {
        stack.push(bg);
        if (alphaOf(bg) >= 0.999) {
          opaque = true;
          break;
        }
      }
      node = node.parentElement;
    }

    if (!opaque) {
      const ground = getComputedStyle(document.documentElement)
        .getPropertyValue("--page-bg-rgb")
        .trim();
      stack.push(ground ? `rgb(${ground})` : "#ffffff");
    }

    const layers = stack.reverse(); // bottom-first, ready to paint
    return { c: composite(layers), layers, approx };
  };

  /** Stable across renders: the element's structural path in the tree. */
  const keyOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      const idx = Array.prototype.indexOf.call(parent.children, node);
      parts.unshift(`${node.tagName.toLowerCase()}${idx}`);
      node = parent;
    }
    return parts.join(">");
  };

  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (parseFloat(cs.opacity) < 0.15) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const out: Sample[] = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const { c: bg, layers, approx } = effectiveBg(el);
    const bgStr = `rgb(${bg.slice(0, 3).map(Math.round).join(" ")})`;

    // Own text only — an ancestor would otherwise be credited with its children's copy.
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();

    if (ownText.length > 0) {
      if (!isTransparent(cs.color) && alphaOf(cs.color) > 0.15) {
        out.push({
          key: keyOf(el),
          role: "text",
          contrast: ratio(composite([...layers, cs.color]), bg),
          fg: cs.color,
          bg: bgStr,
          text: ownText.slice(0, 60),
          cls: (el.getAttribute("class") ?? "").slice(0, 90),
          approx,
        });
      }
    }

    // Chart geometry. A pace line that vanishes is a data loss, not a cosmetic one,
    // and it carries no text so the loop above would never see it.
    if (el instanceof SVGElement && el.tagName !== "svg") {
      // The JRC mark paints its own negative space (`--jrc-icon-cutout`) rather than
      // punching it out. Matching its surface is the WHOLE POINT of that colour, so a
      // ~1:1 reading there is the feature working, not a defect. Detected from the
      // authored attribute rather than the computed value, which is just a colour.
      const authored = `${el.getAttribute("stroke") ?? ""}${el.getAttribute("fill") ?? ""}`;
      if (authored.includes("--jrc-icon-cutout")) continue;

      for (const role of ["stroke", "fill"] as const) {
        const raw = cs[role];
        if (!raw || raw === "none") continue;
        if (isTransparent(raw) || alphaOf(raw) <= 0.15) continue;
        // Stroke width 0 means it isn't drawn.
        if (role === "stroke" && parseFloat(cs.strokeWidth || "0") === 0) continue;
        out.push({
          key: keyOf(el) + "#" + role,
          role,
          contrast: ratio(composite([...layers, raw]), bg),
          fg: raw,
          bg: bgStr,
          text: `<${el.tagName}>`,
          cls: (el.getAttribute("class") ?? "").slice(0, 90),
          approx,
        });
      }
    }
  }
  return out;
};

test("audit every page in both themes", async ({ page }) => {
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

  const SURFACES: Surface[] = [
    { slug: "dashboard", path: "/" },
    { slug: "analysis", path: "/analysis" },
    { slug: "roll-center", path: "/analysis/roll-center" },
    { slug: "sessions", path: "/runs/history" },
    { slug: "log-run", path: "/runs/new" },
    { slug: "engineer", path: "/engineer" },
    { slug: "events", path: "/events" },
    { slug: "garage", path: "/cars" },
    { slug: "setup-hub", path: "/setup" },
    { slug: "setup-comparison", path: "/setup/comparison" },
    { slug: "setup-documents", path: "/setup-documents" },
    { slug: "setup-calibrations", path: "/setup-calibrations" },
    { slug: "chassis-types", path: "/setup-sheet-models" },
    { slug: "tracks", path: "/tracks" },
    { slug: "tires", path: "/tires" },
    { slug: "additives", path: "/additives" },
    { slug: "videos", path: "/videos" },
    { slug: "video-analysis", path: "/videos/analysis" },
    { slug: "lap-import", path: "/laps/import" },
    { slug: "teams", path: "/teams" },
    { slug: "settings", path: "/settings" },
    { slug: "billing", path: "/billing" },
  ];
  if (ids.RUN_ID) SURFACES.push({ slug: "run-detail", path: `/runs/${ids.RUN_ID}` });
  if (ids.CAR_ID) SURFACES.push({ slug: "car-detail", path: `/cars/${ids.CAR_ID}` });
  if (ids.SETUP_CAR_ID && ids.SETUP_ID) {
    SURFACES.push({ slug: "setup-detail", path: `/cars/${ids.SETUP_CAR_ID}/setups/${ids.SETUP_ID}` });
  }
  if (ids.EVENT_ID) SURFACES.push({ slug: "event-detail", path: `/events/${ids.EVENT_ID}` });
  if (ids.TRACK_ID) SURFACES.push({ slug: "track-detail", path: `/tracks/${ids.TRACK_ID}` });

  const setTheme = async (theme: "dark" | "light") => {
    await page.context().addCookies([
      { name: "rc_theme", value: theme, domain: "localhost", path: "/" },
    ]);
  };

  const load = async (path: string) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (document.querySelector("main, body")?.textContent?.trim().length ?? 0) > 40,
      undefined,
      { timeout: 45_000 },
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
  };

  type Finding = Sample & { slug: string; darkContrast: number };
  const regressions: Finding[] = [];
  const failedPages: string[] = [];
  let compared = 0;

  for (const s of SURFACES) {
    try {
      await setTheme("dark");
      await load(s.path);
      await page.screenshot({ path: `${OUT}/${s.slug}-dark.png`, fullPage: true });
      const darkRows = (await page.evaluate(AUDIT)) as Sample[];

      await setTheme("light");
      await load(s.path);
      await page.screenshot({ path: `${OUT}/${s.slug}-light.png`, fullPage: true });
      const lightRows = (await page.evaluate(AUDIT)) as Sample[];

      // Sanity: the stamp has to have actually landed, or every "pass" below is a lie.
      const stamped = await page.getAttribute("html", "data-theme");
      if (stamped !== "light") throw new Error(`data-theme was "${stamped}", not "light"`);

      const darkBy = new Map(darkRows.map((r) => [r.key, r]));
      let pageFindings = 0;
      for (const l of lightRows) {
        const d = darkBy.get(l.key);
        if (!d) continue; // DOM differed between renders — not comparable, skip.
        compared += 1;
        if (l.contrast < ILLEGIBLE && d.contrast >= WAS_FINE) {
          regressions.push({ ...l, slug: s.slug, darkContrast: d.contrast });
          pageFindings += 1;
        }
      }
      console.log(
        `  ${s.slug.padEnd(20)} ${String(lightRows.length).padStart(4)} samples` +
          (pageFindings ? `  ⚠ ${pageFindings} regressions` : "  ok"),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      failedPages.push(`${s.slug} (${s.path}) — ${msg}`);
      console.log(`  ${s.slug.padEnd(20)} FAILED — ${msg}`);
    }
  }

  // Collapse duplicates: one row per (class, colour pair), listing the pages it hits.
  const grouped = new Map<string, { f: Finding; pages: Set<string>; count: number }>();
  for (const r of regressions) {
    const k = `${r.role}|${r.fg}|${r.bg}|${r.cls}`;
    const g = grouped.get(k);
    if (g) {
      g.pages.add(r.slug);
      g.count += 1;
    } else {
      grouped.set(k, { f: r, pages: new Set([r.slug]), count: 1 });
    }
  }
  const rows = [...grouped.values()].sort((a, b) => a.f.contrast - b.f.contrast);

  const md = [
    "# Light-mode audit",
    "",
    `${SURFACES.length} pages · ${compared} elements compared across both themes.`,
    "",
    "A row is an element that clears WCAG AA on charcoal and drops below 3:1 on paper —",
    "i.e. something this theme broke, not something the app already did.",
    "",
    failedPages.length ? `## Pages that failed to load\n\n${failedPages.map((p) => `- ${p}`).join("\n")}\n` : "",
    rows.length ? "## Regressions" : "## No regressions",
    "",
    ...(rows.length
      ? [
          "| light | dark | role | colour | on | element | pages |",
          "|---|---|---|---|---|---|---|",
          ...rows.map(
            (g) =>
              `| **${g.f.contrast.toFixed(2)}:1** | ${g.f.darkContrast.toFixed(1)}:1 | ${g.f.role} | \`${g.f.fg}\` | \`${g.f.bg}\` | ${
                g.f.role === "text" ? `"${g.f.text.replace(/\|/g, "\\|")}"` : g.f.text
              }<br><code>${g.f.cls.replace(/\|/g, "\\|") || "—"}</code> | ${[...g.pages].join(", ")} (${g.count}) |`,
          ),
        ]
      : []),
    "",
  ].join("\n");

  writeFileSync(`${OUT}/report.md`, md, "utf8");
  console.log("\n" + md);

  if (failedPages.length) throw new Error(`${failedPages.length} page(s) failed to load:\n` + failedPages.join("\n"));
});
