import assert from "node:assert/strict";
import {
  canonicalAggregationParameterKey,
  isUniversalTouringTuningParameter,
} from "@/lib/setupSheetModels/universalParameters";

assert.equal(canonicalAggregationParameterKey("downstop_front"), "droop_front");
assert.equal(canonicalAggregationParameterKey("droop_front"), "droop_front");
assert.equal(canonicalAggregationParameterKey("toe_rear"), "toe_rear");
assert.equal(canonicalAggregationParameterKey("custom_mugen_arb"), "custom_mugen_arb");

assert.equal(isUniversalTouringTuningParameter("downstop_rear"), true);
assert.equal(isUniversalTouringTuningParameter("driver"), false);

console.log("universalParameters.test.ts ok");
