-- Per-user event participation: optional controlled/spec additive (mirrors controlledTireTypeId).

ALTER TABLE "EventParticipation" ADD COLUMN "controlledAdditiveTypeId" TEXT;

ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_controlledAdditiveTypeId_fkey"
  FOREIGN KEY ("controlledAdditiveTypeId") REFERENCES "AdditiveType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
