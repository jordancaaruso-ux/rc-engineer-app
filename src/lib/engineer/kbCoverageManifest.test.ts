/**
 * Run: npx tsx src/lib/engineer/kbCoverageManifest.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildKbCoverageManifest, parseKbTopics } from "@/lib/engineer/kbCoverageManifest";

const CAMBER = `## Camber

**Keys:** \`camber_front\`, \`camber_rear\` — camber is the tilt of the tire. See \`arm-angles-camber-gain.md\`.

**Mechanics:** more negative camber can help the outside tire.

## Rear toe

**Key:** \`toe_rear\` — more rear toe usually increases rear grip.
`;

const DAMPER = `# Damper oil

## Damper oil viscosity

Thicker oil slows shaft speed. No keys line here.
`;

test("parseKbTopics extracts headings and canonical keys", () => {
  const t = parseKbTopics("camber-caster-toe.md", CAMBER);
  assert.deepEqual(t.headings, ["Camber", "Rear toe"]);
  assert.deepEqual(t.keys.sort(), ["camber_front", "camber_rear", "toe_rear"]);
});

test("parseKbTopics ignores prose backticks and .md references as keys", () => {
  const t = parseKbTopics("camber-caster-toe.md", CAMBER);
  assert.ok(!t.keys.includes("arm-angles-camber-gain.md"));
});

test("parseKbTopics handles a file with headings but no keys line", () => {
  const t = parseKbTopics("damper-oil.md", DAMPER);
  assert.deepEqual(t.headings, ["Damper oil viscosity"]);
  assert.deepEqual(t.keys, []);
});

test("buildKbCoverageManifest yields one compact sorted line per file", () => {
  const manifest = buildKbCoverageManifest([
    { file: "damper-oil.md", content: DAMPER },
    { file: "camber-caster-toe.md", content: CAMBER },
  ]);
  const lines = manifest.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("camber-caster-toe.md")); // sorted
  assert.ok(lines[0].includes("sections: Camber | Rear toe"));
  assert.ok(lines[0].includes("keys: camber_front, camber_rear, toe_rear"));
  assert.ok(lines[1].startsWith("damper-oil.md"));
});
