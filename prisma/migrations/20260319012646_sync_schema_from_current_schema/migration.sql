/*
  Warnings:

  - You are about to alter the column `lapTimes` on the `Run` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `data` on the `SetupSnapshot` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to drop the column `carId` on the `TireSet` table. All the data in the column will be lost.
  - You are about to drop the column `compound` on the `TireSet` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "FavouriteTrack" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "trackId"),
    CONSTRAINT "FavouriteTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FavouriteTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionLabel" TEXT,
    "sessionType" TEXT NOT NULL DEFAULT 'TESTING',
    "meetingSessionType" TEXT,
    "meetingSessionCode" TEXT,
    "carNameSnapshot" TEXT,
    "trackNameSnapshot" TEXT,
    "userId" TEXT NOT NULL,
    "carId" TEXT,
    "trackId" TEXT,
    "eventId" TEXT,
    "tireSetId" TEXT,
    "tireRunNumber" INTEGER NOT NULL DEFAULT 1,
    "setupSnapshotId" TEXT NOT NULL,
    "lapTimes" JSONB NOT NULL DEFAULT [],
    "notes" TEXT,
    "driverNotes" TEXT,
    "handlingProblems" TEXT,
    "suggestedChanges" TEXT,
    "appliedChanges" TEXT,
    CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_tireSetId_fkey" FOREIGN KEY ("tireSetId") REFERENCES "TireSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_setupSnapshotId_fkey" FOREIGN KEY ("setupSnapshotId") REFERENCES "SetupSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("appliedChanges", "carId", "createdAt", "driverNotes", "handlingProblems", "id", "lapTimes", "sessionLabel", "setupSnapshotId", "suggestedChanges", "tireRunNumber", "tireSetId", "trackId", "userId") SELECT "appliedChanges", "carId", "createdAt", "driverNotes", "handlingProblems", "id", "lapTimes", "sessionLabel", "setupSnapshotId", "suggestedChanges", "tireRunNumber", "tireSetId", "trackId", "userId" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE TABLE "new_SetupSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "carId" TEXT,
    "data" JSONB NOT NULL,
    CONSTRAINT "SetupSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SetupSnapshot_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SetupSnapshot" ("carId", "createdAt", "data", "id", "userId") SELECT "carId", "createdAt", "data", "id", "userId" FROM "SetupSnapshot";
DROP TABLE "SetupSnapshot";
ALTER TABLE "new_SetupSnapshot" RENAME TO "SetupSnapshot";
CREATE TABLE "new_TireSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "initialRunCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "TireSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TireSet" ("createdAt", "id", "label", "notes", "userId") SELECT "createdAt", "id", "label", "notes", "userId" FROM "TireSet";
DROP TABLE "TireSet";
ALTER TABLE "new_TireSet" RENAME TO "TireSet";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
