/*
  Warnings:

  - Added the required column `userId` to the `Track` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "email" DROP NOT NULL;

-- Ensure deterministic default user exists (single-user compatibility bridge).
INSERT INTO "User" ("id", "email", "name")
VALUES ('local_user', 'local@rc.engineer', 'Local User')
ON CONFLICT ("email") DO UPDATE
SET "name" = EXCLUDED."name";

-- Backfill all existing tracks to the default user.
UPDATE "Track"
SET "userId" = (
  SELECT "id"
  FROM "User"
  WHERE "email" = 'local@rc.engineer'
  LIMIT 1
)
WHERE "userId" IS NULL;

-- Now enforce required ownership.
ALTER TABLE "Track" ALTER COLUMN "userId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
