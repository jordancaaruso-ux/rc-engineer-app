// Sweep 1 of 2: each LiveRC track subdomain's home page -> the <address> block the track publishes
// about itself (name, street, city, region, country, club website). That block is the track's own
// contact details, and the subdomain IS the durable timing link, so this source carries identity
// and timing together. Re-running costs ~1,126 requests against LiveRC; the committed output is the
// provenance record. Usage: node scripts/track-catalog/sweep-liverc.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] ?? 'seeds/track-catalog/raw';
const subs = fs.readFileSync(path.join(DIR, 'liverc-subdomains.txt'), 'utf8')
  .split('\n').map(s => s.trim().replace(/^\/\//, '')).filter(Boolean);

const OUT = path.join(DIR, 'liverc-tracks.jsonl');
fs.writeFileSync(OUT, '');

const UA = 'Trackside/1.0 (RC race-engineering app; one-off track directory sweep; contact: jordancaaruso@gmail.com)';

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
          .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function parse(html, host) {
  const titleM = html.match(/<title>([^<]*)/i);
  const title = titleM ? decodeEntities(titleM[1]).split('::')[0].trim() : null;

  const addrM = html.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
  let name = null, lines = [], website = null;
  if (addrM) {
    const block = addrM[1];
    const wM = block.match(/<abbr[^>]*title="Website"[^>]*>[\s\S]{0,40}?<a[^>]+href="([^"]+)"/i);
    if (wM && !/^javascript:/i.test(wM[1])) website = wM[1].trim();
    const nM = block.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (nM) name = decodeEntities(nM[1].replace(/<[^>]*>/g, '')).trim();
    // address lines = everything before the first <abbr> (P:/W:/E: rows)
    const beforeAbbr = block.split(/<abbr/i)[0];
    lines = beforeAbbr
      .replace(/<strong>[\s\S]*?<\/strong>/i, '')
      .split(/<br\s*\/?>/i)
      .map(l => decodeEntities(l.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }
  return { host, name: name || title, title, addressLines: lines, website };
}

let done = 0, ok = 0, fail = 0;
const CONCURRENCY = 5;
let idx = 0;

async function fetchOne(host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(`https://${host}/`, {
      redirect: 'follow', signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return { host, error: `HTTP ${res.status}` };
    const html = await res.text();
    return parse(html, host);
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

console.log(`sweeping ${subs.length} hosts, concurrency ${CONCURRENCY}`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`DONE ${done} ok=${ok} fail=${fail} -> ${OUT}`);
