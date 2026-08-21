/**
 * MyRCM (myrcm.ch) address shapes — the v9 site, plus the legacy shapes drivers still have saved.
 *
 * Split out of `myRcmReport.ts` so the client can use it: that module pulls in cheerio for the HTML
 * reading, which has no business in a browser bundle. Anything here is pure string work.
 *
 * Both shapes are recognised and everything is emitted in the v9 one. MyRCM does redirect legacy
 * addresses, but **the redirect drops the query string** — so a saved single-run link followed
 * blindly lands on the class page with no `reportKey`. Recognising the old shape here is what keeps
 * a driver's bookmarked session importable.
 */

export type MyRcmReportRef = {
  lang: string;
  eventId: string;
  /** null for an event URL (MyRCM then renders the event's first class). */
  categoryId: string | null;
  /** null for an event/class URL; set for a single run. */
  reportKey: string | null;
  /** MyRCM's own report flavour ("qualy", "final", "participants", …). Preserved when rebuilding URLs. */
  reportType: string | null;
};

function stripHash(s: string): string {
  const h = s.indexOf("#");
  return h >= 0 ? s.slice(0, h) : s;
}

export function isMyRcmHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "myrcm.ch" || h.endsWith(".myrcm.ch");
}

/**
 * Accepts both address shapes and always returns v9 ids.
 *  - v9:     `https://www.myrcm.ch/en/report/97370[/388960][?reportKey=4709&reportType=qualy]`
 *  - legacy: `https://www.myrcm.ch/myrcm/report/en/97370/388960[?reportKey=4709]`
 */
export function parseMyRcmReportUrl(urlStr: string): MyRcmReportRef | null {
  let u: URL;
  try {
    u = new URL(stripHash(urlStr.trim()));
  } catch {
    return null;
  }
  if (!isMyRcmHostname(u.hostname)) return null;

  let lang: string;
  let eventId: string;
  let categoryId: string | null;

  const v9 = u.pathname.match(/^\/([a-z]{2})\/report\/(\d+)(?:\/(\d+))?\/?$/i);
  const legacy = u.pathname.match(/^\/myrcm\/report\/([a-z]{2})\/(\d+)\/(\d+)\/?$/i);
  if (v9) {
    lang = v9[1]!.toLowerCase();
    eventId = v9[2]!;
    categoryId = v9[3] ?? null;
  } else if (legacy) {
    lang = legacy[1]!.toLowerCase();
    eventId = legacy[2]!;
    categoryId = legacy[3]!;
  } else {
    return null;
  }

  const reportKeyRaw = u.searchParams.get("reportKey");
  const reportKey = reportKeyRaw && /^\d+$/.test(reportKeyRaw.trim()) ? reportKeyRaw.trim() : null;
  const reportTypeRaw = u.searchParams.get("reportType");
  const reportType =
    reportTypeRaw && /^[a-z]+$/i.test(reportTypeRaw.trim()) ? reportTypeRaw.trim().toLowerCase() : null;

  return { lang, eventId, categoryId, reportKey, reportType };
}

/** Any MyRCM report URL (event, class or single run). */
export function isMyRcmReportUrl(urlStr: string): boolean {
  return parseMyRcmReportUrl(urlStr) !== null;
}

/** A single-run report URL (has a `reportKey`). */
export function isMyRcmSessionUrl(urlStr: string): boolean {
  const ref = parseMyRcmReportUrl(urlStr);
  return ref !== null && ref.reportKey !== null;
}

/** A class URL — an explicit category, no `reportKey`. */
export function isMyRcmCategoryUrl(urlStr: string): boolean {
  const ref = parseMyRcmReportUrl(urlStr);
  return ref !== null && ref.categoryId !== null && ref.reportKey === null;
}

/**
 * An event URL — no category. v9 `/en/report/<eventId>`, or the legacy landing page
 * (`/myrcm/main?…dId[E]=<id>`) that drivers still have bookmarked.
 *
 * Unlike the old site this is not a dead end: MyRCM renders the event's first class here, so it
 * enumerates exactly like a class page.
 */
export function isMyRcmEventUrl(urlStr: string): boolean {
  const ref = parseMyRcmReportUrl(urlStr);
  if (ref) return ref.categoryId === null && ref.reportKey === null;
  return legacyMyRcmEventIdFromUrl(urlStr) !== null;
}

/** The legacy landing page carries its event id in `dId[E]`; v9 has no equivalent page. */
export function legacyMyRcmEventIdFromUrl(urlStr: string): string | null {
  let u: URL;
  try {
    u = new URL(stripHash(urlStr.trim()));
  } catch {
    return null;
  }
  if (!isMyRcmHostname(u.hostname)) return null;
  if (!/^\/myrcm\/main\/?$/i.test(u.pathname)) return null;
  const raw = u.searchParams.get("dId[E]");
  return raw && /^\d+$/.test(raw.trim()) ? raw.trim() : null;
}

export function buildMyRcmSessionUrl(
  ref: MyRcmReportRef,
  reportKey: string,
  reportType?: string | null
): string {
  const type = (reportType ?? ref.reportType)?.trim();
  const base = `https://www.myrcm.ch/${ref.lang}/report/${ref.eventId}${
    ref.categoryId ? `/${ref.categoryId}` : ""
  }`;
  return `${base}?reportKey=${reportKey}${type ? `&reportType=${type}` : ""}`;
}

export function buildMyRcmCategoryUrl(eventId: string, categoryId: string, lang = "en"): string {
  return `https://www.myrcm.ch/${lang}/report/${eventId}/${categoryId}`;
}

export function buildMyRcmEventUrl(eventId: string, lang = "en"): string {
  return `https://www.myrcm.ch/${lang}/report/${eventId}`;
}

/**
 * Event or class URL — a page we can enumerate runs from (vs a single `reportKey` run).
 * This is the predicate the paste boxes use to decide "scan this" rather than "import this".
 */
export function isMyRcmDiscoveryUrl(urlStr: string): boolean {
  return isMyRcmCategoryUrl(urlStr) || isMyRcmEventUrl(urlStr);
}
