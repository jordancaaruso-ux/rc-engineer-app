/**
 * Run: `npm run test:moderation` (or `npx tsx --test src/lib/moderation/moderation.test.ts`)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OBJECTIONABLE_TEXT_ERROR,
  findObjectionableWord,
  objectionableTextError,
} from "@/lib/moderation/wordFilter";
import {
  REPORT_EXCERPT_MAX,
  parseReportAction,
  parseReportInput,
  reasonsForKind,
  reportCanRemove,
  reportExcerpt,
} from "@/lib/moderation/reportRules";
import { applyCommentVisibility, blockedPeersFromRows } from "@/lib/moderation/visibilityRules";

test("the filter stops slurs, sexual words and threats", () => {
  for (const text of [
    "you're a faggot",
    "NIGGERS",
    "what a cunt",
    "kill yourself mate",
    "kys",
    "send porn",
    "rapist",
  ]) {
    assert.notEqual(findObjectionableWord(text), null, text);
  }
});

test("the filter sees through swapped letters and held keys", () => {
  assert.notEqual(findObjectionableWord("n1gg3r"), null);
  assert.notEqual(findObjectionableWord("$lut"), null);
  assert.notEqual(findObjectionableWord("cuuuunt"), null);
  assert.notEqual(findObjectionableWord("Kill   Your-self"), null);
});

test("everyday swearing and racing words pass", () => {
  for (const text of [
    "car was shit on power, fucking loose on exit",
    "Scunthorpe RC club",
    "Niger street raceway",
    "Pornic indoor track",
    "grapeseed oil on the tyres",
    "therapist said try 30wt",
    "spice it up with 3.5 degrees of timing",
    "Pakistan GP",
    "abort the run, cracked a-arm",
    "13.5T blinky, 21.5 stock",
    "",
  ]) {
    assert.equal(findObjectionableWord(text), null, text);
  }
});

test("objectionableTextError checks every text it is given", () => {
  assert.equal(objectionableTextError("Tamworth", null, undefined, "fine notes"), null);
  assert.equal(objectionableTextError("Tamworth", "whore"), OBJECTIONABLE_TEXT_ERROR);
});

test("a report needs a known kind, a target and a reason that kind offers", () => {
  assert.deepEqual(parseReportInput({ kind: "comment", targetId: "c1", reason: "abusive", teamId: "t1" }), {
    ok: true,
    input: { kind: "comment", targetId: "c1", reason: "abusive", teamId: "t1" },
  });
  assert.equal(parseReportInput({ kind: "run", targetId: "x", reason: "abusive" }).ok, false);
  assert.equal(parseReportInput({ kind: "track", targetId: "", reason: "wrong" }).ok, false);
  // "Wrong or duplicate" is for catalog entries, not for what a person said.
  assert.equal(parseReportInput({ kind: "comment", targetId: "c1", reason: "wrong" }).ok, false);
  assert.equal(parseReportInput({ kind: "track", targetId: "k1", reason: "wrong" }).ok, true);
  assert.equal(parseReportInput(null).ok, false);
});

test("reasons follow the kind", () => {
  assert.deepEqual(reasonsForKind("driver"), ["abusive", "spam", "other"]);
  assert.deepEqual(reasonsForKind("chassis"), ["abusive", "wrong", "other"]);
});

test("an excerpt is flattened and capped", () => {
  assert.equal(reportExcerpt("  two\n\nlines  "), "two lines");
  assert.equal(reportExcerpt(""), "(empty)");
  const long = reportExcerpt("x".repeat(REPORT_EXCERPT_MAX + 50));
  assert.equal(long.length, REPORT_EXCERPT_MAX);
  assert.ok(long.endsWith("…"));
});

test("the queue removes comments and drivers, and only closes catalog reports", () => {
  assert.equal(reportCanRemove("comment", "t1"), true);
  assert.equal(reportCanRemove("driver", "t1"), true);
  assert.equal(reportCanRemove("driver", null), false);
  assert.equal(reportCanRemove("track", null), false);
  assert.equal(parseReportAction("remove"), "remove");
  assert.equal(parseReportAction("delete"), null);
});

test("a block hides the other driver whichever side made it", () => {
  const peers = blockedPeersFromRows("me", [
    { blockerUserId: "me", blockedUserId: "sam" },
    { blockerUserId: "kirra", blockedUserId: "me" },
    { blockerUserId: "sam", blockedUserId: "kirra" },
  ]);
  assert.deepEqual([...peers].sort(), ["kirra", "sam"]);
});

test("hidden replies go; a hidden thread start stays only for a reply still shown", () => {
  const rows = [
    { id: "a", authorUserId: "sam", parentId: null },
    { id: "a1", authorUserId: "kirra", parentId: "a" },
    { id: "b", authorUserId: "sam", parentId: null },
    { id: "b1", authorUserId: "sam", parentId: "b" },
    { id: "c", authorUserId: "kirra", parentId: null },
    { id: "c1", authorUserId: "sam", parentId: "c" },
    { id: "d", authorUserId: "kirra", parentId: null },
  ];
  const seen = applyCommentVisibility(rows, {
    authorIds: new Set(["sam"]),
    commentIds: new Set(["d"]),
  });
  assert.deepEqual(
    seen.map((s) => `${s.row.id}${s.hidden ? ":hidden" : ""}`),
    ["a:hidden", "a1", "c"]
  );
});
