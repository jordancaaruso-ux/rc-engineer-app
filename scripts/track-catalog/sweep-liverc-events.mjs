// Sweep 2 of 2: each LiveRC track's /events/ page -> its event archive.
// `lastEvent` from this file is the activity signal the catalog filters on (event count is not:
// it measures whether a club posts its club nights to LiveRC, which is a habit, not a pulse).
// Re-running costs ~1,126 requests against LiveRC. The committed output is the provenance record;
// only re-run when refreshing the catalog. Usage: node scripts/track-catalog/sweep-liverc-events.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] ?? 'seeds/track-catalog/raw';
const subs = fs.readFileSync(path.join(DIR, 'liverc-subdomains.txt'), 'utf8')
  .split('\n').map(s => s.trim().replace(/^\/\//, '')).filter(Boolean);

const OUT = path.join(DIR, 'liverc-events.jsonl');
fs.writeFileSync(OUT, '');
const UA = 'Trackside/1.0 (RC race-engineering app; one-off event archive sweep; contact: jordancaaruso@gmail.com)';

function dec(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
          .replace(/&nbsp;/g, ' ');
}

// Rows look like:  <td>Event Name</td> ... <td><span>2026-07-26 00:00:00</span>Jul 26, 2026</td>
function parseEvents(html) {
  const events = [];
  const re = /<a[^>]+href="[^"]*\/results\/\?p=[^"]*"[^>]*>([^<]{3,120})<\/a>([\s\S]{0,600}?)(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = dec(m[1]).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    events.push({ name, date: m[3] });
  }
  // dedupe by name+date
  const seen = new Set();
  return events.filter(e => {
    const k = e.name + '|' + e.date;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

let done = 0, ok = 0, fail = 0, idx = 0;
const CONCURRENCY = 5;

async function fetchOne(host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(`https://${host}/events/`, {
      redirect: 'follow', signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return { host, error: `HTTP ${res.status}` };
    const html = await res.text();
    const events = parseEvents(html);
    const dates = events.map(e => e.date).filter(Boolean).sort();
    return {
      host,
      eventCount: events.length,
      firstEvent: dates[0] || null,
      lastEvent: dates[dates.length - 1] || null,
      events: events.map(e => `${e.date}|${e.name}`),
    };
  } catch (e) {
    return { host, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally { clearTimeout(t); }
}

async function worker() {
  while (idx < subs.length) {
    const host = subs[idx++];
    const row = await fetchOne(host);
    if (row.error) fail++; else ok++;
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    done++;
    if (done % 100 === 0) console.log(`${done}/${subs.length} ok=${ok} fail=${fail}`);
    await new Promise(r => setTimeout(r, 150));
  }
}

console.log(`event sweep: ${subs.length} hosts`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`DONE ${done} ok=${ok} fail=${fail} -> ${OUT}`);
