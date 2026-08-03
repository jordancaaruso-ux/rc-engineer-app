/**
 * Shared identity strings for the public legal pages (/privacy, /terms).
 *
 * Edit here, not in the pages. If a support address ever replaces the personal one, this is the
 * single line to change.
 */

import { COMPANY_NAME } from "@/lib/brand/brandNames";

/**
 * The operating ENTITY, not the product. A product name (and never one with "App" in it)
 * must not appear here — this string is what /privacy and /terms name as the party you are
 * contracting with, so it has to survive any rebrand of the app itself.
 */
export const LEGAL_OPERATOR = `Jordan Caruso (${COMPANY_NAME})`;

export const LEGAL_CONTACT_EMAIL = "jordancaaruso@gmail.com";

/** Bump whenever the wording of /privacy or /terms materially changes. */
export const LEGAL_LAST_UPDATED = "July 2026";
