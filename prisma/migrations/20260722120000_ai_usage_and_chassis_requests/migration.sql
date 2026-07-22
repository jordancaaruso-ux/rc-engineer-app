-- Open-signup safety bar.
--
-- 1. "AiUsageDaily" — durable per-user AI spend ledger. The in-memory limiter in
--    src/lib/apiRateLimit.ts is per serverless instance, so it cannot cap spend; this can.
--    One row per (user, calendar day, feature), incremented atomically per AI call.
-- 2. "ChassisTypeRequest" — records a driver asking for a chassis type that isn't in the
--    admin-curated catalog, so the request reaches the founder instead of dying in a 403.

CREATE TABLE "AiUsageDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsageDaily_userId_day_feature_key" ON "AiUsageDaily"("userId", "day", "feature");
CREATE INDEX "AiUsageDaily_userId_day_idx" ON "AiUsageDaily"("userId", "day");

ALTER TABLE "AiUsageDaily" ADD CONSTRAINT "AiUsageDaily_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChassisTypeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChassisTypeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChassisTypeRequest_userId_normalizedName_key" ON "ChassisTypeRequest"("userId", "normalizedName");
CREATE INDEX "ChassisTypeRequest_resolvedAt_createdAt_idx" ON "ChassisTypeRequest"("resolvedAt", "createdAt");

ALTER TABLE "ChassisTypeRequest" ADD CONSTRAINT "ChassisTypeRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
