import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";
import type { DebriefRecap } from "@/lib/debrief/buildDebriefRecap";
import { formatBestLap } from "@/lib/sweep/formatLap";

/**
 * "Your day at MR33" — the evening summary, rendered for a push (two short lines) and for an
 * email (the Debrief's figures, one per line). Pure: the pass supplies the recap and the links.
 * No comparison to anything, no direction, no advice — the founder's Debrief ruling (2026-09-14):
 * best lap, best top-5 average, best five-minute stint, and which run did it.
 */
export type EveningSummaryInput = {
  trackName: string;
  /** "Sat 19 Sep", in the track's zone. */
  dateLabel: string;
  recap: DebriefRecap | null;
  runCount: number;
  /** Runs the app filed that the driver has not confirmed. */
  unconfirmedCount: number;
  /**
   * Sessions imported but on no run because the car is unknown. Counted, never ASKED about here:
   * founder ruling 2026-09-16 — the notification announces the day like any other, and the app
   * asks which car in a sheet when the driver arrives. It only shapes the words on a day where
   * nothing could be filed, because then there are no figures to give.
   */
  looseCount: number;
  /** App-relative path that opens the day — and carries the sheet's flag when one is waiting. */
  openPath: string;
};

function runWord(n: number): string {
  return `${n} run${n === 1 ? "" : "s"}`;
}

function sessionWord(n: number): string {
  return `${n} session${n === 1 ? "" : "s"}`;
}

/**
 * Links in the email open the site that sent it: `NEXT_PUBLIC_APP_URL` on a deployment that is
 * not the main site (beta.jrcdynamics.com shares the database but not the pages), else www.
 */
function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return raw && /^https?:\/\//.test(raw) ? raw : `https://www.${BRAND_DOMAIN}`;
}

function absoluteUrl(path: string): string {
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The figures, one per line, in the order the Debrief card prints them. */
export function eveningSummaryLines(input: EveningSummaryInput): string[] {
  const lines: string[] = [];
  const r = input.recap;
  if (r && input.runCount > 0) {
    lines.push(`${runWord(r.runCount)} · ${r.lapCount} laps`);
    if (r.best) lines.push(`Best ${formatBestLap(r.best.seconds)} (${r.best.runLabel})`);
    if (r.top5) lines.push(`Top 5 ${formatBestLap(r.top5.seconds)} (${r.top5.runLabel})`);
    if (r.fiveMin) lines.push(`5-min ${r.fiveMin.label} (${r.fiveMin.runLabel})`);
    if (r.tyres.length > 1) {
      for (const t of r.tyres) {
        const best = t.best != null ? formatBestLap(t.best) : null;
        lines.push(`${t.name}: ${runWord(t.runCount)}${best ? ` · best ${best}` : ""}`);
      }
    }
    if (r.airTempC) {
      lines.push(
        r.airTempC.min === r.airTempC.max
          ? `Air ${Math.round(r.airTempC.min)}°C`
          : `Air ${Math.round(r.airTempC.min)}–${Math.round(r.airTempC.max)}°C`,
      );
    }
  } else if (input.runCount > 0) {
    lines.push(runWord(input.runCount));
  }
  if (input.unconfirmedCount > 0) {
    lines.push(`${runWord(input.unconfirmedCount)} filed from the timing sheet — check and confirm.`);
  }
  // Nothing could be filed (every session still needs a car): say what is waiting, since there are
  // no figures yet. On a day that DID file runs the loose ones are never mentioned — the sheet
  // asks in the app.
  if (input.runCount === 0 && input.looseCount > 0) {
    lines.push(`${sessionWord(input.looseCount)} from today are ready`);
  }
  return lines;
}

/** Push: a title and one body line. */
export function renderEveningSummaryPush(input: EveningSummaryInput): {
  title: string;
  body: string;
  url: string;
} {
  const title = `Your day at ${input.trackName}`;
  if (input.runCount === 0 && input.looseCount > 0) {
    return { title, body: `${sessionWord(input.looseCount)} from today are ready`, url: input.openPath };
  }
  const r = input.recap;
  const parts: string[] = [runWord(input.runCount)];
  if (r?.best) parts.push(`best ${formatBestLap(r.best.seconds)} (${r.best.runLabel})`);
  if (r?.top5) parts.push(`top 5 ${formatBestLap(r.top5.seconds)}`);
  if (input.unconfirmedCount > 0) parts.push(`${input.unconfirmedCount} to confirm`);
  return { title, body: parts.join(" · "), url: input.openPath };
}

/** Email: subject, plain text, and the same dark table layout as the sign-in email. */
export function renderEveningSummaryEmail(input: EveningSummaryInput): {
  subject: string;
  text: string;
  html: string;
} {
  const lines = eveningSummaryLines(input);
  const best = input.recap?.best ? formatBestLap(input.recap.best.seconds) : null;
  const subject =
    input.runCount > 0
      ? `${input.trackName}, ${input.dateLabel}: ${runWord(input.runCount)}${best ? `, best ${best}` : ""}`
      : `${input.trackName}, ${input.dateLabel}: ${sessionWord(input.looseCount)} ready`;

  const openUrl = absoluteUrl(input.openPath);

  const text = [
    PRODUCT_NAME,
    "",
    `Your day at ${input.trackName} — ${input.dateLabel}`,
    "",
    ...lines,
    "",
    `Open your day: ${openUrl}`,
    "",
    `${PRODUCT_NAME} · ${BRAND_DOMAIN}`,
  ].join("\n");

  const lineRows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #2B2A27;font-size:15px;line-height:1.5;color:#D9D4CA;">${escapeHtml(l)}</td></tr>`,
    )
    .join("\n");
  const button = (href: string, label: string, primary: boolean) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;${primary ? "background:#FFD60A;" : "border:1px solid #3A3833;"}text-align:center;">
            <a href="${href}" style="display:block;padding:13px 24px;font-size:14px;font-weight:600;color:${primary ? "#121110" : "#D9D4CA"};text-decoration:none;">${escapeHtml(label)}</a>
          </td>
        </tr></table>`;

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#121110;">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:0 4px 32px;">
        <img src="https://www.${BRAND_DOMAIN}/brand/jrc-mark-yellow-3x.png" width="91" height="30" alt="${PRODUCT_NAME}" style="display:block;height:30px;width:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:0 4px 6px;">
        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#7D786E;">${escapeHtml(input.dateLabel)}</p>
      </td></tr>
      <tr><td style="padding:0 4px 18px;">
        <p style="margin:0;font-size:22px;font-weight:700;line-height:1.3;color:#F2EFE8;">Your day at ${escapeHtml(input.trackName)}</p>
      </td></tr>
      <tr><td style="padding:0 4px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${lineRows}
        </table>
      </td></tr>
      <tr><td style="padding:0 4px 12px;">
        ${button(openUrl, "Open your day", true)}
      </td></tr>
      <tr><td style="padding:0 4px 18px;"></td></tr>
      <tr><td style="padding:14px 4px 0;border-top:1px solid #2B2A27;">
        <p style="margin:0;font-size:11.5px;line-height:1.7;color:#7D786E;">Sent because your transponder or name was on the timing sheet today.<br>${PRODUCT_NAME} &middot; ${BRAND_DOMAIN}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject, text, html };
}
