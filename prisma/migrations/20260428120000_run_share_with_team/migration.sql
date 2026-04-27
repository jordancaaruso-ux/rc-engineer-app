-- Per-run: hide from mutual team lists when false; TeammateLink unaffected.

ALTER TABLE "Run" ADD COLUMN "shareWithTeam" BOOLEAN NOT NULL DEFAULT true;
