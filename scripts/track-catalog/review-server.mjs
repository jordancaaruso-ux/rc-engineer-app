/**
 * Local review tool for the track catalog seed. Standalone on purpose — it reads and writes JSON
 * files in seeds/track-catalog/ and never touches the database or ships to production.
 *
 * The design goal is minutes, not a weekend. Two modes, because the work is two different jobs:
 *
 *   SCAN   — the clean rows. 40 to a screen, accept the whole page with one key. A page you don't
 *            have to think about costs about two seconds.
 *   FOCUS  — the doubtful rows: bad names, no pin, or a proposed merge with a track that already
 *            has runs against it. One at a time, with everything needed to decide.
 *
 * Every keystroke is written to decisions.json immediately, so stopping halfway costs nothing.
 *
 *   node scripts/track-catalog/review-server.mjs
 *   -> http://localhost:5177
 */
import fs from "node:fs";
import http from "node:http";

const DIR = "seeds/track-catalog";
const CANDIDATES = `${DIR}/candidates.json`;
const MATCHES = `${DIR}/matches.json`;
const DECISIONS = `${DIR}/decisions.json`;
const PORT = Number(process.argv[2] ?? 5177);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadData() {
  const candidatesDoc = readJson(CANDIDATES, { candidates: [] });
  const matchesDoc = readJson(MATCHES, { proposals: [], intraSetFolds: [] });
  const decisions = readJson(DECISIONS, {});

  const proposalByKey = new Map();
  for (const p of matchesDoc.proposals ?? []) proposalByKey.set(p.candidateKey, p);
  const foldedKeys = new Set((matchesDoc.intraSetFolds ?? []).map((f) => f.foldKey));

  /**
   * Flags that are information, not a question.
   *
   * A track with no pin is perfectly good data — it just won't appear in "near me". There is
   * nothing the reviewer can decide by looking at it; they cannot geocode it by squinting. Sending
   * those 300 rows to Focus turned a 90-minute review into an afternoon of pressing Enter, so they
   * stay in Scan where they still show a "no pin" badge.
   */
  const INFORMATIONAL_FLAGS = new Set(["no-coordinates", "geocode-too-coarse"]);

  const rows = candidatesDoc.candidates.map((c) => {
    const proposal = proposalByKey.get(c.key) ?? null;
    const decidableFlags = c.flags.filter((f) => !INFORMATIONAL_FLAGS.has(f));
    // A row needs a human when its data is doubtful, or when accepting it would rewrite a track
    // that drivers already have runs against.
    const needsFocus =
      decidableFlags.length > 0 ||
      (proposal && proposal.confidence === "possible") ||
      (proposal && proposal.existing.runCount > 0 && proposal.confidence !== "confident");
    return {
      ...c,
      proposal,
      foldedIntoAnother: foldedKeys.has(c.key),
      needsFocus: Boolean(needsFocus),
    };
  });

  return { rows, decisions, generatedAt: candidatesDoc.builtAt ?? null };
}

function saveDecision(key, decision) {
  const decisions = readJson(DECISIONS, {});
  if (decision === null) delete decisions[key];
  else decisions[key] = { ...decision, at: new Date().toISOString() };
  fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 1));
  return Object.keys(decisions).length;
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Track catalog review</title>
<style>
  :root {
    --bg:#f6f5f2; --card:#fff; --ink:#1a1a18; --muted:#6b6b63; --line:#e2e0da;
    --accept:#1f7a4d; --reject:#a33; --flag:#8a6d1f; --flag-bg:#fdf6e3; --focus:#2563eb;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--ink); }
  header { position:sticky; top:0; z-index:10; background:var(--card); border-bottom:1px solid var(--line);
           padding:10px 16px; display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  h1 { font-size:15px; margin:0; font-weight:650; }
  .bar { flex:1; min-width:200px; height:8px; background:var(--line); border-radius:4px; overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--accept); transition:width .2s; }
  .stat { font-variant-numeric:tabular-nums; color:var(--muted); font-size:13px; }
  .stat b { color:var(--ink); }
  .keys { font-size:12px; color:var(--muted); }
  kbd { background:var(--bg); border:1px solid var(--line); border-bottom-width:2px; border-radius:4px;
        padding:1px 5px; font:inherit; font-size:11px; }
  main { padding:16px; max-width:1180px; margin:0 auto; }

  /* ---- scan mode: a dense table you read, not a form you fill in */
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line);
          border-radius:10px; overflow:hidden; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
       padding:8px 10px; border-bottom:1px solid var(--line); font-weight:600; }
  td { padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  tr.sel td { background:#eef4ff; }
  tr.rejected td { opacity:.4; text-decoration:line-through; }
  tr.rejected td .badge { text-decoration:none; }
  .nm { font-weight:600; }
  .sub { color:var(--muted); font-size:12.5px; }
  .badge { display:inline-block; font-size:11px; padding:1px 6px; border-radius:20px; border:1px solid var(--line);
           color:var(--muted); margin-right:4px; white-space:nowrap; }
  .badge.warn { background:var(--flag-bg); border-color:#e8d9a8; color:var(--flag); }
  .badge.merge { background:#eef4ff; border-color:#c9dbff; color:var(--focus); }
  .badge.nopin { background:#fdeeee; border-color:#f2caca; color:var(--reject); }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }
  a { color:var(--focus); }

  /* ---- focus mode: one decision, all the context */
  .focus { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:22px; }
  .focus h2 { margin:0 0 2px; font-size:24px; }
  .focus .where { color:var(--muted); margin-bottom:16px; }
  .grid { display:grid; grid-template-columns:150px 1fr; gap:6px 16px; margin:14px 0; }
  .grid dt { color:var(--muted); font-size:13px; }
  .grid dd { margin:0; }
  .merge-box { border:1px solid #c9dbff; background:#f5f9ff; border-radius:10px; padding:14px; margin:16px 0; }
  .merge-box h3 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--focus); }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line);
           background:var(--card); cursor:pointer; }
  button.primary { background:var(--accept); border-color:var(--accept); color:#fff; font-weight:600; }
  button.danger { background:var(--card); border-color:#e0b4b4; color:var(--reject); }
  input[type=text] { font:inherit; padding:7px 10px; border:1px solid var(--line); border-radius:8px; width:100%;
                     background:var(--card); color:var(--ink); }
  .done { text-align:center; padding:60px 20px; color:var(--muted); }
  .done b { color:var(--accept); font-size:18px; display:block; margin-bottom:6px; }
  .tabs { display:flex; gap:6px; }
  .tabs button.on { background:var(--ink); color:var(--card); border-color:var(--ink); }
</style>
</head>
<body>
<header>
  <h1>Track catalog review</h1>
  <div class="tabs">
    <button id="tab-focus">Focus <span id="n-focus"></span></button>
    <button id="tab-scan">Scan <span id="n-scan"></span></button>
  </div>
  <div class="bar"><i id="bar"></i></div>
  <div class="stat"><b id="n-done">0</b> / <span id="n-all">0</span> decided
    &nbsp;·&nbsp; <b id="n-acc">0</b> in &nbsp;·&nbsp; <b id="n-rej">0</b> out</div>
  <div class="keys" id="keys"></div>
</header>
<main id="app"></main>

<script>
const state = { rows:[], decisions:{}, mode:"focus", cursor:0, page:0, PAGE:40, editing:false };

async function load() {
  const r = await fetch("/api/data");
  const d = await r.json();
  state.rows = d.rows;
  state.decisions = d.decisions;
  render();
}

function decidedCount() { return Object.keys(state.decisions).length; }
function focusRows() { return state.rows.filter(r => r.needsFocus && !r.foldedIntoAnother); }
function scanRows()  { return state.rows.filter(r => !r.needsFocus && !r.foldedIntoAnother); }
function pending(list){ return list.filter(r => !state.decisions[r.key]); }

async function decide(key, verdict, extra) {
  const body = verdict === null ? { key, decision:null }
                                : { key, decision:{ verdict, ...(extra||{}) } };
  state.decisions = (await (await fetch("/api/decision", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
  })).json()).decisions;
}

function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function place(r){ return [r.city, r.region, (r.countryCode||"").toUpperCase()].filter(Boolean).join(", "); }

function updateHeader() {
  const all = state.rows.filter(r => !r.foldedIntoAnother);
  const done = decidedCount();
  const acc = Object.values(state.decisions).filter(d => d.verdict === "accept").length;
  document.getElementById("n-done").textContent = done;
  document.getElementById("n-all").textContent = all.length;
  document.getElementById("n-acc").textContent = acc;
  document.getElementById("n-rej").textContent = done - acc;
  document.getElementById("bar").style.width = (all.length ? (done/all.length*100) : 0) + "%";
  document.getElementById("n-focus").textContent = "(" + pending(focusRows()).length + ")";
  document.getElementById("n-scan").textContent = "(" + pending(scanRows()).length + ")";
  document.getElementById("tab-focus").className = state.mode === "focus" ? "on" : "";
  document.getElementById("tab-scan").className  = state.mode === "scan"  ? "on" : "";
  document.getElementById("keys").innerHTML = state.mode === "focus"
    ? '<kbd>Enter</kbd> accept &nbsp;<kbd>x</kbd> reject &nbsp;<kbd>e</kbd> rename &nbsp;<kbd>m</kbd> toggle merge &nbsp;<kbd>u</kbd> undo last'
    : '<kbd>A</kbd> accept page &nbsp;<kbd>j/k</kbd> move &nbsp;<kbd>x</kbd> reject row &nbsp;<kbd>u</kbd> undo last';
}

function render() {
  updateHeader();
  const app = document.getElementById("app");
  app.innerHTML = state.mode === "focus" ? renderFocus() : renderScan();
  const sel = document.querySelector("tr.sel");
  if (sel) sel.scrollIntoView({ block:"nearest" });
  wire();
}

// ---------------------------------------------------------------- focus
function renderFocus() {
  const list = pending(focusRows());
  if (!list.length) return '<div class="done"><b>Focus queue clear.</b>Every doubtful row has been decided. Switch to Scan for the rest.</div>';
  const r = list[0];
  const p = r.proposal;
  const flags = r.flags.map(f => '<span class="badge warn">' + esc(f) + '</span>').join("");
  const pin = r.latitude != null
    ? '<a href="https://www.openstreetmap.org/?mlat=' + r.latitude + '&mlon=' + r.longitude + '#map=17/' + r.latitude + '/' + r.longitude + '" target="_blank">' + r.latitude.toFixed(5) + ", " + r.longitude.toFixed(5) + ' &#8599;</a>'
    : '<span class="badge nopin">no pin &mdash; will not appear in &ldquo;near me&rdquo;</span>';

  return '<div class="focus">' +
    '<h2>' + esc(r.name) + '</h2>' +
    '<div class="where">' + esc(place(r) || "location unknown") + '</div>' +
    flags +
    '<dl class="grid">' +
      '<dt>Source</dt><dd class="mono">' + esc(r.key) + '</dd>' +
      '<dt>Street</dt><dd>' + esc(r.street || "—") + '</dd>' +
      '<dt>Coordinates</dt><dd>' + pin + '</dd>' +
      '<dt>Timing link</dt><dd>' + (r.liveRcUrl
        ? '<a href="' + esc(r.liveRcUrl) + '" target="_blank">' + esc(r.liveRcUrl) + ' &#8599;</a>'
        : '<span class="sub">none &mdash; driver donates one via &ldquo;find your link&rdquo;</span>') + '</dd>' +
      '<dt>Last raced</dt><dd>' + esc(r.lastEvent || "—") + (r.eventCount ? ' <span class="sub">(' + r.eventCount + ' events listed)</span>' : "") + '</dd>' +
      (r.website ? '<dt>Website</dt><dd><a href="' + esc(r.website) + '" target="_blank">' + esc(r.website) + ' &#8599;</a></dd>' : "") +
    '</dl>' +
    (p ? renderMerge(r, p) : "") +
    '<div><input type="text" id="rename" value="' + esc(r.name) + '" ' +
      'placeholder="Rename before accepting"></div>' +
    '<div class="actions">' +
      '<button class="primary" data-act="accept">Accept</button>' +
      '<button class="danger" data-act="reject">Reject (not a track)</button>' +
      '<button data-act="undo">Undo last</button>' +
    '</div>' +
  '</div>';
}

function renderMerge(r, p) {
  const merging = state.mergeOff !== r.key;
  return '<div class="merge-box">' +
    '<h3>' + (merging ? "Will merge into an existing track" : "Merge declined &mdash; will be created as a new track") + '</h3>' +
    '<div><b>' + esc(p.trackName) + '</b> <span class="sub">' + esc(p.existing.location || "no location") + '</span></div>' +
    '<div class="sub">' + p.existing.runCount + ' runs &middot; ' + p.existing.eventCount + ' events &middot; ' +
      p.existing.favouriteCount + ' favourites &middot; ' +
      (p.existing.hasTimingLink ? "has a timing link" : "no timing link") + '</div>' +
    '<div class="sub" style="margin-top:6px">why: ' + p.signals.map(esc).join(", ") +
      (p.distanceM != null ? " &middot; " + p.distanceM + "m apart" : "") +
      " &middot; name overlap " + p.containment + '</div>' +
    '<div class="sub" style="margin-top:8px">' + (merging
      ? "The existing row keeps its id, runs and favourites, and gains this row's place, pin and link."
      : "A separate row will be created. Drivers may see two entries for one track.") + '</div>' +
    '<div class="actions"><button data-act="toggle-merge">' +
      (merging ? "Don't merge &mdash; keep separate" : "Merge after all") + '</button></div>' +
  '</div>';
}

// ---------------------------------------------------------------- scan
function renderScan() {
  const list = pending(scanRows());
  if (!list.length) return '<div class="done"><b>Scan queue clear.</b>Nothing left to skim.</div>';
  const start = 0;
  const page = list.slice(start, start + state.PAGE);
  state.pageKeys = page.map(r => r.key);
  if (state.cursor >= page.length) state.cursor = 0;

  const rows = page.map((r, i) => {
    const rejected = state.pageRejects && state.pageRejects.has(r.key);
    const merge = r.proposal ? '<span class="badge merge">merges into ' + esc(r.proposal.trackName) + '</span>' : "";
    const nopin = r.latitude == null ? '<span class="badge nopin">no pin</span>' : "";
    return '<tr class="' + (i === state.cursor ? "sel " : "") + (rejected ? "rejected" : "") + '" data-i="' + i + '">' +
      '<td><div class="nm">' + esc(r.name) + '</div>' + merge + nopin + '</td>' +
      '<td class="sub">' + esc(place(r)) + '</td>' +
      '<td class="sub mono">' + esc(r.lastEvent || "—") + '</td>' +
      '<td class="sub mono">' + esc((r.liveRcUrl || "").replace(/^https:\/\//, "") || "—") + '</td>' +
    '</tr>';
  }).join("");

  return '<p class="sub" style="margin:0 0 10px">Showing ' + page.length + ' of ' + list.length +
    ' clean rows. Read down the list; if nothing looks wrong, press <kbd>A</kbd> to accept the page.</p>' +
    '<table><thead><tr><th>Track</th><th>Place</th><th>Last raced</th><th>Timing link</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ---------------------------------------------------------------- wiring
function wire() {
  document.querySelectorAll("[data-act]").forEach(b => {
    b.onclick = () => act(b.dataset.act);
  });
  document.querySelectorAll("tr[data-i]").forEach(tr => {
    tr.onclick = () => { state.cursor = Number(tr.dataset.i); render(); };
  });
  const rename = document.getElementById("rename");
  if (rename) {
    rename.onfocus = () => { state.editing = true; };
    rename.onblur = () => { state.editing = false; };
  }
}

async function act(what) {
  const list = pending(focusRows());
  const r = list[0];
  if (what === "undo") {
    const keys = Object.keys(state.decisions);
    if (!keys.length) return;
    const last = keys.sort((a,b) => (state.decisions[a].at < state.decisions[b].at ? 1 : -1))[0];
    await decide(last, null);
    return render();
  }
  if (!r) return;
  if (what === "toggle-merge") {
    state.mergeOff = state.mergeOff === r.key ? null : r.key;
    return render();
  }
  if (what === "accept") {
    const input = document.getElementById("rename");
    const name = input ? input.value.trim() : r.name;
    await decide(r.key, "accept", {
      ...(name && name !== r.name ? { name } : {}),
      ...(r.proposal ? { merge: state.mergeOff !== r.key, trackId: r.proposal.trackId } : {}),
    });
    state.mergeOff = null;
    return render();
  }
  if (what === "reject") {
    await decide(r.key, "reject");
    state.mergeOff = null;
    return render();
  }
}

document.addEventListener("keydown", async (e) => {
  if (state.editing && e.key !== "Enter") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "1") { state.mode = "focus"; return render(); }
  if (e.key === "2") { state.mode = "scan"; state.cursor = 0; return render(); }
  if (e.key === "u") { e.preventDefault(); return act("undo"); }

  if (state.mode === "focus") {
    if (e.key === "Enter") { e.preventDefault(); document.activeElement.blur(); return act("accept"); }
    if (e.key === "x") { e.preventDefault(); return act("reject"); }
    if (e.key === "m") { e.preventDefault(); return act("toggle-merge"); }
    if (e.key === "e") {
      e.preventDefault();
      const input = document.getElementById("rename");
      if (input) { input.focus(); input.select(); }
      return;
    }
    return;
  }

  // scan mode
  const keys = state.pageKeys || [];
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); state.cursor = Math.min(state.cursor+1, keys.length-1); return render(); }
  if (e.key === "k" || e.key === "ArrowUp")   { e.preventDefault(); state.cursor = Math.max(state.cursor-1, 0); return render(); }
  if (e.key === "x") {
    e.preventDefault();
    state.pageRejects = state.pageRejects || new Set();
    const key = keys[state.cursor];
    if (state.pageRejects.has(key)) state.pageRejects.delete(key); else state.pageRejects.add(key);
    return render();
  }
  if (e.key === "A" || (e.key === "a" && e.shiftKey)) {
    e.preventDefault();
    const rejects = state.pageRejects || new Set();
    for (const key of keys) {
      await decide(key, rejects.has(key) ? "reject" : "accept");
    }
    state.pageRejects = new Set();
    state.cursor = 0;
    return render();
  }
});

document.getElementById("tab-focus").onclick = () => { state.mode = "focus"; render(); };
document.getElementById("tab-scan").onclick  = () => { state.mode = "scan"; state.cursor = 0; render(); };

load();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML);
  }

  if (req.url === "/api/data") {
    const data = loadData();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(data));
  }

  if (req.url === "/api/decision" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { key, decision } = JSON.parse(body);
        saveDecision(key, decision);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ decisions: readJson(DECISIONS, {}) }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  const { rows, decisions } = loadData();
  const live = rows.filter((r) => !r.foldedIntoAnother);
  const focus = live.filter((r) => r.needsFocus).length;
  console.log(`Track catalog review -> http://localhost:${PORT}`);
  console.log(`  ${live.length} rows: ${focus} need a decision, ${live.length - focus} to skim`);
  console.log(`  ${Object.keys(decisions).length} already decided (resuming)`);
});
