/**
 * Build a reading page for one review round — the founder talks to it in chat, so this is for
 * reading, not grading (his call 2026-09-09: fewer questions, faster iteration, no ship/not clicks).
 *
 *   npm run engineer:round:page -- --batch round-01 [--context run-with-setup] [--arm v1-nets] [--title "Round 01"] [--out path.html]
 *
 * --context takes a comma-separated list since round 05 (2026-09-21): that round asks the same
 * Engineer with no driver data, a known car with nothing on its sheet, a sheet the app cannot name,
 * and a readable sheet — each group is headed by what the Engineer could see, its block folded away.
 *
 * Reads answers/<batch>/<arm>__<context>.json, writes answers/<batch>/round-page.html (and --out,
 * for publishing as an artifact: no document skeleton, <title> + <style> first). Same look as the
 * app: ash paper, Sora for the title, one card per conversation, the context folded away.
 */
import fs from "node:fs";
import path from "node:path";

type Turn = { role: "user" | "assistant"; content: string; fetched?: string[] };
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
  const contexts = (argValue("--context") ?? "run-with-setup").split(",").map((s) => s.trim()).filter(Boolean);
  const context = contexts[0];
  const title = argValue("--title") ?? batch.replace(/^round-0*/, "Round ");
  const dir = path.join(__dirname, "answers", batch);
  const files = contexts.map((c) => JSON.parse(fs.readFileSync(path.join(dir, `${arm}__${c}.json`), "utf8")) as AnswerFile);
  const cases = files.flatMap((f) => Object.entries(f.cases));

  // What the Engineer could see, in plain words — the heading over each group of a mixed round.
  const seen = (f: AnswerFile): string =>
    !f.fixture
      ? "No driver data at all — a new account, or the General setting"
      : /NOT VISIBLE/.test(f.fixture)
        ? /filled in \d+ boxes/.test(f.fixture)
          ? "Can't read the car — the sheet is filled in, but the app can't name its boxes yet"
          : "Can't read the car — a known car with nothing on its setup sheet"
        : /^LAPS — /m.test(f.fixture)
          ? "Can read the car — the driver's run and setup, every lap of every driver that day, and LiveRC's practice page on request"
          : "Can read the car — the driver's latest run and setup";

  let n = 0;
  const section = (f: AnswerFile): string => {
    // The tool's recorded answer for this context, when it has one (generate-conversations.ts).
    const toolFile = path.join(__dirname, "fixtures", `${f.context}.liverc.txt`);
    const toolText = fs.existsSync(toolFile) ? fs.readFileSync(toolFile, "utf8").trim() : null;
    const given = f.fixture
      ? `<details class="ctx"><summary>What the Engineer was given</summary><pre>${esc(f.fixture)}</pre></details>` +
        (toolText ? `<details class="ctx"><summary>What LiveRC answered when the Engineer asked for the day's practice</summary><pre>${esc(toolText)}</pre></details>` : "")
      : `<p class="ctx none">The Engineer was given no driver data.</p>`;
    const group = Object.entries(f.cases).map(([id, c]) => {
      const turns = c.turns.map((t) => `<div class="turn ${t.role}"><div class="who">${t.role === "user" ? "Driver" : "Engineer"}${t.fetched?.length ? `<span class="fetched">fetched LiveRC</span>` : ""}</div><div class="body">${t.role === "user" ? `<p>${esc(t.content)}</p>` : md(t.content)}</div></div>`).join("");
      return `<section class="card" id="${esc(id)}"><div class="head"><span class="n">${++n}</span><span class="id">${esc(id)}</span><span class="shape">${esc(c.shape)}</span><span class="src">${c.source === "driver" ? "another driver" : "founder"}</span></div>${turns}</section>`;
    }).join("\n");
    return (files.length > 1 ? `<h2 class="sec">${esc(seen(f))}</h2>` : "") + given + group;
  };
  const ctx = "";
  const cards = files.map(section).join("\n");

  const style = `
  html { background: #EAE7E0; }
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #EAE7E0; color: #1A1A1A; }
  header { background: #1A1A1A; color: #FFFFFF; padding: 14px 18px; display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  header b { font-family: "Sora", system-ui, sans-serif; font-size: 20px; letter-spacing: -0.01em; }
  header span { color: #C9C4B8; font-size: 14px; }
  main { max-width: 820px; margin: 0 auto; padding: 18px 16px 48px; }
  .sec { font: 700 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #6B6760; margin: 28px 0 8px; }
  .ctx { font-size: 13px; color: #6B6760; margin: 0 0 18px; } .ctx summary { cursor: pointer; }
  .ctx pre { white-space: pre-wrap; background: #F6F5F1; color: #3A3733; padding: 10px; border-radius: 6px; max-height: 280px; overflow: auto; font-size: 12px; }
  .card { background: #FFFFFF; border-radius: 10px; padding: 14px 18px 6px; margin: 0 0 20px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .head { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: #6B6760; margin-bottom: 6px; }
  .head .n { font-family: "Sora", system-ui, sans-serif; font-weight: 700; font-size: 18px; color: #1A1A1A; }
  .head .id { font-weight: 600; color: #1A1A1A; } .head .shape { background: #EEECE6; padding: 0 8px; border-radius: 10px; }
  .turn { display: grid; grid-template-columns: 80px 1fr; gap: 10px; padding: 10px 0; border-top: 1px solid #EEECE6; }
  .turn .who { font-size: 13px; font-weight: 700; color: #6B6760; padding-top: 2px; }
  .turn .who .fetched { display: block; font-weight: 600; font-size: 11px; color: #8A6D00; background: #FFF3C4; border-radius: 8px; padding: 1px 6px; margin-top: 4px; }
  .turn.user .body p { font-weight: 600; }
  .body p { margin: 0 0 8px; max-width: 62ch; } .body ul, .body ol { margin: 4px 0 8px 20px; padding: 0; } .body li { margin: 0 0 4px; max-width: 60ch; }
  @media (max-width: 480px) { .turn { grid-template-columns: 1fr; gap: 2px; } main { padding: 12px 10px 40px; } }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }`;

  const inner = `<header><b>${esc(title)}</b><span>${cases.length} conversations · ${esc(files.length > 1 ? "what the Engineer could see is named over each group" : context === "none" ? "no driver data" : "with the driver's run and setup")}</span></header>
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
