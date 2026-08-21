/**
 * Run: `npx tsx src/components/layout/navConfig.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOG_LINKS,
  DESKTOP_NAV,
  MOBILE_NAV,
  NAV_ADD_RUN,
  NAV_SETTINGS,
  catalogLinksForUser,
  foldMobileNavId,
  resolveActiveMobileNavId,
  resolveActiveNavId,
  shouldShowLogRunFab,
} from "@/components/layout/navConfig";

test("mobile dock is five cells, every one a place", () => {
  assert.deepEqual(
    MOBILE_NAV.map((item) => item.id),
    ["dashboard", "analysis", "engineer", "paddock", "tools"]
  );
  // Five is the budget's ceiling: 60px a cell at 390px, which is where the labels still fit.
  // A sixth costs ~10px off every one and truncates "Dashboard".
  assert.equal(MOBILE_NAV.length, 5);
  // No menu word in the dock. `More` held a cell while being a list of doors rather than a
  // destination — the whole point of the 2026-08-18 restructure was to spend that cell on a
  // place instead.
  assert.equal(
    MOBILE_NAV.some((item) => item.href === "/more"),
    false
  );
  // The two that live outside the dock entirely: the log-run circle and the avatar.
  assert.equal(
    MOBILE_NAV.some((item) => item.id === "add-run"),
    false
  );
  assert.equal(
    MOBILE_NAV.some((item) => item.id === "settings"),
    false
  );
});

test("the desktop rail is five destinations; add-run and settings are utilities", () => {
  assert.deepEqual(
    DESKTOP_NAV.map((item) => item.id),
    ["dashboard", "analysis", "engineer", "paddock", "tools"]
  );
  /*
   * The two platforms carry the SAME five ids in the SAME order (2026-08-19) — a first for
   * this app. Tools was the last id that lived on one and not the other, and both of the
   * workarounds that gap produced (the `More` drawer, then Analysis lighting up for Tools)
   * cost more to explain than the tab they saved. Keep them identical.
   */
  assert.deepEqual(
    DESKTOP_NAV.map((item) => item.id),
    MOBILE_NAV.map((item) => item.id)
  );
  // Both left the destination list for the rail's right-hand cluster — but they are
  // still defined here, so the cluster cannot drift from the nav.
  assert.equal(
    DESKTOP_NAV.some((item) => item.id === "add-run"),
    false
  );
  assert.equal(
    DESKTOP_NAV.some((item) => item.id === "settings"),
    false
  );
  assert.equal(NAV_ADD_RUN.href, "/runs/new");
  assert.equal(NAV_ADD_RUN.smartDraft, true);
  assert.equal(NAV_SETTINGS.href, "/settings");
});

test("everything the dropped cells held now lights Paddock", () => {
  // Garage, Events and the track catalog were a dock cell, a rail tab and a Settings row.
  // They are one section now, so every one of these paths must light the same cell — if any
  // of them scored elsewhere, a driver deep in Paddock would watch the dock go dark.
  for (const path of ["/paddock", "/cars", "/events", "/events/abc", "/tracks", "/setup-documents"]) {
    assert.equal(resolveActiveNavId(path), "paddock", `${path} should light Paddock`);
  }
  // Legacy hub routes still light it — both redirect to /cars.
  assert.equal(resolveActiveNavId("/assets"), "paddock");
  assert.equal(resolveActiveNavId("/garage"), "paddock");
});

test("there is no mobile fold left — every section lights its own cell on both platforms", () => {
  /*
   * Tools was the last id that differed between the platforms: it had a desktop tab and no
   * phone cell, so `/analysis/roll-center` lit `Analysis` — the cell whose page happened to
   * carry the door. Giving Tools the cell Paddock freed removes the reason for the lie.
   */
  for (const path of ["/tools", "/setup/comparison", "/analysis/roll-center", "/videos", "/laps/import"]) {
    assert.equal(resolveActiveMobileNavId(path), "tools", `${path} should light Tools`);
    assert.equal(resolveActiveNavId(path), "tools", `${path} is the Tools section`);
  }
  // The fold is the identity now. Asserted on the function itself, not just through paths:
  // re-introducing a special case has to break a test that says so out loud.
  for (const path of ["/", "/analysis", "/runs/history", "/engineer", "/cars", "/events", "/tools"]) {
    assert.equal(resolveActiveMobileNavId(path), resolveActiveNavId(path), `${path} folded`);
  }
  for (const id of ["dashboard", "analysis", "engineer", "paddock", "tools", "settings", "teams", "add-run"] as const) {
    assert.equal(foldMobileNavId(id), id, `${id} should not fold`);
  }
  assert.equal(foldMobileNavId(null), null);
  // Settings and Teams are not in the dock at all — they must not borrow a cell either.
  assert.equal(resolveActiveMobileNavId("/settings"), "settings");
  assert.equal(resolveActiveMobileNavId("/teams"), "teams");
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

test("Tools owns a cell on both platforms", () => {
  const desktop = DESKTOP_NAV.find((item) => item.id === "tools");
  const mobile = MOBILE_NAV.find((item) => item.id === "tools");
  // Same destination either way — unlike Analysis, Tools has one page and no workbench split.
  assert.equal(desktop?.href, "/tools");
  assert.equal(mobile?.href, "/tools");
  assert.equal(desktop?.label, "Tools");
  assert.equal(mobile?.label, "Tools");
});

test("tool routes light Tools, not Analysis — longest prefix wins", () => {
  assert.equal(resolveActiveNavId("/tools"), "tools");
  assert.equal(resolveActiveNavId("/setup/comparison"), "tools");
  // Lives under /analysis but scores longer against the Tools list.
  assert.equal(resolveActiveNavId("/analysis/roll-center"), "tools");
  // …and the hub itself must not get dragged along with it.
  assert.equal(resolveActiveNavId("/analysis"), "analysis");
  // `/setup/comparison` scores longer than the Paddock list's `/setup` — the bench is a tool,
  // the sheet is a setup, and they share a prefix.
  assert.equal(resolveActiveNavId("/setup/abc"), "paddock");
});

test("the two benches that had no section now have one", () => {
  /*
   * `/videos/analysis` used to sit in ANALYSIS_PREFIXES and out-score `/videos`, which split
   * one workshop across two cells: the library lit nothing and opening a job lit Analysis.
   * The whole of `/videos` is Tools now — the results still read on the run, which is Analysis.
   */
  assert.equal(resolveActiveNavId("/videos"), "tools");
  assert.equal(resolveActiveNavId("/videos/analysis"), "tools");
  assert.equal(resolveActiveNavId("/videos/analysis/jobs/abc"), "tools");
  assert.equal(resolveActiveNavId("/videos/overlay"), "tools");
  // A run is still Analysis, wherever its video was made.
  assert.equal(resolveActiveNavId("/runs/abc"), "analysis");
  // `/laps/import` had no section at all — its only door in the app was one dashboard link.
  assert.equal(resolveActiveNavId("/laps/import"), "tools");
});

test("the Paddock tab lands on its own page, not on the cars list", () => {
  const paddock = DESKTOP_NAV.find((item) => item.id === "paddock");
  assert.equal(paddock?.href, "/paddock");
  assert.equal(paddock?.label, "Paddock");
  // Named Paddock, not Garage: it holds tracks and meetings, and neither is equipment.
  assert.equal(
    DESKTOP_NAV.some((item) => item.label === "Garage"),
    false
  );
});

test("catalogs are Settings-only reference data; tracks are not a catalog", () => {
  const hrefs = CATALOG_LINKS.map((l) => l.href);
  assert.deepEqual(hrefs, [
    "/setup-sheet-models",
    "/tires",
    "/additives",
    "/setup-calibrations",
  ]);
  // Tracks left this list on 2026-08-18. You pick one every time you log a run or book a
  // meeting; it belongs with the things a run points at, not with the tidy-up catalogs.
  assert.equal(hrefs.includes("/tracks"), false);
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

test("Teams keeps its routes without keeping a tab", () => {
  // The section id survives so the route resolves; no nav list carries it any more, because
  // creating and joining a team is configuration and lives in Settings (2026-08-18).
  assert.equal(resolveActiveNavId("/teams"), "teams");
  assert.equal(resolveActiveNavId("/teams/abc"), "teams");
  // Team admin lives at /teams/<id>/settings — it must not light up the Settings tab.
  assert.equal(resolveActiveNavId("/teams/abc/settings"), "teams");
  assert.equal(resolveActiveNavId("/settings"), "settings");
  assert.equal(resolveActiveNavId("/settings/danger"), "settings");
  assert.equal(
    [...MOBILE_NAV, ...DESKTOP_NAV].some((item) => item.id === "teams"),
    false
  );
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
  assert.equal(resolveActiveNavId("/cars"), "paddock");
});

test("shouldShowLogRunFab is visible on destinations, hidden inside create/edit flows", () => {
  // Visible: dashboard, hubs, lists, analysis, engineer.
  for (const path of [
    "/",
    "/analysis",
    "/runs/history",
    "/engineer",
    "/teams",
    "/paddock",
    "/assets",
    "/cars",
    "/setup-documents", // the list stays; only the editor detail hides
    "/setup-sheet-models",
  ]) {
    assert.equal(shouldShowLogRunFab(path), true, `expected FAB on ${path}`);
  }

  // Hidden: you're already logging, or in an editor with its own Save.
  for (const path of ["/runs/new", "/runs/abc/edit", "/setup-documents/xyz"]) {
    assert.equal(shouldShowLogRunFab(path), false, `expected no FAB on ${path}`);
  }

  assert.equal(shouldShowLogRunFab(null), false);
  assert.equal(shouldShowLogRunFab(undefined), false);
});
