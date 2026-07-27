/**
 * Copy the real community aggregation rows from prod into the throwaway branch.
 *
 * WHY: on a fresh branch CommunitySetupParameterAggregation is empty, so every
 * `setupVsSpread` row reads `positionBand: "no_spread_data"` — and a documented class of
 * Engineer reasoning never fires (CHAT_SYSTEM rule 4 "check position before recommending a
 * direction", rule 9 cross-axle, rule 12 sample-size trust). Those rules exist because the
 * model was observed getting position wrong, so whether the guard actually holds is exactly
 * what the flaw hunt should be able to test.
 *
 * Real rows beat synthesized ones here: the setup pool is drawn from the SAME dataset these
 * aggregations were built from, so a pooled sheet lands at a genuine position in the band
 * rather than an invented one. Availability still varies naturally — an "unlisted chassis"
 * scenario has no template, so no bucket, so no spread (the thin-data path).
 *
 * SAFETY: reads prod via PROD_DATABASE_URL, writes only to the guarded grader branch.
 * Two separate PrismaClients — the prod one is never given a write call.
 *
 * Run: npm run engineer:grader:copy-aggregations
 *   (needs PROD_DATABASE_URL + the .env.grader guard vars; see seedBranch.ts)
 */
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertGraderDb } from "./seedBranch";

async function main() {
  // Refuses unless DATABASE_URL is the declared throwaway branch.
  assertGraderDb();

  const prodUrl = process.env.PROD_DATABASE_URL?.trim();
  if (!prodUrl) {
    throw new Error(
      "PROD_DATABASE_URL is not set — needed to read the real aggregation rows. " +
        "It must differ from DATABASE_URL (seedBranch's guard enforces that)."
    );
  }

  const prodRead = new PrismaClient({ datasources: { db: { url: prodUrl } } });
  try {
    const [community, baselines] = await Promise.all([
      prodRead.communitySetupParameterAggregation.findMany(),
      prodRead.setupSheetManufacturerBaseline.findMany(),
    ]);

    console.log(`Read ${community.length} community aggregation rows + ${baselines.length} manufacturer baselines from prod.`);
    if (community.length === 0) {
      console.warn(
        "⚠ Prod has no community aggregation rows — positionBand will stay 'no_spread_data'.\n" +
          "  Populate them first: POST /api/setup-aggregations/rebuild as an admin."
      );
    }

    const buckets = new Map<string, number>();
    for (const r of community) {
      const k = `${r.setupSheetTemplate}/${r.trackSurface}/${r.gripLevel}`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }

    if (process.argv.includes("--dry-run")) {
      console.log("DRY RUN — nothing written. Buckets that would land on the branch:");
      for (const [k, n] of [...buckets.entries()].sort()) console.log(`  ${k}: ${n} params`);
      return;
    }

    // Full replacement, mirroring how the real rebuild writes this table.
    await prisma.$transaction([
      prisma.communitySetupParameterAggregation.deleteMany({}),
      prisma.communitySetupParameterAggregation.createMany({
        data: community.map((r) => ({
          setupSheetTemplate: r.setupSheetTemplate,
          trackSurface: r.trackSurface,
          gripLevel: r.gripLevel,
          parameterKey: r.parameterKey,
          valueType: r.valueType,
          sampleCount: r.sampleCount,
          numericStatsJson: r.numericStatsJson ?? undefined,
          categoricalStatsJson: r.categoricalStatsJson ?? undefined,
        })),
        skipDuplicates: true,
      }),
    ]);

    for (const b of baselines) {
      await prisma.setupSheetManufacturerBaseline.upsert({
        where: { setupSheetTemplate: b.setupSheetTemplate },
        create: {
          setupSheetTemplate: b.setupSheetTemplate,
          pdfUrl: b.pdfUrl,
          summary: b.summary ?? undefined,
          reviewedAt: b.reviewedAt ?? undefined,
        },
        update: {},
      });
    }

    console.log(`\nCopied ${community.length} rows across ${buckets.size} template/surface/grip buckets.`);
    // A grip-specific bucket under 10 samples silently collapses to "any" on read
    // (MIN_GRIP_BUCKET_SAMPLE_COUNT in loadCommunityAggregations.ts) — worth knowing which.
    const thin = [...buckets.keys()].filter((k) => !k.endsWith("/any")).length;
    console.log(`Grip-specific buckets: ${thin} (any bucket under 10 samples falls back to "any" on read).`);
    console.log(`\nNext: seed scenarios, then run the answers pass — positionBand will now resolve.`);
  } finally {
    await prodRead.$disconnect();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
