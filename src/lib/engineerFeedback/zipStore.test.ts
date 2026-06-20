/**
 * Run: npx tsx src/lib/engineerFeedback/zipStore.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStoreOnlyZip } from "@/lib/engineerFeedback/zipStore";

test("buildStoreOnlyZip includes jsonl and md entries", () => {
  const zip = buildStoreOnlyZip([
    { name: "inbox.jsonl", content: '{"score":1}\n' },
    { name: "inbox.md", content: "# inbox\n" },
  ]);

  assert.ok(zip.length > 0);
  const text = zip.toString("binary");
  assert.match(text, /inbox\.jsonl/);
  assert.match(text, /inbox\.md/);
  assert.match(text, /\{"score":1\}/);
  assert.match(text, /# inbox/);
});
