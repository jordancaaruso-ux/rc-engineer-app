-- Server-side drafts for the sequential setup fill.
--
-- Strictly additive: one new table, no column added to and nothing dropped from any existing one.
-- That is the whole point of the design (founder call 2026-08-02) — a half-filled sheet lives in a
-- table no existing query names, so it cannot leak into the Engineer's prompt builders, a car's
-- setup library, or the community aggregations. No read site anywhere needs a new draft filter.
--
-- Subject is exactly one of carId (a driver filling a setup on their car) or setupSheetModelId (an
-- admin authoring a global baseline). The two unique indexes below each bind only the rows whose
-- own subject column is non-null: Postgres treats NULLs as distinct, so driver rows never collide
-- with admin rows and vice versa. The "exactly one" half is the CHECK — Prisma has no syntax for
-- it, and its migration engine neither introspects nor drops check constraints, so it survives
-- `prisma db push` without showing up as drift.

-- CreateTable
CREATE TABLE "SetupFillDraft" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "carId" TEXT,
    "setupSheetModelId" TEXT,
    "data" JSONB NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "pendingText" TEXT,
    "pendingStepKey" TEXT,
    "name" TEXT,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,

    CONSTRAINT "SetupFillDraft_pkey" PRIMARY KEY ("id")
);

-- One draft per driver per car. Admin rows (carId IS NULL) are invisible to this index.
CREATE UNIQUE INDEX "SetupFillDraft_userId_carId_key" ON "SetupFillDraft"("userId", "carId");

-- One draft per admin per chassis. Driver rows (setupSheetModelId IS NULL) are invisible to this one.
CREATE UNIQUE INDEX "SetupFillDraft_userId_setupSheetModelId_key" ON "SetupFillDraft"("userId", "setupSheetModelId");

-- Resume lookups, and any future "your open drafts" list.
CREATE INDEX "SetupFillDraft_userId_updatedAt_idx" ON "SetupFillDraft"("userId", "updatedAt");

-- Exactly one subject. A row with both set would satisfy both unique indexes while meaning nothing.
ALTER TABLE "SetupFillDraft" ADD CONSTRAINT "SetupFillDraft_one_subject"
    CHECK (("carId" IS NULL) <> ("setupSheetModelId" IS NULL));

-- AddForeignKey
ALTER TABLE "SetupFillDraft" ADD CONSTRAINT "SetupFillDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade, not the SetNull that SetupSnapshot.carId uses: a snapshot is history and outlives its
-- car; an unfinished fill is an action and does not.
ALTER TABLE "SetupFillDraft" ADD CONSTRAINT "SetupFillDraft_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SetupFillDraft" ADD CONSTRAINT "SetupFillDraft_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
