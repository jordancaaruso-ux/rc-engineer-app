-- Conditional setup stats: new scope + unique index includes scopeKey (condition bucket).

ALTER TYPE "SetupAggregationScopeType" ADD VALUE 'CAR_PARAMETER_CONDITION';

DROP INDEX IF EXISTS "SetupParameterAggregation_scopeType_carId_parameterKey_key";

CREATE UNIQUE INDEX "SetupParameterAggregation_scopeType_scopeKey_carId_parameterKey_key"
ON "SetupParameterAggregation"("scopeType", "scopeKey", "carId", "parameterKey");
