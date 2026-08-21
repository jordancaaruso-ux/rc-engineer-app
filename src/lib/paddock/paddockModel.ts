import type { NextUp } from "@/lib/events/seasonTypes";

/**
 * Paddock — the shapes its cards read, in a module with no Prisma and no `server-only`
 * import so the client cards can take them as props without dragging the database client
 * across the boundary (the same split `seasonTypes` exists for, and for the same reason).
 *
 * The page is a composition of three lists that already have full pages of their own, so
 * every field here is deliberately a *summary*: enough to answer "what state is this in"
 * without opening it, and no more. Anything that needs a filter, a search box or an editor
 * belongs on `/cars`, `/tracks` or `/events`, which are still where the bands lead.
 *
 * ── Plain lists, 2026-08-19 ──────────────────────────────────────────────────────────────────
 * Every asset shape below is now a NAME AND AN ID, and that is the whole thing (founder call,
 * after the car card's run count and date came off by pin the same morning). No counts, no
 * dates, no second lines, no chips — and no expanded first item, so the shapes carry nothing to
 * distinguish one row from the rest of its band.
 *
 * The counts and dates are still QUERIED, because they are the sort: cars and consumables are
 * ordered by most recent use, tracks by favourite then run count. What changed is that none of
 * it is returned any more. So this is not a saving — deleting the `groupBy`s would delete the
 * order with them. If a band ever needs to be cheap, alphabetical is the version that is cheap.
 *
 * The consequence to know about: with the figures gone, NOTHING ON SCREEN EXPLAINS THE ORDER.
 * A compound you tried once yesterday sits above one with forty runs on it. That was put to the
 * founder as the argument against and he took recency anyway — the top row is what you are on.
 * The alternative, if it ever reads wrong, is alphabetical in `loadPaddockModel`, not a figure
 * added back here.
 */

export type PaddockCar = {
  id: string;
  name: string;
};

export type PaddockTrack = {
  id: string;
  name: string;
  /**
   * The star. The one mark that survived the strip, because it is not a statistic ABOUT the
   * track — it is which track it is, and it is the only thing on the row that explains why your
   * home track sits above a place you went once. Still read-only on this band; starring is a
   * catalog job and it lives on the catalog row.
   */
  isFavourite: boolean;
};

export type PaddockMeeting = {
  id: string;
  name: string;
  trackName: string | null;
  startYmd: string;
  daysUntil: number;
};

/**
 * One tyre compound or one additive, as the consumables bands read it (founder pin, 2026-08-19).
 *
 * The two bands share this shape and one component, because they are the same card twice — and
 * two cards that must look identical are exactly the pair that stops looking identical. Same
 * reasoning `BandFoot` and `BandHeader` carry.
 *
 * **Recently used, not favourites** — founder call, after both were drawn. Neither a tyre nor an
 * additive has a favourite flag anywhere in the schema (a track does), so favourites would mean
 * inventing a per-user pin on a shared catalog row, a control to press it, and a page to press it
 * on. Recency needs none of that: the run rows already say it. It is also what the app answers
 * everywhere else — the run wizard's compound picker walks your recent runs and offers those
 * first — so a favourite here would contradict the wizard three taps away. And a rotation is
 * three or four compounds deep, so the recent list IS the favourites list without anyone filling
 * in a form.
 *
 * A name, then. It carried a kind-line ("Asphalt · rubber"), a run count and a last-out chip
 * until the plain-lists pass; see the note at the top of this file for where they went and why
 * the query behind them stayed.
 */
export type PaddockConsumable = {
  id: string;
  name: string;
};

export type PaddockModel = {
  /**
   * The next booked meeting, with everything the Events page already works out about it.
   * Null when nothing is booked — which is a designed state, not an empty one.
   */
  nextUp: NextUp | null;
  /** Booked meetings AFTER `nextUp`, soonest first. */
  upcoming: PaddockMeeting[];
  /** Most recently used first, capped at `MAX_CARS`. */
  cars: PaddockCar[];
  /** Every car in the garage, for the door's count — `cars` only holds the five on show. */
  carTotal: number;
  /** Favourites first, then most-run. Capped — this is a summary, not the catalog. */
  tracks: PaddockTrack[];
  /** How many tracks the viewer can see in total, for the "N more" line. */
  trackCatalogCount: number;
  /**
   * The most recent session, for the nothing-booked hero. Null on a brand-new account,
   * which is what tells the page to drop the hero entirely rather than count down to nothing.
   */
  lastOuting: { trackName: string | null; label: string } | null;
  /** Every booked meeting including the hero's, for the door's count. */
  meetingTotal: number;
  /** Compounds you have actually run, most recently used first. Capped like every other band. */
  tires: PaddockConsumable[];
  /** Every compound in the shared catalog, for the door's count. */
  tireCatalogCount: number;
  /** Additives you have actually run, most recently used first. */
  additives: PaddockConsumable[];
  /** Every additive in the shared catalog, for the door's count. */
  additiveCatalogCount: number;
};

/*
 * ── How many rows a band shows ───────────────────────────────────────────────────────────────
 *
 * FIVE, since the plain-lists pass, and the number is a consequence of the row losing its
 * height rather than a separate decision. The fold before it was "one expanded, two compact,
 * then a door" — three rows, because the first of them was a block two or three lines deep and
 * the card already ran ~350px. A one-line row is about half that height, so three names left
 * roughly 130px of list sitting under a ~120px door: the way OUT of the card as big as the card.
 * Five names reads as a list and costs one number per band.
 *
 * Meetings is the odd one out and is unchanged at two. The next meeting is ALREADY the hero at
 * the top of the page, so this band is only what follows it — usually nothing, sometimes one —
 * and it still carries its countdown, because an event is a date with a name on it rather than
 * an asset. Stripping "in 6 days" off it would leave a row with no reason to exist.
 */

/** Cars listed on the page. */
export const MAX_CARS = 5;
/** Tracks listed on the page: your favourites first, then the ones you actually run. */
export const MAX_TRACKS = 5;
/** Booked meetings under the hero. The hero is showing the soonest one. */
export const MAX_UPCOMING = 2;
/** Tyres, and separately additives, listed on the page. */
export const MAX_CONSUMABLES = 5;

/**
 * `YYYY-MM-DD` difference in whole calendar days.
 *
 * Parsed as UTC, like every other date on the events surfaces: the rows are stored at UTC
 * noon and a local-timezone getter would shift a marker by a day for anyone east of GMT.
 */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * "Today" / "Tomorrow" / "in 12 days" / "in 5 weeks".
 *
 * Weeks take over past a fortnight because "in 37 days" is a number you have to convert
 * before it means anything, and the countdown's whole job is to be read at a glance.
 */
export function formatDaysUntil(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return `in ${weeks} weeks`;
}
