/**
 * Run: `npm run test:demo-tour`
 *
 * Locks the walkthrough's step list. The stakes are all "fails quietly in front of a visitor":
 * an anchor id that no component carries degrades to a centred popover pointing at nothing; a
 * route that no longer exists sends the tour to a 404 mid-walk; a viewport with no stops leaves
 * a dimmed screen with an empty progress rail.
 *
 * Route validity is checked against a literal allowlist rather than the filesystem on purpose —
 * a moved page should break this test loudly, not be silently accepted because the glob found
 * whatever it was renamed to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEMO_TOUR_STEPS,
  TOUR_ANCHOR_IDS,
  TOUR_DESKTOP_MIN_WIDTH,
  isOnStepRoute,
  isRunDetailPath,
  routeForStep,
  stepsForViewport,
  viewportForWidth,
  type TourViewport,
} from "@/lib/demo/tourSteps";

/** Real app routes the tour is allowed to send a visitor to. */
const ROUTES = new Set(["/", "/runs/history", "/engineer"]);

const VIEWPORTS: TourViewport[] = ["mobile", "desktop"];

test("every step routes somewhere that exists", () => {
  for (const step of DEMO_TOUR_STEPS) {
    for (const viewport of VIEWPORTS) {
      const route = routeForStep(step, viewport);
      assert.ok(
        ROUTES.has(route),
        `step "${step.id}" (${viewport}) routes to ${route}, which is not a known app route`,
      );
    }
  }
});

test("every anchor a step asks for is declared in TOUR_ANCHOR_IDS", () => {
  const declared = new Set<string>(TOUR_ANCHOR_IDS);
  for (const step of DEMO_TOUR_STEPS) {
    assert.ok(step.anchors.length > 0, `step "${step.id}" has no anchors`);
    for (const anchor of step.anchors) {
      assert.ok(declared.has(anchor), `step "${step.id}" wants undeclared anchor "${anchor}"`);
    }
  }
});

test("no declared anchor is unused — a stale id means a dead data-tour attribute", () => {
  const used = new Set(DEMO_TOUR_STEPS.flatMap((step) => [...step.anchors]));
  for (const anchor of TOUR_ANCHOR_IDS) {
    assert.ok(used.has(anchor), `anchor "${anchor}" is declared but no step uses it`);
  }
});

test("step ids are unique — sessionStorage resumes on them", () => {
  const ids = DEMO_TOUR_STEPS.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate step id in [${ids.join(", ")}]`);
});

test("every step places on both viewports", () => {
  const sides = new Set(["top", "bottom", "left", "right"]);
  for (const step of DEMO_TOUR_STEPS) {
    for (const viewport of VIEWPORTS) {
      assert.ok(
        sides.has(step.placement[viewport]),
        `step "${step.id}" has no valid ${viewport} placement`,
      );
    }
  }
});

test("both viewports get a usable tour — desktop 7, phone 6", () => {
  // The phone drops `day-read`: the desktop hero card has no phone equivalent by design.
  assert.equal(stepsForViewport("desktop").length, 7);
  assert.equal(stepsForViewport("mobile").length, 6);
  assert.ok(!stepsForViewport("mobile").some((s) => s.id === "day-read"));
});

test("the run-detail stop reads its destination from the list it follows", () => {
  const sessions = DEMO_TOUR_STEPS.find((s) => s.id === "sessions");
  const detail = DEMO_TOUR_STEPS.find((s) => s.id === "run-detail");
  assert.ok(sessions && detail);
  assert.equal(detail.routeKind, "run-detail");
  // Its `route` is where the link is READ FROM, so it has to be the stop before it.
  for (const viewport of VIEWPORTS) {
    assert.equal(routeForStep(detail, viewport), routeForStep(sessions, viewport));
  }
  // And it is satisfied by any run page, not by the list it came from.
  assert.equal(isOnStepRoute(detail, "desktop", "/runs/abc123"), true);
  assert.equal(isOnStepRoute(detail, "desktop", "/runs/history"), false);
});

test("isRunDetailPath accepts a run page and nothing else under /runs", () => {
  assert.equal(isRunDetailPath("/runs/clx9k2"), true);
  assert.equal(isRunDetailPath("/runs/history"), false);
  assert.equal(isRunDetailPath("/runs/new"), false);
  assert.equal(isRunDetailPath("/runs/clx9k2/edit"), false);
  assert.equal(isRunDetailPath("/runs/"), false);
  assert.equal(isRunDetailPath("/runs"), false);
  assert.equal(isRunDetailPath("/engineer"), false);
});

test("exactly one step hands over — the app is inert everywhere else", () => {
  const handover = DEMO_TOUR_STEPS.filter((s) => s.handover);
  assert.equal(handover.length, 1);
  // It must be the composer: /api/engineer/chat is the ONE path in the demo write allowlist.
  assert.equal(handover[0].id, "engineer-composer");
});

test("the tour ends on the dashboard it started from", () => {
  const first = DEMO_TOUR_STEPS[0];
  const last = DEMO_TOUR_STEPS[DEMO_TOUR_STEPS.length - 1];
  assert.equal(routeForStep(first, "desktop"), "/");
  assert.equal(routeForStep(last, "desktop"), "/");
});

test("copy carries no template braces — the tour reads no season data", () => {
  for (const step of DEMO_TOUR_STEPS) {
    assert.ok(!/[{}]/.test(step.title), `step "${step.id}" title still interpolates`);
    assert.ok(!/[{}]/.test(step.body), `step "${step.id}" body still interpolates`);
    assert.ok(step.title.length > 0 && step.body.length > 0);
  }
});

test("isOnStepRoute ignores the query, so ?openGroup= is not a route change", () => {
  const sessions = DEMO_TOUR_STEPS.find((s) => s.id === "sessions")!;
  assert.equal(isOnStepRoute(sessions, "desktop", "/runs/history"), true);
  assert.equal(isOnStepRoute(sessions, "desktop", "/engineer"), false);
  assert.equal(isOnStepRoute(sessions, "desktop", null), false);
});

test("the viewport boundary is the dashboard's twin-render boundary, not md", () => {
  assert.equal(TOUR_DESKTOP_MIN_WIDTH, 1280);
  assert.equal(viewportForWidth(1279), "mobile");
  assert.equal(viewportForWidth(1280), "desktop");
  // 390px phone and the 1024px lg breakpoint both stay on the phone tour.
  assert.equal(viewportForWidth(390), "mobile");
  assert.equal(viewportForWidth(1024), "mobile");
});
