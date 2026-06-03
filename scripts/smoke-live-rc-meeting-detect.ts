/**
 * Smoke: fetch a LiveRC track dashboard and print parse + today guard.
 * Run: npx tsx scripts/smoke-live-rc-meeting-detect.ts [trackOrigin]
 */
import { parseLiveRcDashboardHtml } from "@/lib/lapWatch/liveRcIndexHtmlParse";

async function main() {
  const origin = (process.argv[2] ?? "https://tftr.liverc.com/").replace(/\/?$/, "/");

  const res = await fetch(origin, {
    headers: { "User-Agent": "rc-engineer-app-smoke/1.0" },
  });
  const html = await res.text();
  const parsed = parseLiveRcDashboardHtml(html, origin);
  const detected = Boolean(parsed.currentEventHubUrl);

  console.log(
    JSON.stringify({ ok: res.ok, status: res.status, origin, parsed, detected }, null, 2)
  );
}

void main();
