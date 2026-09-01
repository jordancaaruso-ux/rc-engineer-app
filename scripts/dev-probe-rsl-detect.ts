import { computeRollCenterFromSnapshot } from "@/lib/rollCenter/computeFromSnapshot";
import { AWESOMATIX_A800_PACK } from "@/lib/rollCenter/packs";

const base = { ride_height_front: "5.0", ride_height_rear: "5.2" };
for (const [label, chassis] of [
  ["object RSL", { selectedPreset: "C01B-RSL", otherText: "" }],
  ["string RSL", "C01B-RSL"],
  ["word", "TITANIUM"],
  ["steel", "C01RS"],
] as const) {
  const r = computeRollCenterFromSnapshot({ ...base, chassis }, AWESOMATIX_A800_PACK);
  console.log(label, r?.front.rcHeightMm, "|", r?.assumptions.filter((a) => /chassis|plate|steel/i.test(a)).join("; ") || "(no chassis assumption)");
}
