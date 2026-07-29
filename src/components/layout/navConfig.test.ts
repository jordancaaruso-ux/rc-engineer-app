/**
 * Run: `npx tsx src/components/layout/navConfig.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOG_LINKS,
  MOBILE_NAV,
  catalogLinksForUser,
  resolveActiveNavId,
  shouldShowLogRunFab,
} from "@/components/layout/navConfig";

test("mobile dock is six pure destinations, in order, without add-run or settings", () => {
  assert.deepEqual(
    MOBILE_NAV.map((item) => item.id),
    ["dashboard", "analysis", "events", "engineer", "assets", "teams"]
  );
});

test("events own their tab — /events no longer lights Garage (2026-07-29)", () => {
  assert.equal(resolveActiveNavId("/events"), "events");
  assert.equal(resolveActiveNavId("/events/abc123"), "events");
  // The Garage prefix list used to swallow /events; keep it out for good.
  assert.notEqual(resolveActiveNavId("/events"), "assets");
  const events = MOBILE_NAV.find((item) => item.id === "events");
  assert.equal(events?.href, "/events");
  assert.equal(events?.label, "Events");
});

test("the Garage tab lands on the cars list, not a hub (2026-07-29)", () => {
  const garage = MOBILE_NAV.find((item) => item.id === "assets");
  assert.equal(garage?.href, "/cars");
  assert.equal(garage?.label, "Garage");
  // Legacy hub routes still light the tab — both redirect to /cars.
  assert.equal(resolveActiveNavId("/assets"), "assets");
  assert.equal(resolveActiveNavId("/garage"), "assets");
});

test("catalogs are Settings-only reference data, calibrations admin-gated", () => {
  const hrefs = CATALOG_LINKS.map((l) => l.href);
  assert.deepEqual(hrefs, [
    "/setup-sheet-models",
    "/tracks",
    "/tires",
    "/additives",
    "/setup-calibrations",
  ]);
  // Tires are picker-only in the daily loop — one catalog entry, never a "my tires" asset.
  assert.equal(hrefs.filter((h) => h === "/tires").length, 1);
  assert.equal(hrefs.includes("/cars"), false);
  assert.equal(hrefs.includes("/events"), false);
  assert.equal(
    catalogLinksForUser(false).some((l) => l.href === "/setup-calibrations"),
    false
  );
  assert.equal(
    catalogLinksForUser(true).some((l) => l.href === "/setup-calibrations"),
    true
  );
});

test("resolveActiveNavId splits /teams from /settings (Teams is its own tab now)", () => {
  assert.equal(resolveActiveNavId("/teams"), "teams");
  assert.equal(resolveActiveNavId("/teams/abc"), "teams");
  // Team admin lives at /teams/<id>/settings — it must not light up the Settings tab.
  assert.equal(resolveActiveNavId("/teams/abc/settings"), "teams");
  assert.equal(resolveActiveNavId("/settings"), "settings");
  assert.equal(resolveActiveNavId("/settings/danger"), "settings");
});

test("resolveActiveNavId still maps the core routes", () => {
  assert.equal(resolveActiveNavId("/"), "dashboard");
  assert.equal(resolveActiveNavId("/runs/new"), "add-run");
  assert.equal(resolveActiveNavId("/runs/abc/edit"), "add-run");
  assert.equal(resolveActiveNavId("/analysis"), "analysis");
  assert.equal(resolveActiveNavId("/runs/history"), "analysis");
  // The run view (`/runs/<id>`) is a viewing surface — Analysis, not Add-run.
  assert.equal(resolveActiveNavId("/runs/abc"), "analysis");
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
