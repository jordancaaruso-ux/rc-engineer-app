/**
 * One crossing, one car — the Bendigo practice of 2026-09-01, exactly as the scan saved it.
 *
 * Justin's S1 window kept finding one car, Jordan's, and being handed it at the identical
 * millisecond it was already written as Jordan's. Two of his six S1 rows were genuinely his
 * (2.24s and 2.33s into his lap — where everyone's S1 sits); the other four were stolen. The
 * plausibility vote needs three rows that agree, the two real ones were a minority of two, and
 * the whole line was held: sector 1 and sector 2 blank on every one of his laps.
 */
import { dropCrossDriverDuplicates, flagImplausible, type RefinableResult } from "./refine";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SF = "sf";
const roleOf = (r: RefinableResult) => r.id.split(":")[0]!;
const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");

function at(role: string, lap: number, lineKey: string, detectedSec: number, centerSec = detectedSec): RefinableResult {
  return {
    id: `${role}:${lap}:${lineKey}`,
    lineKey,
    lapNumber: lap,
    centerSec,
    detectedSec,
    quality: 8,
    candidates: [],
    source: "confirmed",
  };
}

// Lap starts from each driver's own transponder walk, and S1 as the scan found it.
const rows: RefinableResult[] = [
  at("me", 3, SF, 40.894), at("me", 3, "s1", 43.301),
  at("me", 4, SF, 56.056), at("me", 4, "s1", 58.443),
  at("me", 5, SF, 71.065), at("me", 5, "s1", 73.499),
  at("me", 6, SF, 86.007), at("me", 6, "s1", 88.510),
  at("me", 8, SF, 116.364), at("me", 8, "s1", 118.587),
  at("me", 12, SF, 194.956), at("me", 12, "s1", 197.362),
  at("me", 13, SF, 209.954), at("me", 13, "s1", 212.247),
  at("me", 16, SF, 256.123), at("me", 16, "s1", 258.459),

  // Justin. Laps 1, 2 and 4 are Jordan's car to the millisecond; 3 and 7 are his own.
  at("competitor", 1, SF, 41.717), at("competitor", 1, "s1", 43.301, 44.1),
  at("competitor", 2, SF, 57.184), at("competitor", 2, "s1", 58.443, 59.6),
  at("competitor", 3, SF, 72.680), at("competitor", 3, "s1", 75.008, 75.1),
  at("competitor", 4, SF, 88.105), at("competitor", 4, "s1", 88.510, 90.5),
  at("competitor", 7, SF, 134.763), at("competitor", 7, "s1", 137.006, 137.2),
];

/* ---------- before: the stolen rows outvote the real ones ---------- */
{
  const held = flagImplausible(rows, SF, lapKey);
  assert(held.has("competitor:3:s1") && held.has("competitor:7:s1"), "the bug: his two real S1 crossings are held with the stolen ones");
}

/* ---------- the same event, two drivers: one of them loses it ---------- */
{
  const dropped = dropCrossDriverDuplicates(rows, roleOf, new Set());
  assert(dropped.size === 3, `three stolen rows, got ${dropped.size}: ${[...dropped].join(", ")}`);
  for (const lap of [1, 2, 4]) {
    assert(dropped.has(`competitor:${lap}:s1`), `competitor lap ${lap} S1 is Jordan's car`);
  }
  assert(!dropped.has("me:3:s1") && !dropped.has("me:4:s1") && !dropped.has("me:6:s1"), "Jordan keeps his own");
  assert(!dropped.has("competitor:3:s1") && !dropped.has("competitor:7:s1"), "his real crossings are untouched");

  // The fit decides who keeps a tie: 43.301 is 2.4s into Jordan's lap 3 and 1.6s into Justin's
  // lap 1, and each row's centre says where its own driver was due. Jordan's row is nearer.
  const dropped2 = dropCrossDriverDuplicates(rows, roleOf, new Set());
  assert(!dropped2.has("me:3:s1"), "the row nearer its own prediction keeps the event");
}

/* ---------- after: the vote sees only his own evidence ---------- */
{
  const dropped = dropCrossDriverDuplicates(rows, roleOf, new Set());
  const live = rows.filter((r) => !dropped.has(r.id));
  const held = flagImplausible(live, SF, lapKey);
  assert(!held.has("competitor:3:s1") && !held.has("competitor:7:s1"), "two rows that agree, and nothing to outvote them");
}

/* ---------- a fixed row is never the loser; the field's word beats the fit ---------- */
{
  const fixed = dropCrossDriverDuplicates(rows, roleOf, new Set(["competitor:1:s1"]));
  assert(fixed.has("me:3:s1") && !fixed.has("competitor:1:s1"), "a hand mark keeps the event whatever the fit says");

  const claimed = rows.map((r) =>
    r.id === "me:4:s1" ? { ...r, claimedBy: { by: "Justin", key: "competitor", lapNumber: 2 } } : r
  );
  const byField = dropCrossDriverDuplicates(claimed, roleOf, new Set());
  assert(byField.has("me:4:s1") && !byField.has("competitor:2:s1"), "the field named Justin, so Justin keeps it");
}

/* ---------- two cars side by side are two events ---------- */
{
  const pair = [at("me", 3, "s1", 43.301), at("competitor", 1, "s1", 43.301 + 0.08)];
  assert(dropCrossDriverDuplicates(pair, roleOf, new Set()).size === 0, "80ms apart is two blobs, not one");
}

console.log("findCrossings crossDriver.test.ts OK");
