-- A setup remembers the sheet PAPER it was born on.
--
-- A chassis can hold several editions of one printed sheet (same paper, republished with renamed
-- boxes). Since the editions were aligned to the canonical vocabulary (2026-08-31), every sheet's
-- boxes carry the same keys — which fixed understanding but erased the only signal the display
-- pick had for WHICH paper to draw (`pickSheetBlankForData` counted key overlap, and everything
-- ties now). The founder's ruling: "if someone uploads a pdf, that same pdf style is what they see
-- in the app, always." So the provenance becomes explicit: stamped at import from the resolved
-- calibration's edition blank, inherited by every copy of the setup, read first by the pick.
--
-- Nullable, no default and no backfill here: null means the primary blank, which is exactly what
-- every pre-existing snapshot renders on today. The known edition-born rows are stamped by
-- `scripts/backfill-a800rr-sheet-provenance.ts`. SET NULL on delete: a retired edition's setups
-- fall back to the primary paper rather than a dead pointer.

-- AlterTable
ALTER TABLE "SetupSnapshot" ADD COLUMN     "sheetBlankId" TEXT;

-- CreateIndex
CREATE INDEX "SetupSnapshot_sheetBlankId_idx" ON "SetupSnapshot"("sheetBlankId");

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_sheetBlankId_fkey" FOREIGN KEY ("sheetBlankId") REFERENCES "SetupSheetBlank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
