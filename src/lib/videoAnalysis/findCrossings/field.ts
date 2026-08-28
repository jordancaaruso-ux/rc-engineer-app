/**
 * Whose car was that? — settled for the whole field at once, not one crossing at a time.
 *
 * Every crossing the detector has been trusting was chosen the same way: the candidate nearest
 * to where THIS driver was expected. That is fine with one car on track and demonstrably wrong in
 * a race — on the Boronia heat of 2026-08-26 the detector wrote Chris Kalfoglou's car as Jordan's
 * at every corner of lap 12, because Chris happened to be the nearest thing to where Jordan was
 * due, and nothing in the method ever asked whether Chris was due there too.
 *
 * He was, and we knew it. The timing sheet carries every driver's lap times, so every driver's
 * lap starts are known on the video clock, and a corner sits at much the same offset into a lap
 * whoever is driving. So each line has, per lap, one expected moment for EVERY car in the field —
 * and one car crosses a line once per lap. The question "is this candidate my car?" becomes "of
 * everyone who was due here, whose is it?", and that is a matching problem: candidates on one
 * side, (driver, lap) slots on the other, each pairing costing how far apart they are, each
 * candidate used at most once and each slot filled at most once. Solve it for the least total
 * cost and a rival's crossing goes to the rival — however close to our prediction it sat —
 * because leaving the rival's slot empty and stealing the candidate costs more than the honest
 * arrangement.
 *
 * This is the idea every field that tracks identical things arrived at: radar deinterleaves
 * identical pulses by which emitter's timing they fit, cell trackers link frames with a global
 * assignment rather than nearest-neighbour, freeway loop detectors re-identify near-identical
 * cars by the sequence they arrive in. The exact solver is Kuhn–Munkres; the sizes here (a few
 * hundred candidates against a few dozen slots per line) make it instant.
 *
 * Two refinements on the plain matching, both learnt from a first, timing-only pass and applied
 * in a second:
 *
 *  - **Rivals learn their own offset.** A rival takes a different line into a corner, so
 *    "same offset as us" puts their expected moment a few tenths out — exactly the margin
 *    where a call cannot be made. The first pass hands each rival some crossings; the offset
 *    those repeat at is theirs.
 *  - **Colour, per line, once it has earned a say.** The first pass also hands each scanned
 *    driver their crossings at this line, and the colour those share is that car AT THIS LINE —
 *    per line, because the same car reads a different colour at different corners (the light,
 *    the angle), by about as much as two different cars do at one. The colours handed to
 *    everyone else say what "not this car" looks like here; only when those sit clearly apart
 *    (`colourUsable`) does colour price a pairing or shift the burden of a claim. Until then it
 *    decides nothing, and the screen does not mention it.
 *
 * What this deliberately does NOT do: invent a crossing, or move one to a time nobody saw. Every
 * time it hands back is a candidate the detector produced. When the field says our pick was a
 * rival's and offers nothing else for us, the answer is a gap, which the bracketed second pass
 * can fill and the driver can see — not a guess.
 */

import {
  colourUsable,
  colourVerdict,
  referenceColour,
  separation,
  type CarColour,
  type Rgb,
} from "./carColour";
import type { RefinableResult } from "./refine";
import type { SessionRole } from "./fromSession";
import type { CrossingEvent } from "./types";

/** One driver in the race, wherever their lap starts fall on the video clock. */
export type FieldDriver = {
  /** Stable key: the scanned role for the two drivers being scanned, the timing key otherwise. */
  key: string;
  name: string;
  /** Set for the two drivers whose crossings are being searched for. */
  role?: SessionRole;
  lapStarts: Array<{ lapNumber: number; startSec: number }>;
};

/** Who the field says a crossing belonged to. */
export type Claim = { by: string; key: string; lapNumber: number };

/** Colour references per scanned role. */
export type CarColours = Partial<Record<SessionRole, CarColour | null>>;

export type FieldAssignment = {
  /**
   * Per result id, the candidate the field matching gives that driver on that lap and line —
   * null when the slot went empty. Ids absent from the map were on a line the field could not
   * judge (no repeatable offset yet), and the caller should leave those alone.
   */
  pick: Map<string, CrossingEvent | null>;
  /** Result ids whose detected time the field gave to a different driver or lap. */
  claimed: Map<string, Claim>;
  /** Typical offset from a lap start to each line, pooled across the scanned drivers. */
  offsets: Map<string, number>;
  /** Offsets each rival was found to repeat at, per line — `lineKey -> driver key -> seconds`. */
  rivalOffsets: Map<string, Map<string, number>>;
  /** Lines where a scanned driver's colour proved able to tell the cars apart, and had a say. */
  colourLines: Map<string, SessionRole[]>;
  /**
   * Every crossing the matching handed to anyone, per line — the rivals' laps included. This is
   * where a driver nobody tapped gets sector times from: partial (only what fell inside the
   * scanned drivers' windows), and marked so downstream.
   */
  fieldCrossings: Map<string, FieldCrossing[]>;
};

/** One crossing the field matching gave to one driver on one lap. */
export type FieldCrossing = { key: string; lapNumber: number; t: number; quality: number };

/**
 * How far from a driver's expected moment a candidate may sit and still be theirs. Real lap-to-lap
 * scatter at a corner is a few tenths; a bobble is half a second. Beyond this the pairing is
 * forbidden rather than merely expensive.
 */
export const FIELD_GATE_SEC = 0.8;
/** Two candidate times closer than this are one event seen from two overlapping windows. */
const SAME_EVENT_SEC = 0.06;
/**
 * A rival's fit must beat this driver's own by this much before a crossing is taken away. Two
 * cars a tenth apart are nose to tail, and no timing can say which of them a single blob was —
 * the matching still has to give it to somebody, but "somebody, by a hair" is not evidence, and
 * the detector's own pick stands. The Boronia errors this exists for were 0.8–1.1s out.
 */
const CLAIM_MARGIN_SEC = 0.3;
/** With a usable colour saying "ours", a claim needs this much — timing has to be emphatic. */
const CLAIM_MARGIN_RIGHT_COLOUR_SEC = 0.6;
/** Cost added when a candidate's colour clearly contradicts the slot it would fill (≈0.4s of fit). */
const COLOUR_PENALTY = 0.5;
/** Cost added when the colour is neither a match nor clearly different. */
const COLOUR_UNSURE_PENALTY = 0.15;
/** Fewest coloured crossings a line must have handed a driver before their colour there is a reference. */
const MIN_COLOUR_SAMPLES = 3;
/** How tightly a driver's offsets must agree before they are trusted over the pooled one. */
const OFFSET_TOL_SEC = 0.35;
const MIN_OWN_LAPS = 2;
/** A pairing this far outside the gate is never chosen; finite so the solver's arithmetic holds. */
const FORBIDDEN = 1e6;
/** Leaving a candidate unclaimed, or a slot empty, costs one gate each — so any pairing inside the gate beats both. */
const UNMATCHED = 1.0;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** The largest set of values that all sit within `tol` of one another. */
function largestCluster(values: number[], tol: number): number[] {
  let best: number[] = [];
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const c of values) {
    const members = values.filter((v) => Math.abs(v - c) <= tol);
    const spread = Math.max(...members) - Math.min(...members);
    if (members.length > best.length || (members.length === best.length && spread < bestSpread)) {
      best = members;
      bestSpread = spread;
    }
  }
  return best;
}

function roleOf(id: string): string {
  return id.split(":")[0] ?? "";
}

function lapOf(id: string): number {
  return Number(id.split(":")[1]);
}

/**
 * Minimum-cost perfect matching on a square cost matrix (Kuhn–Munkres with potentials, O(n³)).
 * Returns, for each row, the column it was matched to.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) out[p[j]! - 1] = j - 1;
  return out;
}

type Slot = { driver: FieldDriver; lapNumber: number; expected: number };
type Matching = { slots: Slot[]; candOfSlot: Map<number, number>; slotOfCand: Map<number, Slot> };

/**
 * One line, one solve: build the slots for the offsets given, price every pairing, match.
 *
 * Colour prices a pairing only when a reference for THIS line is usable. A scanned driver's slot
 * pays for a candidate that is clearly not their colour here; a rival's slot pays for a candidate
 * that clearly IS a scanned driver's — a pink car should not be handed to Chris either.
 */
function matchLine(
  cands: CrossingEvent[],
  field: FieldDriver[],
  offsetFor: (d: FieldDriver) => number,
  refs: CarColours
): Matching {
  const slots: Slot[] = [];
  for (const d of field) {
    const offset = offsetFor(d);
    for (const l of d.lapStarts) {
      const expected = l.startSec + offset;
      if (cands.some((c) => Math.abs(c.t - expected) <= FIELD_GATE_SEC)) {
        slots.push({ driver: d, lapNumber: l.lapNumber, expected });
      }
    }
  }
  const usable = (Object.entries(refs) as Array<[SessionRole, CarColour | null | undefined]>)
    .filter(([, ref]) => colourUsable(ref))
    .map(([role, ref]) => ({ role, ref: ref! }));

  const colourCost = (c: CrossingEvent, slot: Slot): number => {
    if (!c.colour || !usable.length) return 0;
    const own = slot.driver.role ? usable.find((u) => u.role === slot.driver.role) : undefined;
    if (own) {
      const v = colourVerdict(own.ref, c.colour);
      return v === "differs" ? COLOUR_PENALTY : v === "unsure" ? COLOUR_UNSURE_PENALTY : 0;
    }
    // A rival's slot: does this candidate look like one of the cars we actually know?
    return usable.some((u) => colourVerdict(u.ref, c.colour!) === "match") ? COLOUR_PENALTY : 0;
  };

  const C = cands.length;
  const S = slots.length;
  const n = C + S;
  const cost: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      if (i < C && j < S) {
        const d = Math.abs(cands[i]!.t - slots[j]!.expected);
        row[j] =
          d <= FIELD_GATE_SEC
            ? d / FIELD_GATE_SEC +
              0.02 * (1 - Math.max(0, Math.min(10, cands[i]!.quality)) / 10) +
              colourCost(cands[i]!, slots[j]!)
            : FORBIDDEN;
      } else if (i < C || j < S) {
        row[j] = UNMATCHED;
      } else {
        row[j] = 0;
      }
    }
    cost.push(row);
  }
  const match = hungarian(cost);
  const candOfSlot = new Map<number, number>();
  for (let i = 0; i < C; i++) {
    const j = match[i]!;
    if (j < S && cost[i]![j]! < FORBIDDEN) candOfSlot.set(j, i);
  }
  const slotOfCand = new Map<number, Slot>();
  for (const [j, i] of candOfSlot) slotOfCand.set(i, slots[j]!);
  return { slots, candOfSlot, slotOfCand };
}

/**
 * What each scanned driver's car looks like AT THIS LINE, from the crossings the first pass gave
 * them — measured against the colours it gave everyone else, which is what makes it usable or not.
 */
function lineColourReferences(
  cands: CrossingEvent[],
  first: Matching,
  driverByRole: Map<string, FieldDriver>
): CarColours {
  const refs: CarColours = {};
  for (const [role, d] of driverByRole) {
    const own: Rgb[] = [];
    const rivals: Rgb[] = [];
    for (const [j, i] of first.candOfSlot) {
      const c = cands[i]!.colour;
      if (!c) continue;
      (first.slots[j]!.driver === d ? own : rivals).push(c);
    }
    if (own.length < MIN_COLOUR_SAMPLES) continue;
    const ref = referenceColour(own);
    if (ref) refs[role as SessionRole] = { ...ref, separation: separation(ref, rivals) };
  }
  return refs;
}

/**
 * Assign every candidate on every line to whoever in the field was due there.
 *
 * `results` are the scanned drivers' rows — their chosen times AND the candidates each window
 * produced, because the field may prefer a candidate the nearest-to-prediction rule passed over.
 * Lap starts are the transponder walk; the two scanned drivers' rows are also where each line's
 * typical offset is learnt from, by the biggest agreeing cluster across laps.
 */
export function assignToField(opts: {
  results: RefinableResult[];
  field: FieldDriver[];
  sfKey: string;
}): FieldAssignment {
  const { results, field, sfKey } = opts;
  const pick = new Map<string, CrossingEvent | null>();
  const claimed = new Map<string, Claim>();
  const offsets = new Map<string, number>();
  const rivalOffsets = new Map<string, Map<string, number>>();
  const colourLines = new Map<string, SessionRole[]>();
  const fieldCrossings = new Map<string, FieldCrossing[]>();

  const driverByRole = new Map<string, FieldDriver>();
  for (const d of field) if (d.role) driverByRole.set(d.role, d);
  const startOf = (d: FieldDriver, lap: number) =>
    d.lapStarts.find((l) => l.lapNumber === lap)?.startSec;

  const lines = [...new Set(results.map((r) => r.lineKey))].filter((k) => k !== sfKey);
  for (const line of lines) {
    const rows = results.filter((r) => r.lineKey === line);

    // Each scanned driver's own offset, where their laps agree; the pool for everyone else.
    const own = new Map<string, number>();
    for (const [role, d] of driverByRole) {
      const offs: number[] = [];
      for (const r of rows) {
        if (roleOf(r.id) !== role || r.detectedSec == null) continue;
        const start = startOf(d, lapOf(r.id));
        if (start != null) offs.push(r.detectedSec - start);
      }
      const core = largestCluster(offs, OFFSET_TOL_SEC);
      if (core.length >= MIN_OWN_LAPS) own.set(role, median(core));
    }
    if (own.size === 0) continue; // nothing repeatable on this line yet — no opinion
    const pooled = median([...own.values()]);
    offsets.set(line, pooled);

    // Every distinct moment something crossed this line, from every window that read it.
    const events: CrossingEvent[] = [];
    for (const r of rows) {
      for (const c of r.candidates) events.push(c);
      if (r.detectedSec != null) events.push({ t: r.detectedSec, quality: r.quality ?? 0 });
    }
    events.sort((a, b) => a.t - b.t);
    const cands: CrossingEvent[] = [];
    for (const e of events) {
      const last = cands[cands.length - 1];
      if (last && e.t - last.t < SAME_EVENT_SEC) {
        // Same event: keep the better-supported record, and never lose a colour to a bare time.
        const keep = e.quality > last.quality ? { ...e, t: last.t } : last;
        cands[cands.length - 1] = { ...keep, colour: keep.colour ?? e.colour ?? last.colour };
        continue;
      }
      cands.push({ ...e });
    }
    if (cands.length === 0) continue;

    // First pass: timing only, rivals at the pooled offset.
    const first = matchLine(cands, field, (d) => (d.role && own.get(d.role)) ?? pooled, {});

    // What the first pass taught: each rival's own offset, and each scanned car's colour here.
    const learned = new Map<string, number>();
    for (const d of field) {
      if (d.role) continue;
      const offs: number[] = [];
      for (const [j, i] of first.candOfSlot) {
        const s = first.slots[j]!;
        if (s.driver !== d) continue;
        const start = startOf(d, s.lapNumber);
        if (start != null) offs.push(cands[i]!.t - start);
      }
      const core = largestCluster(offs, OFFSET_TOL_SEC);
      if (core.length >= MIN_OWN_LAPS) learned.set(d.key, median(core));
    }
    if (learned.size) rivalOffsets.set(line, learned);
    const refs = lineColourReferences(cands, first, driverByRole);
    const usableRoles = (Object.keys(refs) as SessionRole[]).filter((r) => colourUsable(refs[r]));
    if (usableRoles.length) colourLines.set(line, usableRoles);

    // Second pass, with what was learnt — only when something was.
    const final =
      learned.size || usableRoles.length
        ? matchLine(
            cands,
            field,
            (d) => (d.role && own.get(d.role)) ?? learned.get(d.key) ?? pooled,
            refs
          )
        : first;
    const { slots, candOfSlot, slotOfCand } = final;
    fieldCrossings.set(
      line,
      [...candOfSlot].map(([j, i]) => {
        const s = slots[j]!;
        const c = cands[i]!;
        return { key: s.driver.key, lapNumber: s.lapNumber, t: c.t, quality: c.quality };
      })
    );

    for (const r of rows) {
      const d = driverByRole.get(roleOf(r.id));
      if (!d) continue;
      const lap = lapOf(r.id);
      const j = slots.findIndex((s) => s.driver === d && s.lapNumber === lap);
      // No slot means nothing crossed within reach of where this driver was due: an empty answer.
      const i = j >= 0 ? candOfSlot.get(j) : undefined;
      pick.set(r.id, i == null ? null : cands[i]!);
      if (r.detectedSec == null) continue;
      const idx = cands.findIndex((c) => Math.abs(c.t - r.detectedSec!) < SAME_EVENT_SEC);
      if (idx < 0) continue;
      const owner = slotOfCand.get(idx);
      if (!owner || (owner.driver === d && owner.lapNumber === lap)) continue;
      const cand = cands[idx]!;
      const ownFit = j >= 0 ? Math.abs(cand.t - slots[j]!.expected) : Number.POSITIVE_INFINITY;
      const ownerFit = Math.abs(cand.t - owner.expected);
      // The burden of proof moves with colour, once colour has earned a say on this line: a car
      // that is clearly not ours goes wherever the matching put it; one that clearly is ours needs
      // emphatic timing to lose; anything else needs the plain margin.
      const ref = d.role ? refs[d.role] : undefined;
      const verdict = colourUsable(ref) && cand.colour ? colourVerdict(ref, cand.colour) : "unsure";
      const margin =
        verdict === "differs"
          ? Number.NEGATIVE_INFINITY
          : verdict === "match"
            ? CLAIM_MARGIN_RIGHT_COLOUR_SEC
            : CLAIM_MARGIN_SEC;
      if (ownFit - ownerFit >= margin) {
        claimed.set(r.id, { by: owner.driver.name, key: owner.driver.key, lapNumber: owner.lapNumber });
      }
    }
  }

  return { pick, claimed, offsets, rivalOffsets, colourLines, fieldCrossings };
}

export type FieldOutcome<T> = T & {
  /** Set when the field gave this row's time to somebody else and nothing else fitted. */
  claimedBy?: Claim;
  /** Set when the field swapped this row onto the candidate that fitted its own slot. */
  movedBy?: number;
};

/**
 * Apply the field's answer to the rows: a claimed time is swapped for the candidate that fits our
 * own slot when there is one, and otherwise kept but labelled, so it can be held back and shown.
 * Rows in `fixed` (hand marks, lap starts) are never touched.
 */
export function applyFieldAssignment<T extends RefinableResult>(
  rows: T[],
  assignment: FieldAssignment,
  fixed: Set<string>
): Array<FieldOutcome<T>> {
  return rows.map((r) => {
    if (fixed.has(r.id) || r.detectedSec == null) return r;
    const claim = assignment.claimed.get(r.id);
    if (!claim) return r;
    const alt = assignment.pick.get(r.id);
    if (alt && Math.abs(alt.t - r.detectedSec) >= SAME_EVENT_SEC) {
      return {
        ...r,
        detectedSec: alt.t,
        quality: alt.quality,
        source: "rescued" as const,
        movedBy: alt.t - r.detectedSec,
      };
    }
    return { ...r, claimedBy: claim };
  });
}
