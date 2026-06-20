/**
 * Run: npx tsx src/lib/engineerFeedback/adminFeedbackAccess.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const ORIGINAL = process.env.AUTH_ADMIN_EMAILS;

test("canSubmitEngineerFeedback allows only AUTH_ADMIN_EMAILS", async () => {
  process.env.AUTH_ADMIN_EMAILS = "founder@example.com";
  const { canSubmitEngineerFeedback, adminFeedbackRatingWhere } = await import(
    "@/lib/engineerFeedback/adminFeedbackAccess"
  );

  assert.equal(canSubmitEngineerFeedback("founder@example.com"), true);
  assert.equal(canSubmitEngineerFeedback("Founder@Example.com"), true);
  assert.equal(canSubmitEngineerFeedback("tester@example.com"), false);
  assert.equal(canSubmitEngineerFeedback(null), false);

  const where = adminFeedbackRatingWhere();
  assert.deepEqual(where, {
    user: {
      email: { in: ["founder@example.com"], mode: "insensitive" },
    },
  });
});

test("adminFeedbackRatingWhere returns impossible filter when no admins configured", async () => {
  process.env.AUTH_ADMIN_EMAILS = "";
  const { adminFeedbackRatingWhere } = await import("@/lib/engineerFeedback/adminFeedbackAccess");
  assert.deepEqual(adminFeedbackRatingWhere(), { userId: "__no_admin_configured__" });
});

test.after(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_ADMIN_EMAILS;
  else process.env.AUTH_ADMIN_EMAILS = ORIGINAL;
});
