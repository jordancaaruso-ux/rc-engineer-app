import { createHash } from "node:crypto";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * The identity of a sheet STYLE, so two drivers holding the same manufacturer's sheet land on one
 * shared row instead of minting a row each.
 *
 * ============================ WHY IT HASHES THE OUTPUT ============================
 *
 * It hashes what `deriveSchemaFromAcroForm` PRODUCED — the parameter keys in order, and where each
 * one reads from — not the file, and not the field names it started from.
 *
 * That choice is the whole safety argument. A shared row is only sound if every sheet on it agrees
 * about what each key means; agreeing about the file they came from is neither necessary nor
 * sufficient. Hashing the derivation makes the guarantee exact: **equal fingerprints mean the two
 * derivations are interchangeable for every downstream purpose**, because the keys, their order and
 * their sources are identical. Anything at all that perturbs the derivation — a manufacturer
 * revising the sheet, a driver re-saving it through an editor that reorders the form, a change to
 * the derive pass itself — changes the hash and mints a fresh row.
 *
 * So the worst case is a duplicate row, never a corrupted one. That asymmetry is deliberate: a
 * spare row costs an admin one merge, whereas two disagreeing sheets sharing a row would silently
 * scramble saved setups, and `SetupSnapshot.data` is keyed by these keys forever.
 *
 * Measured on the real fixtures 2026-08-10: Mugen's own blank (79 boxes carrying kit defaults) and
 * Sören's finished copy (95 carrying his setup) fingerprint identically. How full a sheet is does
 * not change what the sheet is.
 *
 * ================================ NOT A FILE HASH ================================
 *
 * Deliberately not a hash of the PDF bytes. Two drivers who download the same sheet on different
 * days, or whose viewer rewrites metadata on save, hold different bytes and the same sheet. A byte
 * hash would put them on separate rows and split the very thing this exists to join.
 */

/** Long enough that a collision is not a practical concern, short enough to read in a slug. */
const FINGERPRINT_HEX_LENGTH = 16;

/**
 * Unit separator. Without one, "ab" then "c" and "a" then "bc" hash alike — the one way two
 * genuinely different sheets could be pulled onto a single row. This character is safe because
 * `suggestKeyFromPdfFieldName` collapses every run of non-alphanumerics to an underscore, so no
 * derived key can contain it.
 */
const SEPARATOR = String.fromCharCode(31);

/** Marks a chassis row that came from a driver's own PDF rather than the curated catalog. */
export const DERIVED_SHEET_SLUG_PREFIX = "sheet_";

export type DerivedSheetFingerprintInput = {
  schema: Pick<SetupSheetModelSchema, "fields">;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
};

/**
 * One mapping rendered as text.
 *
 * `deriveSchemaFromAcroForm` only ever emits the simple shape (`pdfFieldName` plus an optional
 * `widgetInstanceIndex`), so those two are all there is to record today. The wider
 * `PdfFormFieldMappingRule` union is still read defensively: a rule shape this function did not
 * anticipate must change the hash rather than hash equal to a simple rule, or an unrelated sheet
 * could be pulled onto this row.
 */
function describeRule(rule: PdfFormFieldMappingRule | undefined): string {
  if (!rule || typeof rule !== "object") return "-";
  const mode = "mode" in rule && rule.mode ? String(rule.mode) : "acroField";
  const name = "pdfFieldName" in rule && rule.pdfFieldName ? String(rule.pdfFieldName) : "";
  const widget =
    "widgetInstanceIndex" in rule && typeof rule.widgetInstanceIndex === "number"
      ? String(rule.widgetInstanceIndex)
      : "";
  // Option-shaped rules carry their targets in `options`; fold those in so two sheets differing
  // only there cannot collide. Sorted, because object key order is not part of the meaning.
  const options =
    "options" in rule && rule.options && typeof rule.options === "object"
      ? Object.entries(rule.options as Record<string, unknown>)
          .map(([label, ref]) => `${label}>${JSON.stringify(ref)}`)
          .sort()
          .join(",")
      : "";
  return `${mode}|${name}|${widget}|${options}`;
}

export function derivedSheetFingerprint(input: DerivedSheetFingerprintInput): string {
  const hash = createHash("sha256");
  // Field ORDER is part of the identity, not just the set: the order is what the fill flow sweeps
  // in, and two sheets whose boxes run in different orders are not the same sheet to a driver.
  for (const field of input.schema.fields) {
    hash.update(field.key);
    hash.update(SEPARATOR);
    hash.update(describeRule(input.formFieldMappings[field.key]));
    hash.update(SEPARATOR);
  }
  return hash.digest("hex").slice(0, FINGERPRINT_HEX_LENGTH);
}

/** The `SetupSheetModel.slug` a derived sheet claims. Unique column, so this is the whole lookup. */
export function derivedSheetSlug(fingerprint: string): string {
  return `${DERIVED_SHEET_SLUG_PREFIX}${fingerprint}`;
}

/**
 * Is this chassis row one a driver's PDF created?
 *
 * SUPERSEDED WARNING, 2026-08-11. This used to say derived rows must be filtered out of every
 * chassis picker. Founder call reversed that: a derived row DOES appear in the Add-car dropdown,
 * badged "Unreviewed", exactly like a driver-authored track or tire.
 *
 * What changed is that the row now carries a name a person typed. The old rule was sound while a
 * derived row was identified only by its hash — nobody can pick `sheet_a1b2c3` out of a list. Now
 * the fingerprint decides only whether two uploads are the SAME sheet, and the typed name is what
 * the driver reads. Hiding the row would mean the second driver with that car cannot find it and
 * uploads their own copy, which is the fragmentation the fingerprint exists to prevent.
 *
 * Still useful for telling a derived row from a curated one — which is what `sheetTrust` turns on.
 */
export function isDerivedSheetSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.startsWith(DERIVED_SHEET_SLUG_PREFIX);
}
