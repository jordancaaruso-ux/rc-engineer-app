/**
 * Builds a self-contained HTML review page for verifying draft gold
 * (docs/SETUP_UPLOAD_NORTH_STAR.md, Stage 0). Each sheet image is shown next to
 * its transcribed gold values; fields where the extractor disagreed with the gold
 * are surfaced first, because that is exactly where a transcription error hides.
 *
 * Usage:  npm run setup-extract:review           # all styles with a results/ run
 *         npm run setup-extract:review -- coelho  # filter sheets by filename
 * Output: scripts/setup-extract-eval/results/review.html  (gitignored)
 *
 * The output is page CONTENT only (no <html>/<head>/<body>) so it can be published
 * as a Claude Artifact; it also opens directly in a browser (file://).
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

import { parseExtractionSchema, EXTRACTION_FLAG_THRESHOLD } from "@/lib/setupExtractAi/types";
import { matchesExpected } from "@/lib/setupExtractAi/normalizeExtractedValue";

const GOLD_ROOT = join(process.cwd(), "scripts", "setup-extract-eval", "gold");
const RESULTS_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "results");
const OUT = join(RESULTS_DIR, "review.html");

type Expected = { status?: string; fields: Record<string, string | { value: string; accept?: string[] }> };
type Extraction = {
  extraction: { fields: Array<{ key: string; value: string; confidence: number; disagreementValue?: string }> };
  model?: string;
};

type FieldRow = {
  key: string;
  label: string;
  section: string;
  gold: string;
  accept: string[];
  model: string | null;
  confidence: number | null;
  passesDiffered: string | null;
  status: "agree" | "check" | "check-closely" | "no-model";
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function displayVal(v: string): string {
  return v === "" ? "—" : esc(v);
}

function driverLabel(sheetBase: string): string {
  // X42022_BrunoCoelho_Ciserano2022032627 → "Bruno Coelho · Ciserano"
  const parts = sheetBase.replace(/^X\d+_/, "").split("_");
  const name = (parts[0] ?? sheetBase).replace(/([a-z])([A-Z])/g, "$1 $2");
  const place = (parts[1] ?? "").replace(/\d{4,}.*$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return place ? `${name} · ${place}` : name;
}

function main() {
  const filter = process.argv[2]?.toLowerCase() ?? "";
  const styles = readdirSync(GOLD_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  const sheets: Array<{
    id: string;
    driver: string;
    style: string;
    goldStatus: string;
    model: string;
    imgDataUri: string;
    rows: FieldRow[];
    counts: { total: number; checkClosely: number; check: number; agree: number; noModel: number };
  }> = [];

  for (const style of styles) {
    const styleDir = join(GOLD_ROOT, style.name);
    const schema = parseExtractionSchema(JSON.parse(readFileSync(join(styleDir, "schema.json"), "utf8")));
    if (!schema) continue;
    const defByKey = new Map(schema.fields.map((f) => [f.key, f]));
    const expectedDir = join(styleDir, "expected");
    const filesDir = join(styleDir, "files");
    if (!existsSync(expectedDir)) continue;

    for (const expFile of readdirSync(expectedDir).filter((f) => f.endsWith(".json"))) {
      const sheetBase = basename(expFile, ".json");
      if (filter && !sheetBase.toLowerCase().includes(filter)) continue;

      const imgPng = join(filesDir, `${sheetBase}.png`);
      const imgJpg = join(filesDir, `${sheetBase}.jpg`);
      const imgPath = existsSync(imgPng) ? imgPng : imgJpg;
      if (!existsSync(imgPath)) continue;
      const mime = imgPath.endsWith(".jpg") ? "image/jpeg" : "image/png";
      const imgDataUri = `data:${mime};base64,${readFileSync(imgPath).toString("base64")}`;

      const expected = JSON.parse(readFileSync(join(expectedDir, expFile), "utf8")) as Expected;
      const resPath = join(RESULTS_DIR, `${sheetBase}.extraction.json`);
      const res: Extraction | null = existsSync(resPath)
        ? (JSON.parse(readFileSync(resPath, "utf8")) as Extraction)
        : null;
      const modelByKey = new Map((res?.extraction.fields ?? []).map((f) => [f.key, f]));

      const rows: FieldRow[] = [];
      for (const [key, expRaw] of Object.entries(expected.fields)) {
        const exp = typeof expRaw === "string" ? { value: expRaw, accept: [] as string[] } : { value: expRaw.value, accept: expRaw.accept ?? [] };
        const def = defByKey.get(key);
        const m = modelByKey.get(key) ?? null;
        let status: FieldRow["status"];
        if (!m) status = "no-model";
        else if (matchesExpected({ extracted: m.value, expected: exp.value, accept: exp.accept })) status = "agree";
        else if (m.confidence >= EXTRACTION_FLAG_THRESHOLD) status = "check-closely";
        else status = "check";
        rows.push({
          key,
          label: def?.label ?? key,
          section: def?.section ?? "",
          gold: exp.value,
          accept: exp.accept,
          model: m ? m.value : null,
          confidence: m ? m.confidence : null,
          passesDiffered: m?.disagreementValue ?? null,
          status,
        });
      }

      const rank = { "check-closely": 0, check: 1, "no-model": 2, agree: 3 };
      rows.sort((a, b) => rank[a.status] - rank[b.status]);
      const counts = {
        total: rows.length,
        checkClosely: rows.filter((r) => r.status === "check-closely").length,
        check: rows.filter((r) => r.status === "check").length,
        agree: rows.filter((r) => r.status === "agree").length,
        noModel: rows.filter((r) => r.status === "no-model").length,
      };
      sheets.push({
        id: sheetBase,
        driver: driverLabel(sheetBase),
        style: style.name,
        goldStatus: expected.status ?? "draft",
        model: res?.model ?? "no run",
        imgDataUri,
        rows,
        counts,
      });
    }
  }

  if (sheets.length === 0) {
    console.error("No sheets with expected/*.json found (and matching filter).");
    process.exit(1);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUT, renderHtml(sheets));
  const totalToCheck = sheets.reduce((n, s) => n + s.counts.checkClosely + s.counts.check, 0);
  console.log(`Wrote ${OUT}`);
  console.log(`${sheets.length} sheet(s), ${totalToCheck} field(s) flagged to check.`);
}

function pill(status: FieldRow["status"]): string {
  const map: Record<FieldRow["status"], [string, string]> = {
    "check-closely": ["check-closely", "check closely"],
    check: ["check", "check"],
    "no-model": ["no-model", "no model read"],
    agree: ["agree", "agrees"],
  };
  const [cls, label] = map[status];
  return `<span class="pill ${cls}">${label}</span>`;
}

function fieldCard(r: FieldRow): string {
  const acc = r.accept.length ? `<span class="accept">also ok: ${r.accept.map(esc).join(", ")}</span>` : "";
  const modelLine =
    r.model === null
      ? `<div class="mv none">no model read</div>`
      : `<div class="mv">extractor read <b>${displayVal(r.model)}</b>${
          r.confidence !== null ? ` <span class="conf">${Math.round(r.confidence * 100)}%</span>` : ""
        }${r.passesDiffered !== null ? ` <span class="diff">passes differed: ${displayVal(r.passesDiffered)}</span>` : ""}</div>`;
  return `<div class="card ${r.status}">
    <div class="card-top">
      <div class="fkey">${esc(r.key)}</div>
      ${pill(r.status)}
    </div>
    <div class="flabel">${esc(r.label)}</div>
    ${r.section ? `<div class="fsection">${esc(r.section)}</div>` : ""}
    <div class="gold">gold: <b>${displayVal(r.gold)}</b> ${acc}</div>
    ${modelLine}
  </div>`;
}

function compactRow(r: FieldRow): string {
  return `<tr>
    <td class="ck">${esc(r.key)}</td>
    <td class="cg">${displayVal(r.gold)}</td>
    <td class="cm">${r.model === null ? "—" : displayVal(r.model)}</td>
  </tr>`;
}

function renderHtml(sheets: ReturnType<typeof buildSheetsType>): string {
  const tabs = sheets
    .map((s, i) => {
      const flagged = s.counts.checkClosely + s.counts.check;
      const badgeCls = s.counts.checkClosely > 0 ? "b-red" : flagged > 0 ? "b-amber" : "b-green";
      return `<button class="tab${i === 0 ? " active" : ""}" data-tab="${i}">
        <span class="tab-name">${esc(s.driver)}</span>
        <span class="tab-badge ${badgeCls}">${flagged}</span>
      </button>`;
    })
    .join("");

  const panels = sheets
    .map((s, i) => {
      const conflicts = s.rows.filter((r) => r.status === "check-closely" || r.status === "check" || r.status === "no-model");
      const agrees = s.rows.filter((r) => r.status === "agree");
      const conflictCards = conflicts.length
        ? conflicts.map(fieldCard).join("")
        : `<div class="all-clear">Every field agrees with the extractor. Skim the list below to be sure, then mark this sheet verified.</div>`;
      return `<section class="panel${i === 0 ? " active" : ""}" data-panel="${i}">
        <div class="grid">
          <div class="imgcol">
            <div class="imgwrap" data-zoom="0">
              <img class="sheet-img" src="${s.imgDataUri}" alt="${esc(s.driver)} setup sheet" />
            </div>
            <div class="imghint">Click the sheet to zoom · scroll to pan · compare each gold value against what is actually written</div>
          </div>
          <div class="fieldcol">
            <div class="sheet-meta">
              <span class="gold-status ${s.goldStatus}">${esc(s.goldStatus)} gold</span>
              <span class="meta-dot">·</span>
              <span>${s.counts.total} fields</span>
              <span class="meta-dot">·</span>
              <span class="meta-red">${s.counts.checkClosely} check closely</span>
              <span class="meta-dot">·</span>
              <span class="meta-amber">${s.counts.check} check</span>
              <span class="meta-dot">·</span>
              <span class="meta-green">${s.counts.agree} agree</span>
              <span class="meta-dot">·</span>
              <span>model ${esc(s.model)}</span>
            </div>
            <h2 class="col-h">Check these first</h2>
            <p class="col-sub">Fields where the extractor's read differs from the transcribed gold — one of the two is wrong. Look at the sheet and decide.</p>
            <div class="cards">${conflictCards}</div>
            <details class="rest">
              <summary>${agrees.length} fields where gold and extractor agree (likely right — skim)</summary>
              <table class="ctable">
                <thead><tr><th>field</th><th>gold</th><th>extractor</th></tr></thead>
                <tbody>${agrees.map(compactRow).join("")}</tbody>
              </table>
            </details>
          </div>
        </div>
      </section>`;
    })
    .join("");

  const totalFlagged = sheets.reduce((n, s) => n + s.counts.checkClosely + s.counts.check, 0);

  return `<style>
  :root{
    --bg:#f7f5f2; --surface:#ffffff; --surface-2:#f0ece6; --line:#e2ddd5;
    --ink:#1c1a17; --ink-2:#6b665e; --ink-3:#9a938a; --accent:#8a6d00;
    --agree:#2f7d52; --check:#9a6700; --check-bg:#faf1dd; --closely:#c0400c; --closely-bg:#fbe9e2;
    --radius:12px;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#121110; --surface:#181716; --surface-2:#1e1d1c; --line:#2c2b29;
      --ink:#ece9e4; --ink-2:#a09d96; --ink-3:#6a675f; --accent:#ffd60a;
      --agree:#4fd089; --check:#e0a83e; --check-bg:#2a2313; --closely:#e5644e; --closely-bg:#2c1a15;
    }
  }
  :root[data-theme="light"]{
    --bg:#f7f5f2; --surface:#ffffff; --surface-2:#f0ece6; --line:#e2ddd5;
    --ink:#1c1a17; --ink-2:#6b665e; --ink-3:#9a938a; --accent:#8a6d00;
    --agree:#2f7d52; --check:#9a6700; --check-bg:#faf1dd; --closely:#c0400c; --closely-bg:#fbe9e2;
  }
  :root[data-theme="dark"]{
    --bg:#121110; --surface:#181716; --surface-2:#1e1d1c; --line:#2c2b29;
    --ink:#ece9e4; --ink-2:#a09d96; --ink-3:#6a675f; --accent:#ffd60a;
    --agree:#4fd089; --check:#e0a83e; --check-bg:#2a2313; --closely:#e5644e; --closely-bg:#2c1a15;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;}
  .wrap{max-width:1400px;margin:0 auto;padding:24px 20px 64px;}
  header.top{margin-bottom:20px;}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-3);}
  h1{font-size:clamp(22px,3vw,30px);margin:6px 0 4px;letter-spacing:-.01em;text-wrap:balance;}
  .lede{color:var(--ink-2);font-size:14px;max-width:70ch;margin:0;}
  .lede b{color:var(--ink);}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 16px;}
  .tab{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);
    color:var(--ink-2);border-radius:999px;padding:7px 12px 7px 14px;font-family:var(--sans);font-size:13px;cursor:pointer;
    transition:border-color .15s,color .15s;}
  .tab:hover{color:var(--ink);}
  .tab.active{border-color:var(--accent);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent);}
  .tab-badge{font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;border-radius:999px;padding:1px 7px;color:#fff;}
  .b-red{background:var(--closely);} .b-amber{background:var(--check);color:#241c05;} .b-green{background:var(--agree);color:#062b18;}
  .panel{display:none;} .panel.active{display:block;}
  .grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:24px;align-items:start;}
  @media (max-width:900px){.grid{grid-template-columns:1fr;}}
  .imgcol{position:sticky;top:16px;}
  @media (max-width:900px){.imgcol{position:static;}}
  .imgwrap{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:auto;max-height:calc(100vh - 60px);}
  .sheet-img{display:block;width:100%;height:auto;cursor:zoom-in;}
  .imgwrap[data-zoom="1"] .sheet-img{width:170%;max-width:none;cursor:zoom-out;}
  .imghint{color:var(--ink-3);font-size:12px;margin-top:8px;}
  .sheet-meta{font-family:var(--mono);font-size:11px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:14px;}
  .meta-dot{color:var(--ink-3);}
  .meta-red{color:var(--closely);} .meta-amber{color:var(--check);} .meta-green{color:var(--agree);}
  .gold-status{text-transform:uppercase;letter-spacing:.12em;border:1px solid var(--line);border-radius:6px;padding:1px 6px;}
  .gold-status.draft{color:var(--check);border-color:var(--check);}
  .gold-status.verified{color:var(--agree);border-color:var(--agree);}
  .col-h{font-size:15px;margin:0 0 4px;}
  .col-sub{color:var(--ink-2);font-size:13px;margin:0 0 14px;max-width:60ch;}
  .cards{display:flex;flex-direction:column;gap:10px;}
  .card{background:var(--surface);border:1px solid var(--line);border-left-width:3px;border-radius:10px;padding:10px 12px;}
  .card.check-closely{border-left-color:var(--closely);background:var(--closely-bg);}
  .card.check{border-left-color:var(--check);background:var(--check-bg);}
  .card.no-model{border-left-color:var(--ink-3);}
  .card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;}
  .fkey{font-family:var(--mono);font-size:12px;color:var(--ink);font-weight:600;}
  .flabel{font-size:12.5px;color:var(--ink-2);margin-top:3px;line-height:1.35;}
  .fsection{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-top:3px;}
  .gold{font-size:13.5px;margin-top:8px;} .gold b{font-family:var(--mono);color:var(--ink);}
  .accept{color:var(--ink-3);font-size:11px;margin-left:6px;}
  .mv{font-size:12.5px;color:var(--ink-2);margin-top:3px;} .mv b{font-family:var(--mono);color:var(--ink);}
  .mv.none{color:var(--ink-3);font-style:italic;}
  .conf{font-family:var(--mono);font-size:11px;color:var(--ink-3);}
  .diff{display:inline-block;font-size:11px;color:var(--check);margin-left:4px;}
  .pill{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:2px 8px;white-space:nowrap;}
  .pill.check-closely{background:var(--closely);color:#fff;}
  .pill.check{background:var(--check);color:#241c05;}
  .pill.no-model{background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line);}
  .pill.agree{background:var(--agree);color:#062b18;}
  .all-clear{background:var(--surface);border:1px solid var(--agree);border-radius:10px;padding:14px;color:var(--ink-2);font-size:13px;}
  .rest{margin-top:18px;border-top:1px solid var(--line);padding-top:12px;}
  .rest summary{cursor:pointer;color:var(--ink-2);font-size:13px;}
  .rest summary:hover{color:var(--ink);}
  .ctable{width:100%;border-collapse:collapse;margin-top:10px;font-size:12.5px;}
  .ctable th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);
    border-bottom:1px solid var(--line);padding:6px 8px;font-weight:400;}
  .ctable td{padding:5px 8px;border-bottom:1px solid var(--line);}
  .ctable .ck{font-family:var(--mono);color:var(--ink-2);}
  .ctable .cg{font-family:var(--mono);color:var(--ink);} .ctable .cm{font-family:var(--mono);color:var(--ink-3);}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
</style>

<div class="wrap">
  <header class="top">
    <div class="eyebrow">Xray X4'22 · Stage 0 gold verification</div>
    <h1>Verify the transcribed setup values</h1>
    <p class="lede">Each field was read three times — my transcription plus two model passes. The <b>${totalFlagged} fields</b> where those reads disagree are surfaced first: for each, look at the sheet and decide whether the <b>gold</b> value or the <b>extractor</b> value is right. Tell me every gold value that needs fixing; I'll edit the JSON and re-run the eval.</p>
  </header>
  <div class="tabs" role="tablist">${tabs}</div>
  ${panels}
</div>

<script>
  (function(){
    const tabs=[...document.querySelectorAll('.tab')];
    const panels=[...document.querySelectorAll('.panel')];
    tabs.forEach(t=>t.addEventListener('click',()=>{
      const i=t.dataset.tab;
      tabs.forEach(x=>x.classList.toggle('active',x===t));
      panels.forEach(p=>p.classList.toggle('active',p.dataset.panel===i));
      window.scrollTo({top:0,behavior:'smooth'});
    }));
    document.querySelectorAll('.imgwrap').forEach(w=>{
      w.querySelector('.sheet-img').addEventListener('click',()=>{
        w.dataset.zoom = w.dataset.zoom==='1' ? '0' : '1';
      });
    });
  })();
</script>`;
}

// Type helper so renderHtml's param type reads cleanly.
function buildSheetsType() {
  return [] as Array<{
    id: string; driver: string; style: string; goldStatus: string; model: string;
    imgDataUri: string; rows: FieldRow[];
    counts: { total: number; checkClosely: number; check: number; agree: number; noModel: number };
  }>;
}

main();
