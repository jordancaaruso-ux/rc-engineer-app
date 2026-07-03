-- Wear-first tire identity (v2): the anchor-label design was superseded before shipping.
-- A set's identity is now derived (run count + session chain from its runs), so the
-- stamped anchor column goes away. IF EXISTS keeps this safe on databases that never
-- applied the add migration.
ALTER TABLE "TireSet" DROP COLUMN IF EXISTS "anchorLabel";
