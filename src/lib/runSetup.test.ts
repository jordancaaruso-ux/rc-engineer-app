import { strict as assert } from "node:assert";
import { filledSetupValueCount } from "./runSetup";

// --- filledSetupValueCount ignores deletion markers -------------------------------------------
//
// The form's state carries `""` for a box the driver emptied on purpose. Those are instructions,
// not values: counting them made "N values" sit still when a box was cleared, and made a setup
// emptied box by box still read as "has a setup".
{
  assert.equal(filledSetupValueCount({ toe_rear: "2.4", camber_front: "-1.5" }), 2);
  assert.equal(filledSetupValueCount({ toe_rear: "2.4", camber_front: "" }), 1);
  assert.equal(filledSetupValueCount({ toe_rear: "", camber_front: "   " }), 0);
  assert.equal(filledSetupValueCount({}), 0);
  assert.equal(filledSetupValueCount(null), 0);
  // A zeroed box is a measurement someone took, not a blank.
  assert.equal(filledSetupValueCount({ downstop_front: 0 }), 1);
  // Grouped rows: all-blank is nothing, one entry is something.
  assert.equal(filledSetupValueCount({ top_deck_screws: ["", ""] }), 0);
  assert.equal(filledSetupValueCount({ top_deck_screws: ["", "P1"] }), 1);
}

console.log("runSetup: ok");
