/**
 * Re-read every driver-derived chassis off its own PDF, after the minified-class-name fix.
 *
 *   npm run rederive-chassis                         preflight over every derived chassis
 *   npm run rederive-chassis -- --slug sheet_abc123   one of them
 *   npm run rederive-chassis -- --apply
 *   npm run rederive-chassis -- --apply --prod
 *
 * Why: chassis derived by a production build between 2026-08-11 and 2026-08-14 were read with
 * `field.constructor.name`, which the bundler had minified to a letter — so every box came out a
 * free-text box and no row of ticks ever became a one-of-many. Full account in
 * `rederiveDerivedChassis`. Curated chassis are refused; they were never affected.
 *
 * `--conditions=react-server` is required — the storage module imports `server-only`.
 */
import {
  listDerivedChassis,
  rederiveDerivedChassis,
} from "@/lib/setupSheetModels/rederiveDerivedChassis";
import { prisma } from "@/lib/prisma";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const slugArg = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : undefined;

  guardDatabaseTarget({ apply, prodFlag: args.includes("--prod") });

  const all = await listDerivedChassis();
  const targets = slugArg ? all.filter((m) => m.slug === slugArg) : all;
  if (targets.length === 0) {
    console.log(slugArg ? `no derived chassis with slug ${slugArg}` : "no derived chassis at all");
    return;
  }
  console.log(`derived chassis: ${targets.length}${slugArg ? "" : " (every one)"}\n`);

  let failed = 0;
  let strandedValues = 0;
  for (const target of targets) {
    try {
      const r = await rederiveDerivedChassis({ setupSheetModelId: target.id, apply });
      console.log(`${r.name} [${r.slug}]`);
      console.log(
        `  boxes ${r.boxCountBefore} → ${r.boxCountAfter} · ticks restored ${r.becameCheckbox} · choice rows formed ${r.choiceGroupsFormed}`
      );
      console.log(`  keys +${r.keysAdded.length} / -${r.keysRemoved.length}`);
      if (r.keysLosingValues.length > 0) {
        const total = r.keysLosingValues.reduce((n, k) => n + k.snapshotCount, 0);
        strandedValues += total;
        console.log(
          `  VALUES STRANDED: ${total} across ${r.keysLosingValues.length} keys — ${r.keysLosingValues
            .slice(0, 6)
            .map((k) => `${k.key}×${k.snapshotCount}`)
            .join(", ")}${r.keysLosingValues.length > 6 ? ", …" : ""}`
        );
      }
      if (r.nextSlug !== r.slug && r.slugTakenByOtherModel) {
        console.log(`  slug ${r.nextSlug} is already another row's — kept ${r.slug}, needs a merge`);
      } else if (r.nextSlug !== r.slug) {
        console.log(`  slug → ${r.nextSlug}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`${target.name} [${target.slug}]`);
      console.log(`  SKIPPED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(
    `\n${apply ? "written" : "dry run — nothing written"}${failed ? ` · ${failed} skipped` : ""}${
      strandedValues ? ` · ${strandedValues} stored values stranded` : ""
    }`
  );
  if (!apply) console.log("Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
