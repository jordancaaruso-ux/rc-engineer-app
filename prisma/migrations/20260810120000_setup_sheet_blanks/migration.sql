-- CreateTable
CREATE TABLE "SetupSheetBlank" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'driver',
    "setupSheetModelId" TEXT,
    "setupDocumentId" TEXT,
    "uploadedByUserId" TEXT,
    "chassisNameTyped" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "boxesJson" JSONB,
    "statsJson" JSONB,
    "pageImagesJson" JSONB,
    "boxNameSuggestionsJson" JSONB,
    "fillSurface" TEXT NOT NULL DEFAULT 'sheet',
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SetupSheetBlank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetupSheetBlank_setupSheetModelId_key" ON "SetupSheetBlank"("setupSheetModelId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupSheetBlank_setupDocumentId_key" ON "SetupSheetBlank"("setupDocumentId");

-- CreateIndex
CREATE INDEX "SetupSheetBlank_status_reviewedAt_createdAt_idx" ON "SetupSheetBlank"("status", "reviewedAt", "createdAt");

-- CreateIndex
CREATE INDEX "SetupSheetBlank_normalizedName_idx" ON "SetupSheetBlank"("normalizedName");

-- AddForeignKey
ALTER TABLE "SetupSheetBlank" ADD CONSTRAINT "SetupSheetBlank_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSheetBlank" ADD CONSTRAINT "SetupSheetBlank_setupDocumentId_fkey" FOREIGN KEY ("setupDocumentId") REFERENCES "SetupDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSheetBlank" ADD CONSTRAINT "SetupSheetBlank_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

