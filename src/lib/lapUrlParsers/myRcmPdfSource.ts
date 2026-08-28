/**
 * The small, client-safe facts about MyRCM PDF imports.
 *
 * Split out of `myRcmPdf.ts` so the log-run form can label a PDF-sourced session and recognise a
 * pasted MyRCM link without pulling the whole parser into the browser bundle.
 */

export const MYRCM_PDF_PARSER_ID = "myrcm-pdf";

/**
 * `ImportedLapTimeSession.sourceUrl` is required and a PDF import has no URL, so it stores
 * `myrcm-pdf://<sha256-16>/<filename>` — a scheme nothing will ever try to fetch, carrying the
 * file's fingerprint (the re-upload dedupe key) and the name the driver will recognise.
 */
export const MYRCM_PDF_SOURCE_PREFIX = "myrcm-pdf://";

export function isMyRcmPdfSourceUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.trim().startsWith(MYRCM_PDF_SOURCE_PREFIX);
}

/** The filename out of a synthetic source URL, or `null` for any other URL. */
export function myRcmPdfSourceFileName(url: string | null | undefined): string | null {
  if (!isMyRcmPdfSourceUrl(url)) return null;
  const rest = url!.trim().slice(MYRCM_PDF_SOURCE_PREFIX.length);
  const slash = rest.indexOf("/");
  const name = slash >= 0 ? rest.slice(slash + 1) : "";
  return name || "report.pdf";
}

/** Where "Open MyRCM" goes when the event has no MyRCM page saved. */
export const MYRCM_HOME_URL = "https://www.myrcm.ch/";

/**
 * True for anything on `myrcm.ch`. The app can never fetch such a URL (it is on the timing
 * denylist), so a paste of one is answered with the PDF door rather than sent to the importer.
 */
export function isMyRcmHostUrl(raw: string | null | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return host === "myrcm.ch" || host.endsWith(".myrcm.ch");
  } catch {
    return false;
  }
}
