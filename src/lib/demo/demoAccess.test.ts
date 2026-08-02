/**
 * Run: `npm run test:demo`
 *
 * Locks the demo read-only decision the edge middleware enforces. The stakes: a false
 * "allow" lets an anonymous visitor mutate the shared demo garage; a false "forbid" breaks
 * the demo's one selling interaction (the Engineer chat). And an unset env must NEVER mark
 * anyone as demo — the feature is dark until launch.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideDemoRequest, isDemoIdentity } from "@/lib/demo/demoAccess";

const env = { DEMO_USER_ID: "demo0000000000000000user1", DEMO_USER_EMAIL: "demo@jrcdynamics.com" };

test("reads are always allowed", () => {
  assert.equal(decideDemoRequest({ method: "GET", pathname: "/api/runs" }), "allow");
  assert.equal(decideDemoRequest({ method: "get", pathname: "/api/runs" }), "allow");
  assert.equal(decideDemoRequest({ method: "HEAD", pathname: "/runs" }), "allow");
  assert.equal(decideDemoRequest({ method: "OPTIONS", pathname: "/api/anything" }), "allow");
});

test("writes are forbidden — API routes, thread deletes, and page-path server actions", () => {
  assert.equal(decideDemoRequest({ method: "POST", pathname: "/api/runs" }), "forbid");
  assert.equal(decideDemoRequest({ method: "PATCH", pathname: "/api/cars/abc" }), "forbid");
  assert.equal(
    decideDemoRequest({ method: "DELETE", pathname: "/api/engineer/threads/t1" }),
    "forbid",
  );
  assert.equal(
    decideDemoRequest({ method: "POST", pathname: "/setup-sheet-models/abc" }),
    "forbid",
  );
});

test("the Engineer chat is the one allowed write — exact path only", () => {
  assert.equal(decideDemoRequest({ method: "POST", pathname: "/api/engineer/chat" }), "allow");
  assert.equal(
    decideDemoRequest({ method: "POST", pathname: "/api/engineer/chat/extra" }),
    "forbid",
  );
  assert.equal(decideDemoRequest({ method: "POST", pathname: "/api/engineer/quick-fix" }), "forbid");
});

test("isDemoIdentity matches by id, and by email case-insensitively", () => {
  assert.equal(isDemoIdentity({ id: "demo0000000000000000user1" }, env), true);
  assert.equal(isDemoIdentity({ email: "Demo@JRCdynamics.com" }, env), true);
  assert.equal(isDemoIdentity({ id: "someone-else", email: "x@y.com" }, env), false);
});

test("unset env ⇒ nobody is demo, ever", () => {
  assert.equal(isDemoIdentity({ id: "demo0000000000000000user1", email: "demo@jrcdynamics.com" }, {}), false);
  assert.equal(isDemoIdentity({ id: undefined, email: undefined }, {}), false);
  // Empty strings in env must not match empty identity fields.
  assert.equal(
    isDemoIdentity({ id: "", email: "" }, { DEMO_USER_ID: "", DEMO_USER_EMAIL: "" }),
    false,
  );
});
