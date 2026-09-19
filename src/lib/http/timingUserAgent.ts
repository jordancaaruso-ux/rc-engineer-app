import { BRAND_DOMAIN } from "@/lib/brand/brandNames";

/**
 * How this app introduces itself to a timing site — LiveRC pages and the MYLAPS/Speedhive APIs.
 *
 * Three copies of this string had drifted apart: the page fetcher sent
 * `RC-Engineer/1.0 (+https://github.com) … contact app owner` (an old product name and a URL
 * that points at nothing), and the two Speedhive clients sent a bare `RC-Engineer/1.0` with no
 * contact at all. In a server log that is indistinguishable from a scraper hiding from the
 * admin, which is the wrong way to meet a platform we depend on.
 *
 * LiveRC publishes no terms of use and no API (checked 2026-09-03: a privacy policy is the only
 * legal page), so nothing here is a compliance box — the whole relationship rests on being
 * recognisable and easy to reach. The name is the one a track owner would search for, and the
 * domain's /terms and /privacy carry a real address. If someone at LiveRC or MYLAPS wants us to
 * slow down or stop, this line is how they reach us instead of quietly blocking the IP in the
 * middle of a race weekend.
 *
 * `LAP_IMPORT_USER_AGENT` overrides it, for the day a platform asks for a specific token.
 */
export function timingUserAgent(): string {
  const override = process.env.LAP_IMPORT_USER_AGENT?.trim();
  if (override) return override;
  return `JRCTrackside/1.0 (+https://www.${BRAND_DOMAIN}; lap import on a driver's request)`;
}
