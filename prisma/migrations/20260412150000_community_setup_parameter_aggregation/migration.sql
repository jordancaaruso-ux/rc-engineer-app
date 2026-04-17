-- CreateTable
CREATE TABLE "CommunitySetupParameterAggregation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "setupSheetTemplate" TEXT NOT NULL,
    "parameterKey" TEXT NOT NULL,
    "valueType" "SetupAggregationValueType" NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "numericStatsJson" JSONB,
    "categoricalStatsJson" JSONB,

    CONSTRAINT "CommunitySetupParameterAggregation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunitySetupParameterAggregation_setupSheetTemplate_parameterKey_key" ON "CommunitySetupParameterAggregation"("setupSheetTemplate", "parameterKey");

-- CreateIndex
CREATE INDEX "CommunitySetupParameterAggregation_setupSheetTemplate_idx" ON "CommunitySetupParameterAggregation"("setupSheetTemplate");
