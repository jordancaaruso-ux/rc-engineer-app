/*
  Warnings:

  - You are about to alter the column `lapTimes` on the `Run` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `data` on the `SetupSnapshot` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionLabel" TEXT,
    "userId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "trackId" TEXT,
    "tireSetId" TEXT,
    "tireRunNumber" INTEGER NOT NULL DEFAULT 1,
    "setupSnapshotId" TEXT NOT NULL,
    "lapTimes" TEXT NOT NULL DEFAULT '[]',
    "driverNotes" TEXT,
    "handlingProblems" TEXT,
    "suggestedChanges" TEXT,
    "appliedChanges" TEXT,
    CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
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
    "carId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "SetupSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SetupSnapshot_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SetupSnapshot" ("carId", "createdAt", "data", "id", "userId") SELECT "carId", "createdAt", "data", "id", "userId" FROM "SetupSnapshot";
DROP TABLE "SetupSnapshot";
ALTER TABLE "new_SetupSnapshot" RENAME TO "SetupSnapshot";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
