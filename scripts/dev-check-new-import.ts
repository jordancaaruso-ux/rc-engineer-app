import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("pass a snapshot id");
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id },
    select: { id: true, data: true, createdAt: true, carId: true },
  });
  const data = snap.data as Record<string, unknown>;
  const keys = Object.keys(data);
  const editionKeys = keys.filter((k) =>
    ["front_shock_oil", "ff_inner_top_link_spacer", "front_upper_hub_spacer", "chassis__b3"].includes(k)
  );
  console.log(`snapshot ${snap.id} created ${snap.createdAt.toISOString()} keys=${keys.length}`);
  console.log(`edition-vocabulary leakage: ${editionKeys.length ? editionKeys.join(", ") : "NONE ✓"}`);
  for (const k of [
    "camber_front", "toe_front", "damper_oil_front", "spring_gap_front", "pss_percent_setup_front",
    "chassis", "upper_inner_shims_ff", "under_lower_arm_shims_ff", "bump_steer_shims_front",
    "ride_height_front", "front_spring_rate_gf_mm", "motor_mount_screws", "wing", "receiver", "radio", "battery", "bodyshell",
  ]) {
    console.log(`  ${k} = ${JSON.stringify(data[k])}`);
  }

  // The linked SetupDocument is visible via dev-check-latest-doc.ts; there is no snapshot→document
  // relation to walk from here.
}

main().finally(() => prisma.$disconnect());
