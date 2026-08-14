/**
 * Give a calibrated chassis every box its sheet prints.
 *
 * A curated chassis (the Awesomatix A800RR) only ever had keys for the boxes a human named in its
 * calibration. The sheet PRINTS far more than that, and now that the picture is the surface drivers
 * read and edit setups on, an unnamed box is one they can see and cannot touch — and one that never
 * survives an upload or reaches an export. This appends a parameter, a box and a mapping for each of
 * them, leaving every existing key exactly where it is.
 *
 *   npm run union-boxes -- --slug awesomatix_a800rr             preflight, writes nothing
 *   npm run union-boxes -- --slug awesomatix_a800rr --apply
 *   npm run union-boxes -- --slug awesomatix_a800rr --apply --prod
 *
 * Safe to re-run: a box that already has a key is claimed, so a second pass over an unchanged blank
 * adds nothing.
 *
 * `--conditions=react-server` is required — the storage module imports `server-only`.
 */
import { prisma } from "@/lib/prisma";
import { applyUnionToChassis } from "@/lib/setupSheetModels/applyUnionToChassis";
import { A800RR_EXTRA_SIMPLE_KEYS } from "@/lib/setupSheetModels/a800rrExtraSimpleKeys";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const slug = args[args.indexOf("--slug") + 1];
  if (!slug || slug.startsWith("--")) throw new Error("pass --slug <model slug>");

  guardDatabaseTarget({ apply, prodFlag: args.includes("--prod") });

  const model = await prisma.setupSheetModel.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!model) throw new Error(`no chassis with slug ${slug}`);

  const result = await applyUnionToChassis({
    setupSheetModelId: model.id,
    apply,
    // Only the A800RR has hand-written supplements; every other chassis passes none.
    extraSimpleKeys: slug === "awesomatix_a800rr" ? A800RR_EXTRA_SIMPLE_KEYS : undefined,
  });

  console.log(`chassis: ${model.name}`);
  console.log(`boxes the calibration already owns: ${result.claimedWidgetCount}`);
  console.log(`parameters added: ${result.addedFieldCount} (${result.addedBoxCount} boxes)`);
  if (result.collidedKeys.length > 0) {
    console.log(`keys suffixed to avoid a collision (permanent): ${JSON.stringify(result.collidedKeys)}`);
  }
  console.log(result.applied ? "written." : "dry run — nothing written. Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
