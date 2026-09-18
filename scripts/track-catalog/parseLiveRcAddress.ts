export {
  countryNameToIso,
  parseCityLine,
  parseLiveRcAddress,
  type ParsedAddress,
} from "../../src/lib/tracks/parseLiveRcAddress";

/**
 * Collapse a track name to a comparison key. Same rule as `normalize()` in
 * scripts/measure-catalog-state.ts, so "Ronny's RC" and "Ronnys R/C" land in one bucket.
 */
export function normalizeTrackName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Reasons a candidate needs a human look. These never change the data — they only decide what
 * sorts to the top of the review queue, so the founder spends their time on the doubtful rows.
 */
export function flagCandidate(input: {
  name: string;
  city: string | null;
  countryCode: string | null;
  postcode: string | null;
}): string[] {
  const flags: string[] = [];
  const name = input.name.trim();

  if (name.length < 4) flags.push("name-too-short");
  if (name.length > 60) flags.push("name-too-long");
  if (name.length >= 6 && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    flags.push("name-all-caps");
  }
  if (name.length >= 6 && name === name.toLowerCase() && /[a-z]/.test(name)) {
    flags.push("name-all-lowercase");
  }
  // A shop or club office rather than a circuit — worth a glance, never an auto-reject.
  if (/\b(hobb(y|ies)|shop|store|showroom|supplies)\b/i.test(name)) flags.push("name-looks-retail");
  if (!input.city) flags.push("missing-city");
  if (!input.countryCode) flags.push("unknown-country");
  // "Private", "0000000" — present but meaningless, so the geocode will be junk.
  if (input.city && /^(private|n\/?a|none|unknown|test)$/i.test(input.city)) {
    flags.push("placeholder-city");
  }
  if (input.postcode && /^0+$/.test(input.postcode.replace(/\s/g, ""))) {
    flags.push("placeholder-postcode");
  }

  return flags;
}
