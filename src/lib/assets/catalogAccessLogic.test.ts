/**
 * Run: `npx tsx src/lib/assets/catalogAccessLogic.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageCatalogRow, mightManageCatalogRow } from "@/lib/assets/catalogAccessLogic";

const creator = { id: "u1", email: "creator@example.com" };
const other = { id: "u2", email: "other@example.com" };
const admin = { id: "u3", email: "admin@example.com" };

function withAdminEnv<T>(fn: () => T): T {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    return fn();
  } finally {
    process.env.AUTH_ADMIN_EMAILS = prev;
  }
}

test("creator may manage an unverified, unused row", () => {
  assert.equal(
    canManageCatalogRow(creator, { creatorUserId: "u1", verified: false, usedByOthers: false }),
    true
  );
});

test("creator may NOT manage once used by others", () => {
  assert.equal(
    canManageCatalogRow(creator, { creatorUserId: "u1", verified: false, usedByOthers: true }),
    false
  );
});

test("creator may NOT manage once verified", () => {
  assert.equal(
    canManageCatalogRow(creator, { creatorUserId: "u1", verified: true, usedByOthers: false }),
    false
  );
});

test("non-creator may never manage (non-admin)", () => {
  assert.equal(
    canManageCatalogRow(other, { creatorUserId: "u1", verified: false, usedByOthers: false }),
    false
  );
});

test("seeded row (null creator) is not manageable by a non-admin", () => {
  assert.equal(
    canManageCatalogRow(creator, { creatorUserId: null, verified: false, usedByOthers: false }),
    false
  );
});

test("admin may manage anything, including verified + used", () => {
  withAdminEnv(() => {
    assert.equal(
      canManageCatalogRow(admin, { creatorUserId: "u1", verified: true, usedByOthers: true }),
      true
    );
  });
});

test("mightManageCatalogRow ignores usedByOthers for optimistic UI", () => {
  assert.equal(
    mightManageCatalogRow(creator, { creatorUserId: "u1", verified: false }),
    true
  );
  assert.equal(
    mightManageCatalogRow(creator, { creatorUserId: "u1", verified: true }),
    false
  );
});
