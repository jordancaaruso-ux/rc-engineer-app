-- Persist admin-removed global catalog chassis slugs so seed does not recreate them.

CREATE TABLE "SetupSheetCatalogSuppression" (
    "slug" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suppressedBy" TEXT,

    CONSTRAINT "SetupSheetCatalogSuppression_pkey" PRIMARY KEY ("slug")
);
