/**
 * Build a reading page for one review round — the founder talks to it in chat, so this is for
 * reading, not grading (his call 2026-09-09: fewer questions, faster iteration, no ship/not clicks).
 *
 *   npm run engineer:round:page -- --batch round-01 [--context run-with-setup] [--arm v1-nets] [--title "Round 01"] [--out path.html]
 *
 * Reads answers/<batch>/<arm>__<context>.json, writes answers/<batch>/round-page.html (and --out,
 * for publishing as an artifact: no document skeleton, <title> + <style> first). Same look as the
 * app: ash paper, Sora for the title, one card per conversation, the context folded away.
 */
import fs from "node:fs";
import path from "node:path";

type Turn = { role: "user" | "assistant"; content: string };
type AnswerFile = { arm: string; context: string; fixture: string | null; cases: Record<string, { shape: string; source: string; turns: Turn[] }> };

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal markdown the Engineer actually emits: **bold**, bullets, numbered items, paragraphs. */
function md(s: string): string {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const l of lines) {
    const b = l.match(/^\s*[-•]\s+(.*)$/);
    const n = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || n) {
      const kind = b ? "ul" : "ol";
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${(b ?? n)![1]}</li>`);
    } else {
      close();
      if (l.trim()) out.push(`<p>${l}</p>`);
    }
  }
  close();
  return out.join("");
}

function main() {
  const batch = argValue("--batch");
  if (!batch) { console.error("Usage: engineer:round:page -- --batch <name> [--context run-with-setup] [--arm v1-nets] [--title ...] [--out ...]"); process.exit(1); }
  const arm = argValue("--arm") ?? "v1-nets";
  const context = argValue("--context") ?? "run-with-setup";
  const title = argValue("--title") ?? batch.replace(/^round-0*/, "Round ");
  const dir = path.join(__dirname, "answers", batch);
  const file = JSON.parse(fs.readFileSync(path.join(dir, `${arm}__${context}.json`), "utf8")) as AnswerFile;
  const cases = Object.entries(file.cases);

  const ctx = file.fixture
    ? `<details class="ctx"><summary>What the Engineer was given: the driver's latest run and setup</summary><pre>${esc(file.fixture)}</pre></details>`
    : `<p class="ctx none">The Engineer was given no driver data.</p>`;

  const cards = cases.map(([id, c], i) => {
    const turns = c.turns.map((t) => `<div class="turn ${t.role}"><div class="who">${t.role === "user" ? "Driver" : "Engineer"}</div><div class="body">${t.role === "user" ? `<p>${esc(t.content)}</p>` : md(t.content)}</div></div>`).join("");
    return `<section class="card" id="${esc(id)}"><div class="head"><span class="n">${i + 1}</span><span class="id">${esc(id)}</span><span class="shape">${esc(c.shape)}</span><span class="src">${c.source === "driver" ? "another driver" : "founder"}</span></div>${turns}</section>`;
  }).join("\n");

  const style = `
  html { background: #EAE7E0; }
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #EAE7E0; color: #1A1A1A; }
  header { background: #1A1A1A; color: #FFFFFF; padding: 14px 18px; display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  header b { font-family: "Sora", system-ui, sans-serif; font-size: 20px; letter-spacing: -0.01em; }
  header span { color: #C9C4B8; font-size: 14px; }
  main { max-width: 820px; margin: 0 auto; padding: 18px 16px 48px; }
  .ctx { font-size: 13px; color: #6B6760; margin: 0 0 18px; } .ctx summary { cursor: pointer; }
  .ctx pre { white-space: pre-wrap; background: #F6F5F1; color: #3A3733; padding: 10px; border-radius: 6px; max-height: 280px; overflow: auto; font-size: 12px; }
  .card { background: #FFFFFF; border-radius: 10px; padding: 14px 18px 6px; margin: 0 0 20px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .head { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: #6B6760; margin-bottom: 6px; }
  .head .n { font-family: "Sora", system-ui, sans-serif; font-weight: 700; font-size: 18px; color: #1A1A1A; }
  .head .id { font-weight: 600; color: #1A1A1A; } .head .shape { background: #EEECE6; padding: 0 8px; border-radius: 10px; }
  .turn { display: grid; grid-template-columns: 80px 1fr; gap: 10px; padding: 10px 0; border-top: 1px solid #EEECE6; }
  .turn .who { font-size: 13px; font-weight: 700; color: #6B6760; padding-top: 2px; }
  .turn.user .body p { font-weight: 600; }
  .body p { margin: 0 0 8px; max-width: 62ch; } .body ul, .body ol { margin: 4px 0 8px 20px; padding: 0; } .body li { margin: 0 0 4px; max-width: 60ch; }
  @media (max-width: 480px) { .turn { grid-template-columns: 1fr; gap: 2px; } main { padding: 12px 10px 40px; } }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }`;

  const inner = `<header><b>${esc(title)}</b><span>${cases.length} conversations · ${esc(context === "none" ? "no driver data" : "with the driver's run and setup")}</span></header>
<main>${ctx}${cards}</main>`;

  const full = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Engineer Review Round</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&display=swap"><style>${style}</style></head><body>${inner}</body></html>`;
  const artifact = `<title>Engineer Review Round</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&display=swap">\n<style>${style}</style>\n${inner}`;

  const outPath = path.join(dir, "round-page.html");
  fs.writeFileSync(outPath, full);
  const out = argValue("--out");
  if (out) fs.writeFileSync(out, artifact);
  console.log(`${cases.length} conversations → ${outPath}${out ? ` (+ artifact body → ${out})` : ""}`);
}

main();
