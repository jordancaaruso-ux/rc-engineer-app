/**
 * Run: `npx tsx src/components/layout/navConfig.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYSIS_HUB_LINKS,
  CATALOG_LINKS,
  DESKTOP_NAV,
  MOBILE_NAV,
  MORE_HUB_LINKS,
  NAV_ADD_RUN,
  NAV_SETTINGS,
  TOOLS_HUB_LINKS,
  catalogLinksForUser,
  resolveActiveMobileNavId,
  resolveActiveNavId,
  shouldShowLogRunFab,
} from "@/components/layout/navConfig";

test("mobile dock is five cells ending in More, without add-run or settings", () => {
  assert.deepEqual(
    MOBILE_NAV.map((item) => item.id),
    ["dashboard", "analysis", "engineer", "teams", "more"]
  );
  // The two that live outside the dock entirely: the log-run circle and the avatar.
  assert.equal(MOBILE_NAV.some((item) => item.id === "add-run"), false);
  assert.equal(MOBILE_NAV.some((item) => item.id === "settings"), false);
});

test("the desktop rail is seven destinations; add-run and settings are utilities", () => {
  assert.deepEqual(
    DESKTOP_NAV.map((item) => item.id),
    ["dashboard", "analysis", "engineer", "teams", "events", "assets", "tools"]
  );
  // The dock's four destinations lead, in the dock's order, so the rail and the
  // dock read the same left to right (founder call 2026-08-13).
  assert.deepEqual(
    DESKTOP_NAV.slice(0, 4).map((item) => item.id),
    MOBILE_NAV.filter((item) => item.id !== "more").map((item) => item.id)
  );
  // Both left the destination list for the rail's right-hand cluster — but they are
  // still defined here, so the cluster cannot drift from the nav.
  assert.equal(DESKTOP_NAV.some((item) => item.id === "add-run"), false);
  assert.equal(DESKTOP_NAV.some((item) => item.id === "settings"), false);
  assert.equal(NAV_ADD_RUN.href, "/runs/new");
  assert.equal(NAV_ADD_RUN.smartDraft, true);
  assert.equal(NAV_SETTINGS.href, "/settings");
});

test("everything the dock dropped is still reachable from /more", () => {
  const moreHrefs = MORE_HUB_LINKS.map((l) => l.href);
  assert.deepEqual(moreHrefs, ["/events", "/cars", "/tools"]);
  // Each door must land where its own desktop tab lands, or the two platforms
  // disagree about what "Garage" means.
  for (const id of ["events", "assets", "tools"] as const) {
    const tab = DESKTOP_NAV.find((item) => item.id === id);
    assert.ok(tab, `${id} missing from the rail`);
    assert.ok(moreHrefs.includes(tab.href), `${tab.href} is unreachable on mobile`);
  }
});

test("More stays lit while you are inside a section it owns", () => {
  // The fold: section id everywhere, dock cell in the dock.
  for (const path of ["/events", "/events/abc", "/cars", "/tools", "/setup/comparison"]) {
    assert.equal(resolveActiveMobileNavId(path), "more", `${path} should light More`);
  }
  assert.equal(resolveActiveMobileNavId("/more"), "more");
  // …and the five real cells are untouched by the fold.
  for (const path of ["/", "/analysis", "/runs/history", "/engineer", "/teams"]) {
    assert.equal(resolveActiveMobileNavId(path), resolveActiveNavId(path), `${path} folded wrongly`);
  }
  // Settings is not in the dock at all — it must not light More either.
  assert.equal(resolveActiveMobileNavId("/settings"), "settings");
  assert.equal(resolveActiveNavId("/more"), "more");
});

test("Analysis lands on the workbench at desktop and the card hub on the phone", () => {
  const desktop = DESKTOP_NAV.find((item) => item.id === "analysis");
  const mobile = MOBILE_NAV.find((item) => item.id === "analysis");
  assert.equal(desktop?.href, "/runs/history");
  assert.equal(mobile?.href, "/analysis");
  // Same section, same label, different destination — the tab must light either way.
  assert.equal(desktop?.label, "Analysis");
  assert.equal(mobile?.label, "Analysis");
  assert.equal(resolveActiveNavId("/runs/history"), "analysis");
  assert.equal(resolveActiveNavId("/analysis"), "analysis");
});

test("Tools has no dock cell; the phone reaches every tool two ways", () => {
  assert.ok(DESKTOP_NAV.some((item) => item.id === "tools"));
  assert.ok(!MOBILE_NAV.some((item) => item.id === "tools"));
  // Still doors on the phone's Analysis hub — the /more route added a second way in,
  // it did not take this one away.
  const analysisHrefs = new Set(ANALYSIS_HUB_LINKS.map((l) => l.href));
  for (const link of TOOLS_HUB_LINKS) {
    assert.ok(analysisHrefs.has(link.href), `${link.href} is unreachable on mobile`);
  }
  assert.ok(MORE_HUB_LINKS.some((l) => l.href === "/tools"));
});

test("tool routes light Tools, not Analysis — longest prefix wins", () => {
  assert.equal(resolveActiveNavId("/tools"), "tools");
  assert.equal(resolveActiveNavId("/setup/comparison"), "tools");
  // Lives under /analysis but scores longer against the Tools list.
  assert.equal(resolveActiveNavId("/analysis/roll-center"), "tools");
  // …and the hub itself must not get dragged along with it.
  assert.equal(resolveActiveNavId("/analysis"), "analysis");
});

test("events own their tab — /events no longer lights Garage (2026-07-29)", () => {
  assert.equal(resolveActiveNavId("/events"), "events");
  assert.equal(resolveActiveNavId("/events/abc123"), "events");
  // The Garage prefix list used to swallow /events; keep it out for good.
  assert.notEqual(resolveActiveNavId("/events"), "assets");
  // Its tab is the rail's now — the phone reaches it through More (2026-08-12).
  const events = DESKTOP_NAV.find((item) => item.id === "events");
  assert.equal(events?.href, "/events");
  assert.equal(events?.label, "Events");
});

test("the Garage tab lands on the cars list, not a hub (2026-07-29)", () => {
  const garage = DESKTOP_NAV.find((item) => item.id === "assets");
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
