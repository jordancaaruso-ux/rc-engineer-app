/**
 * Look at every candidate track from above and say whether the pin is on a track.
 *
 * The text review (review-server.mjs) can confirm a NAME. It cannot confirm a LOCATION — a row
 * reading "Horntye Park, Bohemia Road" tells you nothing, and neither does a street map, which
 * draws a green blob either way. An RC track from the air is unmistakable, so this tool shows
 * satellite imagery and nothing else.
 *
 * Reads seeds/track-catalog/overture-match.json — each track's own geocoded pin cross-checked
 * against Overture's business listing. The verdict decides what you get shown:
 *
 *   one pin   — both sources agree, or only one of them has an opinion. Confirm the shape.
 *   two pins  — they disagree by more than 2km and both look plausible. Often that is not an
 *               error at all: a club with an indoor track in town and an outdoor one out of it,
 *               or a hobby shop whose track is down the road. So "both are real" is an answer.
 *
 * Every keystroke lands in decisions immediately; stopping halfway costs nothing.
 *
 *   node scripts/track-catalog/map-review-server.mjs
 *   -> http://localhost:5178
 */
import fs from "node:fs";
import http from "node:http";

const DIR = "seeds/track-catalog";
const MATCH = `${DIR}/overture-match.json`;
const DECISIONS = `${DIR}/map-decisions.json`;
const PORT = Number(process.argv[2] ?? 5178);

const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};

/**
 * Piles, in the order they are worth your time.
 *
 * "Does this business look like my track?" is a NAME question and answers in a second from the
 * text alone. A photo only settles the rarer question of which of two candidate spots has a
 * track on it — and only outdoors, since a quarter of these race on carpet inside a unit and
 * look like a warehouse roof from above. So names lead and pictures assist, not the reverse.
 */
const PILES = [
  { id: "name", label: "Is this your track?", verdicts: ["name-candidate"], mode: "name" },
  { id: "two", label: "Two places?", verdicts: ["maybe-two-places"], mode: "two" },
  { id: "filled", label: "Found a missing pin", verdicts: ["filled"], mode: "name" },
  { id: "confirmed", label: "Already agreed", verdicts: ["confirmed", "near"], mode: "one" },
  { id: "none", label: "Nothing found", verdicts: ["unverified", "still-missing"], mode: "one" },
];

function load() {
  const rows = readJson(MATCH, []);
  return { rows, decisions: readJson(DECISIONS, {}) };
}

function saveDecision(key, decision) {
  const decisions = readJson(DECISIONS, {});
  if (decision === null) delete decisions[key];
  else decisions[key] = { ...decision, at: new Date().toISOString() };
  fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 1));
  return decisions;
}

const PAGE = String.raw`<!doctype html>
<meta charset="utf-8"><title>Is this your track? — track catalog review</title>
<style>
  :root { --bg:#12140f; --card:#1c1f18; --line:#2f3428; --ink:#e9ead9; --dim:#8f9480;
          --yes:#8fbf5a; --no:#d2544a; --both:#e2b23c; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif }
  header { position:sticky; top:0; z-index:9; background:#12140fee; backdrop-filter:blur(6px);
           border-bottom:1px solid var(--line); padding:10px 16px }
  .row { display:flex; align-items:center; gap:14px; flex-wrap:wrap }
  h1 { font-size:15px; margin:0; font-weight:600 }
  .tabs button { background:none; border:1px solid var(--line); color:var(--dim);
                 padding:4px 10px; border-radius:99px; cursor:pointer; font:inherit; margin-right:6px }
  .tabs button.on { color:var(--ink); border-color:var(--yes); background:#8fbf5a1a }
  .keys { color:var(--dim); font-size:12px; margin-top:6px }
  kbd { background:#000; border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:11px }
  #bar { height:3px; background:var(--yes); width:0; transition:width .2s; margin-top:8px }
  main { padding:16px; display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)) }
  main.wide { grid-template-columns:repeat(auto-fill,minmax(700px,1fr)) }
  main.list { grid-template-columns:1fr; max-width:1000px; margin:0 auto; gap:10px }
  .card.pairrow { display:flex; align-items:stretch }
  .card.pairrow .thumb { width:230px; flex:none }
  .card.pairrow .thumb .map { height:100%; min-height:132px }
  .card.pairrow .pair { padding:12px 14px; flex:1; min-width:0 }
  .q { font-size:15px; margin-bottom:2px }
  .q b { font-weight:600 }
  .q .lbl { display:inline-block; min-width:78px; color:var(--dim); font-size:11px;
            text-transform:uppercase; letter-spacing:.06em }
  .q.found b { color:var(--yes) }
  .card.pairrow .acts { padding:10px 0 0; max-width:340px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden }
  .card.sel { outline:2px solid var(--yes); outline-offset:2px }
  .card.done { opacity:.35 }
  .maps { display:flex; gap:2px; background:#000 }
  .map { position:relative; flex:1; height:300px; overflow:hidden; background:#000; cursor:zoom-in }
  .map img { position:absolute; width:256px; height:256px; image-rendering:auto }
  .cross { position:absolute; left:50%; top:50%; width:38px; height:38px; margin:-19px 0 0 -19px;
           border:2px solid #fff; border-radius:50%; box-shadow:0 0 0 2px #0008, inset 0 0 0 2px #0008;
           pointer-events:none }
  .cross::after { content:""; position:absolute; inset:16px; background:#fff; border-radius:50%;
                  box-shadow:0 0 0 1px #0008 }
  .tag { position:absolute; left:6px; top:6px; background:#000c; padding:2px 7px; border-radius:5px;
         font-size:11px; letter-spacing:.02em }
  .meta { padding:10px 12px }
  .nm { font-weight:600 }
  .sub { color:var(--dim); font-size:12px; margin-top:2px }
  .acts { display:flex; gap:6px; padding:0 12px 12px; flex-wrap:wrap }
  .acts button { flex:1; min-width:80px; background:#0000; border:1px solid var(--line);
                 color:var(--ink); border-radius:7px; padding:7px 8px; cursor:pointer; font:inherit; font-size:13px }
  .acts button:hover { border-color:var(--dim) }
  .acts .y { border-color:var(--yes); color:var(--yes) }
  .acts .n { border-color:var(--no); color:var(--no) }
  .acts .b { border-color:var(--both); color:var(--both) }
  .verdict { display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px;
             border:1px solid var(--line); color:var(--dim); margin-left:6px }
  .done-msg { padding:40px; color:var(--dim); grid-column:1/-1; text-align:center }
  #big { position:fixed; inset:0; background:#000e; z-index:20; display:none }
  #big .map { height:100vh; cursor:zoom-out }
  #big .hint { position:absolute; bottom:14px; left:50%; transform:translateX(-50%);
               background:#000c; padding:6px 12px; border-radius:8px; font-size:12px; color:var(--dim) }
  footer { padding:10px 16px 30px; color:var(--dim); font-size:11px }
</style>
<header>
  <div class="row">
    <h1>Is this your track?</h1>
    <span class="tabs" id="tabs"></span>
    <span style="margin-left:auto" class="sub"><b id="n-done">0</b> decided ·
      <b id="n-left">0</b> left in this pile · zoom <b id="z">15</b></span>
  </div>
  <div class="keys">
    <kbd>j</kbd>/<kbd>k</kbd> move &nbsp; <kbd>Enter</kbd> yes / pin is right &nbsp; <kbd>x</kbd> no / wrong
    &nbsp; <kbd>b</kbd> both real — two places &nbsp; <kbd>u</kbd> undo &nbsp;
    <kbd>+</kbd>/<kbd>-</kbd> zoom &nbsp; <kbd>click a photo</kbd> full screen
  </div>
  <div id="bar"></div>
</header>
<main id="app"></main>
<div id="big"><div class="map" id="bigmap"><div class="cross"></div></div>
  <div class="hint">click anywhere to close · <kbd>+</kbd>/<kbd>-</kbd> to zoom</div></div>
<footer>Imagery © Esri, Maxar, Earthstar Geographics. Places © Overture Maps Foundation (CDLA Permissive 2.0).</footer>
<script>
const PILES = __PILES__;
const state = { rows:[], decisions:{}, pile:"name", cursor:0, zoom:15, bigZoom:17, big:null };

const TILE = (z,x,y) =>
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"+z+"/"+y+"/"+x;

/* Web Mercator, so a pin can sit dead centre of the box rather than wherever the tile grid
   happens to put it. Without this the crosshair drifts by up to a whole tile. */
function project(lat, lon, z) {
  const world = 256 * Math.pow(2, z);
  const x = (lon + 180) / 360 * world;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  return { x, y, world };
}

/* Half a tile of slack, no more. The box is measured after layout rather than guessed, so a wide
   safety ring would just be thousands of tiles fetched to be cropped away. */
const PAD = 128;

function tilesFor(lat, lon, z, w, h) {
  const { x, y } = project(lat, lon, z);
  const left = x - w / 2, top = y - h / 2;
  const out = [];
  for (let tx = Math.floor((left - PAD) / 256); tx <= Math.floor((left + w + PAD) / 256); tx++) {
    for (let ty = Math.floor((top - PAD) / 256); ty <= Math.floor((top + h + PAD) / 256); ty++) {
      const n = Math.pow(2, z);
      if (ty < 0 || ty >= n) continue;
      out.push({ url: TILE(z, ((tx % n) + n) % n, ty), l: tx * 256 - left, t: ty * 256 - top });
    }
  }
  return out;
}

/* Emitted empty, filled by paintMaps() once the browser has decided how wide the card is. */
function mapHtml(lat, lon, label) {
  if (lat == null) return '<div class="map"><div class="tag">no location</div></div>';
  return '<div class="map" data-lat="' + lat + '" data-lon="' + lon + '">' +
         '<div class="cross"></div>' + (label ? '<div class="tag">' + label + '</div>' : "") + '</div>';
}

function paintMaps() {
  for (const el of document.querySelectorAll(".map[data-lat]")) {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) continue;
    if (el.dataset.painted === state.zoom + "x" + w) continue;
    el.dataset.painted = state.zoom + "x" + w;
    for (const old of el.querySelectorAll("img")) old.remove();
    const frag = document.createDocumentFragment();
    for (const t of tilesFor(+el.dataset.lat, +el.dataset.lon, state.zoom, w, h)) {
      const img = document.createElement("img");
      img.loading = "lazy"; img.src = t.url;
      img.style.left = t.l + "px"; img.style.top = t.t + "px";
      frag.appendChild(img);
    }
    el.prepend(frag);
  }
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const pile = () => PILES.find(p => p.id === state.pile);
const inPile = () => state.rows.filter(r => pile().verdicts.includes(r.verdict))
  .sort((a,b) => ((b.match && b.match.score) || 0) - ((a.match && a.match.score) || 0));
const pending = list => list.filter(r => !state.decisions[r.key]);

function render() {
  const tabs = PILES.map(p => {
    const n = pending(state.rows.filter(r => p.verdicts.includes(r.verdict))).length;
    return '<button data-pile="' + p.id + '" class="' + (p.id === state.pile ? "on" : "") + '">' +
           p.label + " (" + n + ")</button>";
  }).join("");
  document.getElementById("tabs").innerHTML = tabs;
  document.getElementById("z").textContent = state.zoom;

  const all = inPile(), left = pending(all);
  document.getElementById("n-left").textContent = left.length;
  document.getElementById("n-done").textContent = Object.keys(state.decisions).length;
  document.getElementById("bar").style.width =
    (all.length ? ((all.length - left.length) / all.length * 100) : 0) + "%";

  const app = document.getElementById("app");
  const mode = pile().mode;
  app.className = mode === "two" ? "wide" : mode === "name" ? "list" : "";
  if (!left.length) {
    app.innerHTML = '<div class="done-msg"><b>Nothing left in this pile.</b><br>Pick another above.</div>';
    return;
  }
  state.cursor = Math.max(0, Math.min(state.cursor, left.length - 1));
  app.innerHTML = left.slice(0, 60).map((r, i) => {
    const away = r.match && r.match.d != null ? " · " + (r.match.d > 1500
      ? (r.match.d / 1000).toFixed(1) + " km away" : r.match.d + " m away") : "";
    const sel = i === state.cursor ? " sel" : "";
    const head = '<div class="sub">' +
      esc([r.city, (r.country || "").toUpperCase()].filter(Boolean).join(", ")) +
      " · " + r.events + " events</div>";

    /* The name question: two names side by side, and does the second one make sense as the first.
       The picture is along for the ride — useful when it happens to be outdoors, ignorable when not. */
    if (mode === "name") {
      const m = r.match || {};
      return '<div class="card pairrow' + sel + '" data-key="' + esc(r.key) + '">' +
        '<div class="thumb">' + mapHtml(m.lat, m.lon, null) + '</div>' +
        '<div class="pair">' +
          '<div class="q"><span class="lbl">your track</span> <b>' + esc(r.name) + '</b></div>' + head +
          '<div class="q found"><span class="lbl">on the map</span> <b>' + esc(m.nm) + '</b>' +
            '<span class="verdict">' + esc(m.cat || "no category") + '</span></div>' +
          '<div class="sub">' + esc(m.where || "") + away + '</div>' +
          '<div class="acts"><button class="y" data-a="yes">Yes — that’s it</button>' +
            '<button class="n" data-a="no">No</button></div>' +
        '</div></div>';
    }

    if (mode === "two") {
      return '<div class="card' + sel + '" data-key="' + esc(r.key) + '">' +
        '<div class="maps">' + mapHtml(r.lat, r.lon, "its own address") +
          mapHtml(r.match && r.match.lat, r.match && r.match.lon, "the business listing") + '</div>' +
        '<div class="meta"><div class="nm">' + esc(r.name) + '</div>' + head +
          '<div class="sub">listed as “' + esc(r.match.nm) + '” [' + esc(r.match.cat) + ']' + away + '</div>' +
        '</div><div class="acts">' +
          '<button class="y" data-a="address">Address one is the track</button>' +
          '<button class="y" data-a="listing">The other one is</button>' +
          '<button class="b" data-a="split">Both real — two places</button>' +
          '<button class="n" data-a="neither">Neither</button></div></div>';
    }

    return '<div class="card' + sel + '" data-key="' + esc(r.key) + '">' +
      '<div class="maps">' + mapHtml(r.lat != null ? r.lat : (r.match && r.match.lat),
        r.lat != null ? r.lon : (r.match && r.match.lon), null) + '</div>' +
      '<div class="meta"><div class="nm">' + esc(r.name) +
        '<span class="verdict">' + esc(r.verdict) + '</span></div>' + head +
        (r.match ? '<div class="sub">listed as “' + esc(r.match.nm) + '”' + away + '</div>' : "") +
      '</div><div class="acts">' +
        '<button class="y" data-a="good">Pin is right</button>' +
        '<button class="n" data-a="bad">Not a track here</button></div></div>';
  }).join("");

  paintMaps();
  const sel = document.querySelector(".card.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

async function decide(key, choice) {
  const body = choice === null ? { key, decision: null } : { key, decision: { choice } };
  const res = await fetch("/api/decision", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  state.decisions = (await res.json()).decisions;
  render();
}

function current() { return pending(inPile())[state.cursor]; }

document.addEventListener("click", async (e) => {
  const bigEl = document.getElementById("big");
  if (bigEl.style.display === "block") { bigEl.style.display = "none"; state.big = null; return; }
  const tab = e.target.closest("[data-pile]");
  if (tab) { state.pile = tab.dataset.pile; state.cursor = 0; return render(); }
  const map = e.target.closest(".map");
  if (map && map.dataset.lat) {
    state.big = { lat: +map.dataset.lat, lon: +map.dataset.lon };
    return openBig();
  }
  const act = e.target.closest("[data-a]");
  if (act) {
    const card = act.closest(".card");
    return decide(card.dataset.key, act.dataset.a);
  }
});

function openBig() {
  if (!state.big) return;
  const el = document.getElementById("bigmap");
  el.innerHTML = tilesFor(state.big.lat, state.big.lon, state.bigZoom, innerWidth, innerHeight)
    .map(t => '<img src="' + t.url + '" style="left:' + t.l + 'px;top:' + t.t + 'px">').join("") +
    '<div class="cross"></div>';
  document.getElementById("big").style.display = "block";
}

document.addEventListener("keydown", async (e) => {
  if (state.big) {
    if (e.key === "+" || e.key === "=") { state.bigZoom = Math.min(19, state.bigZoom + 1); return openBig(); }
    if (e.key === "-") { state.bigZoom = Math.max(10, state.bigZoom - 1); return openBig(); }
    if (e.key === "Escape") { document.getElementById("big").style.display = "none"; state.big = null; }
    return;
  }
  const list = pending(inPile());
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); state.cursor = Math.min(state.cursor + 1, list.length - 1); return render(); }
  if (e.key === "k" || e.key === "ArrowUp")   { e.preventDefault(); state.cursor = Math.max(state.cursor - 1, 0); return render(); }
  if (e.key === "+" || e.key === "=") { state.zoom = Math.min(19, state.zoom + 1); return render(); }
  if (e.key === "-") { state.zoom = Math.max(10, state.zoom - 1); return render(); }
  const r = current();
  if (!r) return;
  const two = pile().mode === "two";
  if (e.key === "Enter") { e.preventDefault(); return decide(r.key, two ? "address" : pile().mode === "name" ? "yes" : "good"); }
  if (e.key === "x") { e.preventDefault(); return decide(r.key, two ? "neither" : pile().mode === "name" ? "no" : "bad"); }
  if (e.key === "b" && two) { e.preventDefault(); return decide(r.key, "split"); }
  if (e.key === "l" && two) { e.preventDefault(); return decide(r.key, "listing"); }
  if (e.key === "u") {
    e.preventDefault();
    const keys = Object.entries(state.decisions).sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
    if (keys.length) return decide(keys[0][0], null);
  }
});

(async () => {
  const d = await (await fetch("/api/data")).json();
  state.rows = d.rows; state.decisions = d.decisions;
  render();
})();
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/?")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PAGE.replace("__PILES__", JSON.stringify(PILES)));
  }
  if (req.url === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(load()));
  }
  if (req.url === "/api/decision" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      try {
        const { key, decision } = JSON.parse(body);
        const decisions = saveDecision(key, decision);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ decisions }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  const { rows, decisions } = load();
  const tally = {};
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  console.log(`\n  Is this your track?   http://localhost:${PORT}\n`);
  console.log(`  ${rows.length} tracks, ${Object.keys(decisions).length} already decided`);
  for (const p of PILES) {
    const n = p.verdicts.reduce((s, v) => s + (tally[v] ?? 0), 0);
    console.log(`    ${p.label.padEnd(22)} ${String(n).padStart(4)}`);
  }
  console.log("");
});
