/** Shared shapes for the track-catalog seed pipeline. No runtime code — types only. */

export type CandidateSource = "liverc" | "osm";

/** How a candidate's coordinates were obtained. Mirrors `Track.locationSource` in the schema. */
export type CoordinateSource = "osm" | "geocode" | null;

export type TrackCandidate = {
  /** `${source}:${sourceRef}` — the idempotency key, matching Track's unique constraint. */
  key: string;
  source: CandidateSource;
  /** LiveRC host ("1upracing.liverc.com") or OSM element ref ("way/12345"). */
  sourceRef: string;

  name: string;
  /** Punctuation- and case-collapsed name, for duplicate detection. */
  nameKey: string;

  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  /** ISO-3166-1 alpha-2, lowercase. */
  countryCode: string | null;
  countryName: string | null;

  latitude: number | null;
  longitude: number | null;
  coordinateSource: CoordinateSource;

  liveRcUrl: string | null;
  website: string | null;

  /** LiveRC event archive. Context for the reviewer; `lastEvent` is the activity filter. */
  eventCount: number;
  firstEvent: string | null;
  lastEvent: string | null;

  /**
   * "forward" — has an address, needs coordinates (LiveRC).
   * "reverse" — has coordinates, needs a town and country (OSM).
   * null — nothing left to look up.
   */
  needsGeocode: "forward" | "reverse" | null;

  /** Why this row wants a human look. Never changes the data; only sorts the review queue. */
  flags: string[];
};

/** One geocoder result, cached to disk so re-runs cost nothing. */
export type GeocodeCacheEntry = {
  query: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  /** "structured" | "freeform" | "reverse" | "none" — how the hit was found. */
  strategy: string;
  /** OSM place class, e.g. "building" vs "place". A town centroid is not a track. */
  precision: string | null;
  fetchedAt: string;
};
