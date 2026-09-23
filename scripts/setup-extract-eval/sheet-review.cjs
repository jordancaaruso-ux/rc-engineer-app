/**
 * Build the review page for one named sheet.
 *
 *   node scripts/setup-extract-eval/sheet-review.cjs <workDir> [outFile.html] [--gold=answer-key.json]
 *
 * Reads review.json + manifest.json + page.png (and result-a/b.json for tick-box groups) from the
 * work folder and writes a self-contained page: the sheet with every box outlined by verdict,
 * beside the list of names. --gold adds the founder's own name for each box (naming-gold/*.json).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const args = process.argv.slice(2);
const flag = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
const [dir, outArg] = args.filter((x) => !x.startsWith("--"));
if (!dir) throw new Error("usage: sheet-review.cjs <workDir> [out.html] [--gold=answer-key.json]");
const out = outArg || path.join(dir, "review.html");

const review = JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const regions = new Map(manifest.fields.map((f) => [f.name, f.region]));

// A tick-box group is one row but several PDF fields; the drafts say which fields belong together.
const drafted = (pass) => {
  const m = new Map();
  const p = path.join(dir, `result-${pass}.json`);
  if (!fs.existsSync(p)) return m;
  for (const f of JSON.parse(fs.readFileSync(p, "utf8")).draftedSchema.fields) for (const n of f.pdfFieldNames || []) if (!m.has(n)) m.set(n, f);
  return m;
};
const passA = drafted("a"), passB = drafted("b");
const membersOf = (r) => (passA.get(r.pdfName) || passB.get(r.pdfName) || { pdfFieldNames: [r.pdfName] }).pdfFieldNames;

// Boxes both passes left without a section fall back to the drawing they sit in.
const drawingOf = new Map();
const blocksDir = path.join(dir, "blocks");
if (fs.existsSync(blocksDir)) {
  for (const f of fs.readdirSync(blocksDir).filter((x) => /^part-\d+\.json$/.test(x)).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(blocksDir, f), "utf8"));
    const label = String((p.block && p.block.label) || "").replace(/^\(no heading\s*[—-]\s*/i, "").replace(/\)$/, "").trim();
    for (const x of p.fields || []) if (label && !drawingOf.has(x.name)) drawingOf.set(x.name, label.charAt(0).toUpperCase() + label.slice(1));
  }
}

const goldPath = flag("gold");
const gold = goldPath ? JSON.parse(fs.readFileSync(goldPath, "utf8")) : null;
const yoursOf = (r) => [...new Set(membersOf(r).map((n) => gold.gold[n] && gold.gold[n].label).filter(Boolean))].join(" / ");

// The next bar down, so the founder can see exactly what lowering it would ship.
const NEXT = 0.7;
const bar = review.minConfidence ?? 0.8;
const nearReady = (r) => bar > NEXT && r.verdict === "low-confidence" && Math.min(r.confA, r.confB) >= NEXT;

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

(async () => {
  const pageBuf = await sharp(path.join(dir, "page.png")).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const pageMeta = await sharp(pageBuf).metadata();
  const pageData = `data:image/jpeg;base64,${pageBuf.toString("base64")}`;

  const VERDICT = {
    ready: { label: "Ready", tone: "ready" },
    disagree: { label: "Passes disagree", tone: "clash" },
    "low-confidence": { label: "Not confident", tone: "unsure" },
    "one-pass-only": { label: "Named once", tone: "unsure" },
  };

  const rows = review.rows.map((r, i) => ({ ...r, i, near: nearReady(r) }));
  const nearCount = rows.filter((r) => r.near).length;
  const bySection = new Map();
  for (const r of rows) {
    const s = r.section || drawingOf.get(r.pdfName) || "Unsectioned";
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(r);
  }

  // The name to show: the shipped one, else the more confident pass's.
  const bestName = (r) => r.chosen || ((r.confB ?? -1) > (r.confA ?? -1) ? r.b : r.a) || r.a || r.b || r.pdfName;

  const marks = rows
    .flatMap((r) => membersOf(r).map((n) => regions.get(n)).filter(Boolean).map((g) => {
      const x = g.w < 0 ? g.x + g.w : g.x, y = g.h < 0 ? g.y + g.h : g.y;
      const w = Math.abs(g.w), h = Math.abs(g.h);
      return `<button type="button" class="mark ${VERDICT[r.verdict].tone}" data-i="${r.i}" aria-label="${esc(bestName(r))}" style="left:${(x * 100).toFixed(3)}%;top:${(y * 100).toFixed(3)}%;width:${(w * 100).toFixed(3)}%;height:${(h * 100).toFixed(3)}%"></button>`;
    }))
    .join("");

  const sections = [...bySection.entries()]
    .map(([name, list]) => {
      const items = list
        .map((r) => {
          const v = VERDICT[r.verdict];
          const lines = [];
          if (r.verdict !== "ready") {
            lines.push(`<div><span class="passlabel">Pass 1</span> ${esc(r.a) || "<em>not named</em>"}${r.confA != null ? ` <span class="conf">${r.confA.toFixed(2)}</span>` : ""}</div>`);
            lines.push(`<div><span class="passlabel">Pass 2</span> ${esc(r.b) || "<em>not named</em>"}${r.confB != null ? ` <span class="conf">${r.confB.toFixed(2)}</span>` : ""}</div>`);
          }
          if (gold) {
            const y = yoursOf(r);
            lines.push(`<div class="yours"><span class="passlabel">Your name</span> ${y ? esc(y) : "<em>you never named this box</em>"}</div>`);
          }
          const both = lines.length ? `<div class="passes">${lines.join("")}</div>` : "";
          const opts = Array.isArray(r.options) && r.options.length
            ? `<div class="opts">${r.options.map((o) => `<span>${esc(typeof o === "string" ? o : o.label ?? o.value ?? "")}</span>`).join("")}</div>`
            : "";
          const chip = r.near ? `<span class="chip near">Ready at ${NEXT}</span>` : `<span class="chip ${v.tone}">${v.label}</span>`;
          return `<article class="box ${v.tone}" id="box-${r.i}" data-verdict="${r.verdict}"${r.near ? ' data-near="1"' : ""}>
  <div class="boxhead">
    <h3>${esc(bestName(r))}</h3>
    ${chip}
  </div>
  <div class="meta"><code>${esc(r.pdfName)}</code>${r.printedLabel ? `<span class="printed">prints &ldquo;${esc(r.printedLabel)}&rdquo;</span>` : `<span class="printed none">nothing printed</span>`}${r.universalParameterId ? `<span class="upid">${esc(r.universalParameterId)}</span>` : ""}</div>
  ${both}${opts}
</article>`;
        })
        .join("");
      return `<section class="group"><h2>${esc(name)} <span class="count">${list.length}</span></h2>${items}</section>`;
    })
    .join("");

  const t = review.tally;
  const total = review.rows.length;
  const pct = (n) => Math.round((n / total) * 100);

  const html = `<title>${esc(review.car)} box names</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper: #F2F2EF;
    --surface: #FFFFFF;
    --edge: #DEDED8;
    --ink: #15171B;
    --muted: #666C74;
    --marker: #C8006A;
    --ready: #1C6B46;
    --ready-bg: #E4F0EA;
    --clash: #A93A12;
    --clash-bg: #FAE8E0;
    --unsure: #7A5B12;
    --unsure-bg: #F6EEDA;
    --shadow: 0 1px 2px rgba(20,22,26,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #111318;
      --surface: #1A1D23;
      --edge: #2C313A;
      --ink: #E7E9ED;
      --muted: #949BA6;
      --marker: #FF4FA3;
      --ready: #6FD4A2;
      --ready-bg: #14312492;
      --clash: #FF9B6E;
      --clash-bg: #3A1D1092;
      --unsure: #E2C26A;
      --unsure-bg: #33290E92;
      --shadow: 0 1px 2px rgba(0,0,0,.4);
    }
  }
  :root[data-theme="dark"] {
    --paper: #111318;
    --surface: #1A1D23;
    --edge: #2C313A;
    --ink: #E7E9ED;
    --muted: #949BA6;
    --marker: #FF4FA3;
    --ready: #6FD4A2;
    --ready-bg: #14312492;
    --clash: #FF9B6E;
    --clash-bg: #3A1D1092;
    --unsure: #E2C26A;
    --unsure-bg: #33290E92;
    --shadow: 0 1px 2px rgba(0,0,0,.4);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    font-size: 15px; line-height: 1.5;
    padding-block: 28px 64px; padding-inline: 20px;
  }
  .wrap { max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }

  header h1 {
    font-family: "Saira Condensed", "IBM Plex Sans", sans-serif;
    font-weight: 700; font-size: clamp(30px, 5vw, 46px); letter-spacing: .01em;
    margin: 0; text-wrap: balance; text-transform: uppercase;
  }
  .eyebrow {
    font-family: "Saira Condensed", sans-serif; text-transform: uppercase;
    letter-spacing: .14em; font-size: 12px; font-weight: 600; color: var(--marker); margin: 0 0 2px;
  }
  header p { margin: 6px 0 0; color: var(--muted); max-width: 62ch; }

  .tally { display: flex; flex-wrap: wrap; gap: 10px; }
  .stat {
    flex: 1 1 170px; background: var(--surface); border: 1px solid var(--edge);
    border-radius: 3px; padding: 12px 14px; box-shadow: var(--shadow);
    display: flex; flex-direction: column; gap: 2px;
  }
  .stat b { font-family: "Saira Condensed", sans-serif; font-size: 34px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 12.5px; color: var(--muted); }
  .stat.ready b { color: var(--ready); }
  .stat.clash b { color: var(--clash); }
  .stat.unsure b { color: var(--unsure); }

  .bar { display: flex; height: 8px; border-radius: 2px; overflow: hidden; border: 1px solid var(--edge); }
  .bar i { display: block; }
  .bar .r { background: var(--ready); }
  .bar .c { background: var(--clash); }
  .bar .u { background: var(--unsure); }

  .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .filters button {
    font: inherit; font-size: 13px; cursor: pointer; padding: 5px 12px; border-radius: 2px;
    border: 1px solid var(--edge); background: var(--surface); color: var(--ink);
  }
  .filters button[aria-pressed="true"] { border-color: var(--marker); color: var(--marker); font-weight: 600; }
  .filters button:focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; }

  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; align-items: start; }
  .sheet { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); background: var(--surface); border: 1px solid var(--edge); border-radius: 3px; padding: 8px; box-shadow: var(--shadow); }
  @media (max-width: 950px) { .split { grid-template-columns: minmax(0, 1fr); } .sheet { position: static; } }
  .sheetinner { position: relative; line-height: 0; }
  .sheetinner img { width: 100%; height: auto; display: block; }
  .mark {
    position: absolute; border: 1.5px solid; background: transparent; padding: 0; cursor: pointer;
    border-radius: 1px; min-width: 4px; min-height: 4px;
  }
  .mark.ready { border-color: var(--ready); background: color-mix(in srgb, var(--ready) 14%, transparent); }
  .mark.clash { border-color: var(--clash); background: color-mix(in srgb, var(--clash) 22%, transparent); }
  .mark.unsure { border-color: var(--unsure); background: color-mix(in srgb, var(--unsure) 20%, transparent); }
  .mark:hover, .mark.on { outline: 2px solid var(--marker); outline-offset: 1px; z-index: 3; }
  .mark:focus-visible { outline: 2px solid var(--marker); outline-offset: 1px; }

  .list { display: flex; flex-direction: column; gap: 20px; }
  .group h2 {
    font-family: "Saira Condensed", sans-serif; text-transform: uppercase; letter-spacing: .1em;
    font-size: 13px; font-weight: 600; color: var(--muted); margin: 0 0 8px;
    display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid var(--edge); padding-bottom: 5px;
  }
  .group h2 .count { font-family: "IBM Plex Mono", monospace; font-size: 11px; }

  .box { border-left: 3px solid var(--edge); padding: 9px 0 9px 12px; margin-bottom: 2px; scroll-margin-top: 20px; }
  .box.ready { border-left-color: var(--ready); }
  .box.clash { border-left-color: var(--clash); background: var(--clash-bg); }
  .box.unsure { border-left-color: var(--unsure); }
  .box.on { outline: 2px solid var(--marker); outline-offset: 3px; }
  .boxhead { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; }
  .box h3 { margin: 0; font-size: 15.5px; font-weight: 600; line-height: 1.3; }
  .chip {
    font-family: "Saira Condensed", sans-serif; text-transform: uppercase; letter-spacing: .08em;
    font-size: 11px; font-weight: 600; white-space: nowrap; padding: 2px 7px; border-radius: 2px;
  }
  .chip.ready { color: var(--ready); background: var(--ready-bg); }
  .chip.clash { color: var(--clash); background: var(--clash-bg); }
  .chip.unsure { color: var(--unsure); background: var(--unsure-bg); }
  .chip.near { color: var(--ready); border: 1px dashed var(--ready); padding: 1px 6px; }

  .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 3px; font-size: 12.5px; color: var(--muted); align-items: baseline; }
  .meta code { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; }
  .printed.none { font-style: italic; opacity: .75; }
  .upid { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: var(--marker); }

  .passes { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
  .passlabel {
    font-family: "Saira Condensed", sans-serif; text-transform: uppercase; letter-spacing: .08em;
    font-size: 10.5px; color: var(--muted); margin-right: 5px;
  }
  .conf { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .yours .passlabel { color: var(--marker); }
  .passes > .yours:not(:first-child) { margin-top: 3px; padding-top: 4px; border-top: 1px dotted var(--edge); }
  .opts { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
  .opts span { font-size: 11.5px; border: 1px solid var(--edge); border-radius: 2px; padding: 1px 6px; color: var(--muted); }

  .hidden { display: none !important; }
  footer { color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--edge); padding-top: 12px; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">Blank sheet &middot; named by two independent passes</p>
    <h1>${esc(review.car)}</h1>
    <p>Every box on the blank PDF, named by reading each printed drawing whole and following each box&rsquo;s line to the part it sets. A name is ready only where both passes gave the same name and both were at least ${bar} confident, so anything doubtful stays unnamed rather than wrong.${gold ? " Under each box is the name you gave it in your own calibration." : ""}</p>
  </header>

  <div class="tally">
    <div class="stat ready"><b>${t.ready}</b><span>Ready to use &middot; ${pct(t.ready)}% of the sheet</span></div>
    <div class="stat clash"><b>${t.disagree}</b><span>The two passes disagree</span></div>
    <div class="stat unsure"><b>${t.lowConfidence + (t.onlyOnePass || 0)}</b><span>Agreed but not confident${nearCount ? ` &middot; ${nearCount} clear ${NEXT}` : ""}</span></div>
    <div class="stat"><b>${total}</b><span>Boxes on the sheet</span></div>
  </div>

  <div class="bar" role="img" aria-label="${t.ready} ready, ${t.disagree} disagreeing, ${t.lowConfidence + (t.onlyOnePass || 0)} unconfident of ${total} boxes">
    <i class="r" style="flex:${t.ready}"></i><i class="c" style="flex:${t.disagree}"></i><i class="u" style="flex:${t.lowConfidence + (t.onlyOnePass || 0)}"></i>
  </div>

  <div class="filters">
    <button type="button" id="f-all" aria-pressed="true">All ${total}</button>
    <button type="button" id="f-ready" aria-pressed="false">Ready ${t.ready}</button>
    <button type="button" id="f-disagree" aria-pressed="false">Disagree ${t.disagree}</button>
    <button type="button" id="f-low-confidence" aria-pressed="false">Not confident ${t.lowConfidence}</button>
    ${nearCount ? `<button type="button" id="f-near" aria-pressed="false">Ready at ${NEXT} ${nearCount}</button>` : ""}
  </div>

  <div class="split">
    <div class="sheet">
      <div class="sheetinner" style="aspect-ratio:${pageMeta.width} / ${pageMeta.height}">
        <img src="${pageData}" alt="The ${esc(review.car)} blank setup sheet" width="${pageMeta.width}" height="${pageMeta.height}">
        ${marks}
      </div>
    </div>
    <div class="list" id="list">${sections}</div>
  </div>

  <footer>Two independent passes of Claude Opus named every box from a 6x picture of each drawing with its boxes tagged. Ready means both passes agreed and both were at least ${bar} confident.${nearCount ? ` &ldquo;Ready at ${NEXT}&rdquo; marks the names a ${NEXT} bar would also ship.` : ""}</footer>
</div>

<script>
  var marks = Array.prototype.slice.call(document.querySelectorAll(".mark"));
  var boxes = Array.prototype.slice.call(document.querySelectorAll(".box"));
  var current = null;
  function select(i, scroll) {
    if (current !== null) {
      document.querySelectorAll('.mark[data-i="' + current + '"]').forEach(function (pm) { pm.classList.remove("on"); });
      var pb = document.getElementById("box-" + current);
      if (pb) pb.classList.remove("on");
    }
    current = i;
    document.querySelectorAll('.mark[data-i="' + i + '"]').forEach(function (m) { m.classList.add("on"); });
    var b = document.getElementById("box-" + i);
    if (b) { b.classList.add("on"); if (scroll) b.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
  marks.forEach(function (m) { m.addEventListener("click", function () { select(m.dataset.i, true); }); });
  boxes.forEach(function (b) { b.addEventListener("click", function () { select(b.id.slice(4), false); }); });

  var filters = ["all", "ready", "disagree", "low-confidence", "near"];
  function shows(b, name) {
    return name === "all" || b.dataset.verdict === name || (name === "near" && b.dataset.near === "1");
  }
  filters.forEach(function (name) {
    var btn = document.getElementById("f-" + name);
    if (!btn) return;
    btn.addEventListener("click", function () {
      filters.forEach(function (n) { var o = document.getElementById("f-" + n); if (o) o.setAttribute("aria-pressed", String(n === name)); });
      boxes.forEach(function (b) { b.classList.toggle("hidden", !shows(b, name)); });
      document.querySelectorAll(".group").forEach(function (g) {
        var any = Array.prototype.slice.call(g.querySelectorAll(".box")).some(function (b) { return !b.classList.contains("hidden"); });
        g.classList.toggle("hidden", !any);
      });
      marks.forEach(function (m) {
        var b = document.getElementById("box-" + m.dataset.i);
        m.classList.toggle("hidden", !b || b.classList.contains("hidden"));
      });
    });
  });
</script>
`;

  fs.writeFileSync(out, html);
  console.log(`review page: ${out} (${(html.length / 1024).toFixed(0)} KB, ${total} boxes)`);
})();
