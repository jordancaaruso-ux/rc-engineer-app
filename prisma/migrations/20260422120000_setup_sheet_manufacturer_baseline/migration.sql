-- CreateTable
CREATE TABLE "SetupSheetManufacturerBaseline" (
    "setupSheetTemplate" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "summary" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupSheetManufacturerBaseline_pkey" PRIMARY KEY ("setupSheetTemplate")
);
