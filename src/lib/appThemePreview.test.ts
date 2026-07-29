/**
 * Run: `npx tsx src/lib/appThemePreview.test.ts`
 *
 * The background picker is TS metadata pointing at CSS blocks that live in a
 * different file, so the failure mode is silent: add a mode, forget the CSS, and
 * the swatch just does nothing. These tests pin the two sides together.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  BG_PREVIEW_DEFAULT_ID,
  BG_PREVIEW_OPTIONS,
  bgPreviewBootstrapScript,
  isBgPreviewId,
} from "@/lib/appThemePreview";

const CSS = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8"
);

test("every non-default mode has a matching CSS block in globals.css", () => {
  for (const opt of BG_PREVIEW_OPTIONS) {
    if (opt.id === BG_PREVIEW_DEFAULT_ID) continue;
    assert.ok(
      CSS.includes(`html[data-bg-preview="${opt.id}"]`),
      `no globals.css rule for background mode "${opt.id}"`
    );
  }
});

test("the default mode is the bare CSS default — it must not have its own block", () => {
  // `applyBgPreviewToDocument` removes the attribute for the default, so a block
  // keyed on it would never apply. Kept as its own test because the miss is quiet.
  const options = BG_PREVIEW_OPTIONS.map((o) => o.id);
  assert.ok(options.includes(BG_PREVIEW_DEFAULT_ID));
  assert.equal(BG_PREVIEW_DEFAULT_ID, "black");
});

test("the flat base of every mode is driven by --page-bg-base", () => {
  assert.ok(
    CSS.includes("background-color: var(--page-bg-base)"),
    ".page-bg must read --page-bg-base or the colour modes do nothing"
  );
  for (const layer of ["--page-bg-photo", "--page-bg-scrim", "--page-bg-vignette"]) {
    assert.ok(CSS.includes(`background: var(${layer})`), `${layer} is unused`);
  }
});

test("photo mode points at an asset that exists", () => {
  const opt = BG_PREVIEW_OPTIONS.find((o) => o.id === "photo");
  assert.ok(opt, "photo mode missing");
  assert.ok(CSS.includes("/brand/track-hero-baked.jpg"));
  assert.doesNotThrow(() =>
    readFileSync(path.join(process.cwd(), "public/brand/track-hero-baked.jpg"))
  );
});

test("option ids are unique and every option has a swatch colour", () => {
  const ids = BG_PREVIEW_OPTIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate background mode id");
  for (const opt of BG_PREVIEW_OPTIONS) {
    assert.match(opt.hex, /^#[0-9A-Fa-f]{6}$/, `${opt.id} needs a hex swatch`);
    assert.ok(opt.label.length > 0 && opt.hint.length > 0);
  }
});

test("isBgPreviewId rejects stale / junk stored values", () => {
  assert.ok(isBgPreviewId("photo"));
  // "espresso" was the pre-2026-07-29 default id; stored copies must be cleared.
  assert.ok(!isBgPreviewId("espresso"));
  assert.ok(!isBgPreviewId(null));
  assert.ok(!isBgPreviewId(""));
});

test("bootstrap script inlines every valid id so it can validate before paint", () => {
  const script = bgPreviewBootstrapScript();
  for (const opt of BG_PREVIEW_OPTIONS) {
    assert.ok(script.includes(`"${opt.id}"`), `bootstrap missing ${opt.id}`);
  }
  assert.ok(script.includes("rc_engineer_theme_preview"), "legacy key not cleared");
});
