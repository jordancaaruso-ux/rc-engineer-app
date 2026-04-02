-- CreateEnum
CREATE TYPE "SetupAggregationScopeType" AS ENUM ('CAR_PARAMETER');

-- CreateEnum
CREATE TYPE "SetupAggregationValueType" AS ENUM ('NUMERIC', 'CATEGORICAL', 'BOOLEAN', 'MULTI_SELECT');

-- CreateTable
CREATE TABLE "SetupParameterAggregation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scopeType" "SetupAggregationScopeType" NOT NULL DEFAULT 'CAR_PARAMETER',
    "scopeKey" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "parameterKey" TEXT NOT NULL,
    "valueType" "SetupAggregationValueType" NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "numericStatsJson" JSONB,
    "categoricalStatsJson" JSONB,

    CONSTRAINT "SetupParameterAggregation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetupParameterAggregation_scopeType_carId_parameterKey_key" ON "SetupParameterAggregation"("scopeType", "carId", "parameterKey");

-- CreateIndex
CREATE INDEX "SetupParameterAggregation_carId_idx" ON "SetupParameterAggregation"("carId");

-- AddForeignKey
ALTER TABLE "SetupParameterAggregation" ADD CONSTRAINT "SetupParameterAggregation_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE CASCADE ON UPDATE CASCADE;
