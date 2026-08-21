/**
 * Parse the <address> block a LiveRC track publishes on its own home page.
 *
 * The shape is remarkably consistent — 1,124 of the 1,126 swept hosts have exactly three lines:
 *
 *   ["37840 N 21st Ave",            street
 *    "Phoenix, AZ 85086",           city, region + postcode
 *    "United States"]               country
 *
 * The middle line comes in two dialects: comma-separated with a region (US, Canada, and some of
 * Australia) and plain "City Postcode" (UK, Europe, Asia, most of NZ). Everything else is flagged
 * for human review rather than guessed at — a wrong town is worse than an empty one, because the
 * catalog's whole promise is that the driver doesn't have to think about it.
 */

/** Country names exactly as LiveRC writes them -> ISO-3166-1 alpha-2, lowercase. */
const COUNTRY_TO_ISO: Record<string, string> = {
  Argentina: "ar",
  Aruba: "aw",
  Australia: "au",
  Austria: "at",
  Azerbaijan: "az",
  Belgium: "be",
  Brazil: "br",
  "Brunei Darussalam": "bn",
  Bulgaria: "bg",
  Canada: "ca",
  Chile: "cl",
  China: "cn",
  Colombia: "co",
  "Costa Rica": "cr",
  "Czech Republic": "cz",
  "Dominican Republic": "do",
  Estonia: "ee",
  Finland: "fi",
  Honduras: "hn",
  "Hong Kong": "hk",
  Hungary: "hu",
  Iceland: "is",
  Indonesia: "id",
  Israel: "il",
  Japan: "jp",
  "Korea (South)": "kr",
  Malaysia: "my",
  Malta: "mt",
  Mexico: "mx",
  Mongolia: "mn",
  Netherlands: "nl",
  "New Zealand": "nz",
  Oman: "om",
  Philippines: "ph",
  Poland: "pl",
  Portugal: "pt",
  "Puerto Rico": "pr",
  Singapore: "sg",
  "South Africa": "za",
  Sweden: "se",
  Switzerland: "ch",
  Taiwan: "tw",
  Thailand: "th",
  "Trinidad and Tobago": "tt",
  "United Arab Emirates": "ae",
  "United Kingdom": "gb",
  "United States": "us",
  Venezuela: "ve",
  Vietnam: "vn",
};

export function countryNameToIso(name: string): string | null {
  return COUNTRY_TO_ISO[name.trim()] ?? null;
}

export type ParsedAddress = {
  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  countryCode: string | null;
  countryName: string | null;
};

/** A token that is all digits, or a UK/NL-style alphanumeric postcode. Never a town. */
function looksLikePostcode(token: string): boolean {
  if (/^[0-9][0-9\s-]*$/.test(token)) return true;
  // Outward code: UK "TN34"/"tn389ba", CA "N5A".
  if (/^[a-z]{1,2}[0-9][a-z0-9]*$/i.test(token) && /[0-9]/.test(token)) return true;
  // Inward code, always digit + two letters: UK "1EX", NL "AB" half of "1234 AB", CA "6S3".
  if (/^[0-9][a-z]{2}$/i.test(token)) return true;
  return false;
}

/**
 * Split "Phoenix, AZ 85086" / "Hastings TN34 1EX" / "Wiri, Auckland 02025" into parts.
 * The region slot is only filled by a 2-3 letter code after a comma — spelled-out second lines
 * like "Wiri, Auckland" are a suburb + city, not a state, so the city wins and region stays null.
 */
export function parseCityLine(line: string): {
  city: string | null;
  region: string | null;
  postcode: string | null;
} {
  const trimmed = line.trim();
  if (!trimmed) return { city: null, region: null, postcode: null };

  const commaIndex = trimmed.lastIndexOf(",");
  if (commaIndex > 0) {
    const city = trimmed.slice(0, commaIndex).trim();
    const rest = trimmed.slice(commaIndex + 1).trim();
    const tokens = rest.split(/\s+/).filter(Boolean);

    // "AZ 85086" -> region + postcode. "Auckland 02025" -> no region, the word is part of the place.
    if (tokens.length > 0 && /^[A-Za-z]{2,3}\.?$/.test(tokens[0]!)) {
      const region = tokens[0]!.replace(/\.$/, "").toUpperCase();
      const postcode = tokens.slice(1).join(" ").trim() || null;
      return { city: city || null, region, postcode };
    }

    const postTokens: string[] = [];
    while (tokens.length > 0 && looksLikePostcode(tokens[tokens.length - 1]!)) {
      postTokens.unshift(tokens.pop()!);
    }
    const tail = tokens.join(" ").trim();
    return {
      city: (tail ? `${city}, ${tail}` : city) || null,
      region: null,
      postcode: postTokens.join(" ").trim() || null,
    };
  }

  // No comma: strip a trailing postcode and keep the rest as the town.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const postTokens: string[] = [];
  while (tokens.length > 1 && looksLikePostcode(tokens[tokens.length - 1]!)) {
    postTokens.unshift(tokens.pop()!);
  }
  return {
    city: tokens.join(" ").trim() || null,
    region: null,
    postcode: postTokens.join(" ").trim() || null,
  };
}

export function parseLiveRcAddress(addressLines: readonly string[]): ParsedAddress {
  const lines = addressLines.map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    return {
      street: lines[0] ?? null,
      city: null,
      region: null,
      postcode: null,
      countryCode: null,
      countryName: null,
    };
  }

  // Take the last line as the country and the second-to-last as the city line, so a rare
  // four-line block (extra street detail) still lands its city and country correctly.
  const countryName = lines[lines.length - 1]!;
  const { city, region, postcode } = parseCityLine(lines[lines.length - 2]!);
  const street = lines.slice(0, lines.length - 2).join(", ") || null;

  return {
    street,
    city,
    region,
    postcode,
    countryCode: countryNameToIso(countryName),
    countryName,
  };
}

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
