import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBulletEdit, cleanBullets, withBullets } from "./debriefBullets";

test("an older note gets a dot per line on the way in; blank lines go", () => {
  assert.equal(withBullets("Rear was loose\n\nTyres went off at 4 min"), "• Rear was loose\n• Tyres went off at 4 min");
});

test("a note that already has dots, or hand-typed dashes, is not dotted twice", () => {
  assert.equal(withBullets("• one\n- two\n* three"), "• one\n• two\n• three");
  assert.equal(withBullets(""), "");
});

test("a box holding only a waiting dot saves as nothing", () => {
  assert.equal(cleanBullets("• "), "");
  assert.equal(cleanBullets("• one\n• \n• two\n• "), "• one\n• two");
});

test("a dotted note survives the round trip unchanged", () => {
  const note = "• one\n• two";
  assert.equal(cleanBullets(withBullets(note)), note);
});

test("Return starts a new point with the caret after its dot", () => {
  assert.deepEqual(applyBulletEdit("• one\n", 6, "insertLineBreak"), { value: "• one\n• ", caret: 8 });
});

test("Return in the middle of a point splits it in two", () => {
  assert.deepEqual(applyBulletEdit("• one\ntwo", 6, "insertLineBreak"), { value: "• one\n• two", caret: 8 });
});

test("Return on an empty point does nothing", () => {
  assert.deepEqual(applyBulletEdit("• one\n• \n", 9, "insertLineBreak"), { value: "• one\n• ", caret: 8 });
  assert.deepEqual(applyBulletEdit("• \n", 3, "insertLineBreak"), { value: "• ", caret: 2 });
});

test("Backspace over a dot joins the point to the one above", () => {
  assert.deepEqual(applyBulletEdit("• one\n•two", 7, "deleteContentBackward"), { value: "• onetwo", caret: 5 });
  assert.deepEqual(applyBulletEdit("• one\n•", 7, "deleteContentBackward"), { value: "• one", caret: 5 });
});

test("Backspace over the only dot empties the box; over the first of many keeps the rest", () => {
  assert.deepEqual(applyBulletEdit("•", 1, "deleteContentBackward"), { value: "", caret: 0 });
  assert.deepEqual(applyBulletEdit("•\n• two", 1, "deleteContentBackward"), { value: "• two", caret: 0 });
  assert.deepEqual(applyBulletEdit("•one", 1, "deleteContentBackward"), { value: "• one", caret: 2 });
});

test("typing into an empty box, and a pasted block, both get their dots", () => {
  assert.deepEqual(applyBulletEdit("h", 1, "insertText"), { value: "• h", caret: 3 });
  assert.deepEqual(applyBulletEdit("• a\nb\nc", 7, "insertFromPaste"), { value: "• a\n• b\n• c", caret: 11 });
});

test("Delete at the end of a point pulls the next one up without its dot", () => {
  assert.deepEqual(applyBulletEdit("• one• two", 5, "deleteContentForward"), { value: "• onetwo", caret: 5 });
});

test("ordinary typing inside a point changes nothing", () => {
  assert.deepEqual(applyBulletEdit("• one\n• tw", 10, "insertText"), { value: "• one\n• tw", caret: 10 });
});
