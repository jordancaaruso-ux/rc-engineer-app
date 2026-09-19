import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardCoversBar } from "./wizardKeyboard";

const phone = { layoutHeight: 844, visualScale: 1 };

test("keyboard up under a focused text box hides the bar", () => {
  assert.equal(keyboardCoversBar({ ...phone, focusedTextEntry: true, visualHeight: 508 }), true);
});

test("a short visual viewport with NO text box focused is not a keyboard", () => {
  // The stuck state of 2026-09-19: a stale or fooled measurement, nothing focused.
  assert.equal(keyboardCoversBar({ ...phone, focusedTextEntry: false, visualHeight: 508 }), false);
});

test("a held focus with the keyboard dismissed shows the bar", () => {
  // The stuck state of 2026-08-15: the sheet keeps its input focused; iOS dropped the keyboard.
  assert.equal(keyboardCoversBar({ ...phone, focusedTextEntry: true, visualHeight: 844 }), false);
});

test("a pinch-zoomed page is not a keyboard, focused or not", () => {
  const zoomed = { layoutHeight: 900, visualHeight: 750, visualScale: 1.2 };
  assert.equal(keyboardCoversBar({ ...zoomed, focusedTextEntry: true }), false);
  assert.equal(keyboardCoversBar({ ...zoomed, focusedTextEntry: false }), false);
});

test("a keyboard on a zoomed page still counts", () => {
  // 900 layout, 1.2x zoom, 300px keyboard: visual = (900 - 300) / 1.2
  assert.equal(
    keyboardCoversBar({ focusedTextEntry: true, layoutHeight: 900, visualHeight: 500, visualScale: 1.2 }),
    true
  );
});

test("the iOS URL bar coming and going is under the threshold", () => {
  assert.equal(keyboardCoversBar({ ...phone, focusedTextEntry: true, visualHeight: 784 }), false);
});

test("no visual viewport: focus is the only evidence", () => {
  assert.equal(keyboardCoversBar({ focusedTextEntry: true, layoutHeight: 800, visualHeight: null, visualScale: null }), true);
  assert.equal(keyboardCoversBar({ focusedTextEntry: false, layoutHeight: 800, visualHeight: null, visualScale: null }), false);
});
