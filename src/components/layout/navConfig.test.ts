/**
 * Run: `npx tsx src/components/layout/navConfig.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MOBILE_NAV,
  resolveActiveNavId,
  shouldShowLogRunFab,
} from "@/components/layout/navConfig";

test("mobile dock is five pure destinations, in order, without add-run or settings", () => {
  assert.deepEqual(
    MOBILE_NAV.map((item) => item.id),
    ["dashboard", "analysis", "engineer", "assets", "teams"]
  );
});

test("resolveActiveNavId splits /teams from /settings (Teams is its own tab now)", () => {
  assert.equal(resolveActiveNavId("/teams"), "teams");
  assert.equal(resolveActiveNavId("/teams/abc"), "teams");
  assert.equal(resolveActiveNavId("/settings"), "settings");
  assert.equal(resolveActiveNavId("/settings/danger"), "settings");
});

test("resolveActiveNavId still maps the core routes", () => {
  assert.equal(resolveActiveNavId("/"), "dashboard");
  assert.equal(resolveActiveNavId("/runs/new"), "add-run");
  assert.equal(resolveActiveNavId("/runs/abc/edit"), "add-run");
  assert.equal(resolveActiveNavId("/analysis"), "analysis");
  assert.equal(resolveActiveNavId("/runs/history"), "analysis");
  assert.equal(resolveActiveNavId("/engineer"), "engineer");
  assert.equal(resolveActiveNavId("/cars"), "assets");
});

test("shouldShowLogRunFab is visible on destinations, hidden inside create/edit flows", () => {
  // Visible: dashboard, hubs, lists, analysis, engineer.
  for (const path of [
    "/",
    "/analysis",
    "/runs/history",
    "/engineer",
    "/teams",
    "/assets",
    "/cars",
    "/setup-documents", // the list stays; only the editor detail hides
    "/setup-sheet-models",
  ]) {
    assert.equal(shouldShowLogRunFab(path), true, `expected FAB on ${path}`);
  }

  // Hidden: you're already logging, or in an editor with its own Save.
  for (const path of [
    "/runs/new",
    "/runs/abc/edit",
    "/setup-sheet-models/xyz/schema",
    "/setup-documents/xyz",
  ]) {
    assert.equal(shouldShowLogRunFab(path), false, `expected no FAB on ${path}`);
  }

  assert.equal(shouldShowLogRunFab(null), false);
  assert.equal(shouldShowLogRunFab(undefined), false);
});
