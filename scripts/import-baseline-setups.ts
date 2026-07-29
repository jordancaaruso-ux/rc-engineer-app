/**
 * Bulk-publish global baseline setups (KIT | BASE | PRO) against a chassis type, so a batch of
 * authored sheets doesn't have to be typed through the admin form one field at a time.
 *
 * Same write the admin route makes (`POST /api/setup-sheet-models/[id]/baselines`) — values go
 * through `normalizeSetupSnapshotForStorage`, so they land in exactly the `SetupSnapshot.data`
 * shape the editor and the Engineer expect.
 *
 * Idempotent by (chassis, name): re-running updates the row it wrote before rather than publishing
 * a duplicate. Never touches a driver's copies — those hold their own values.
 *
 * Unknown keys are a hard stop, not a warning: a typo'd key stores silently and reads as a missing
 * value forever. Fix the seed or add the field to the chassis schema first.
 *
 * `--conditions=react-server` is required: `@/lib/prisma` pulls in the perf extension, which imports
 * `server-only`. Plain `npx tsx` throws "cannot be imported from a Client Component".
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/import-baseline-setups.ts seeds/baseline-setups/schumacher_mi10.json --dry
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/import-baseline-setups.ts seeds/baseline-setups/schumacher_mi10.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import {
  cleanBaselineName,
  cleanBaselineNotes,
  parseBaselineGripLevel,
  parseBaselineKind,
  parseBaselineSurface,
} from "@/lib/baselineSetups/baselineSetupShape";

type SeedFile = {
  /** `SetupSheetModel.slug`, e.g. "schumacher_mi10". */
  chassisSlug: string;
  /** Email of the admin credited as publisher; optional, attribution only. */
  createdByEmail?: string;
  baselines: SeedBaseline[];
};

type SeedBaseline = {
  name: string;
  kind: string;
  notes?: string | null;
  surface?: string | null;
  gripLevel?: string | null;
  data: Record<string, unknown>;
};

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!fileArg) fail("Usage: import-baseline-setups.ts <seed.json> [--dry]");

  const path = resolve(process.cwd(), fileArg);
  const seed = JSON.parse(readFileSync(path, "utf8")) as SeedFile;

  if (!seed.chassisSlug) fail(`${fileArg} has no "chassisSlug".`);
  if (!Array.isArray(seed.baselines) || seed.baselines.length === 0) {
    fail(`${fileArg} has no baselines.`);
  }

  // Chassis models are global — never scope this read by userId.
  const model = await prisma.setupSheetModel.findUnique({
    where: { slug: seed.chassisSlug },
    select: { id: true, name: true, schemaJson: true },
  });
  if (!model) fail(`No chassis type with slug "${seed.chassisSlug}".`);

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) fail(`"${model.name}" has no parameter schema yet — build the sheet first.`);
  const knownKeys = new Set(schema.fields.map((f) => f.key));

  const publisher = seed.createdByEmail
    ? await prisma.user.findUnique({
        where: { email: seed.createdByEmail },
        select: { id: true },
      })
    : null;
  if (seed.createdByEmail && !publisher) {
    fail(`No user with email "${seed.createdByEmail}" — fix createdByEmail or drop it.`);
  }

  console.log(`\n${model.name} (${seed.chassisSlug}) · ${schema.fields.length} fields in schema`);

  // Validate everything before writing anything — a half-published batch is worse than none.
  const prepared = seed.baselines.map((b, i) => {
    const label = `baselines[${i}]${b.name ? ` "${b.name}"` : ""}`;
    const name = cleanBaselineName(b.name);
    if (!name) fail(`${label}: a name is required.`);
    const kind = parseBaselineKind(b.kind);
    if (!kind) fail(`${label}: kind must be KIT, BASE or PRO (got ${JSON.stringify(b.kind)}).`);

    const unknown = Object.keys(b.data ?? {}).filter((k) => !knownKeys.has(k));
    if (unknown.length > 0) {
      fail(`${label}: ${unknown.length} key(s) not on this chassis sheet — ${unknown.join(", ")}`);
    }

    // Blank on the sheet means "not specified", so drop empties rather than storing a value the
    // Engineer would read as real. Lets a seed file carry the full key skeleton and be filled in.
    const filled = Object.fromEntries(
      Object.entries(b.data ?? {}).filter(
        ([, v]) => v != null && !(typeof v === "string" && v.trim() === "")
      )
    );
    const data = normalizeSetupSnapshotForStorage(filled);
    if (Object.keys(data).length === 0) fail(`${label}: needs at least one value.`);

    return {
      name,
      kind,
      notes: cleanBaselineNotes(b.notes),
      surface: parseBaselineSurface(b.surface),
      gripLevel: parseBaselineGripLevel(b.gripLevel),
      data,
    };
  });

  const kitCount = prepared.filter((b) => b.kind === "KIT").length;
  const existingKit = await prisma.baselineSetup.count({
    where: { setupSheetModelId: model.id, kind: "KIT" },
  });
  if (kitCount + existingKit > 1) {
    console.warn(
      `\n⚠ ${kitCount + existingKit} KIT baselines after this import. The Engineer's base-setup ` +
        `bands read one KIT per chassis — which one wins is undefined.`
    );
  }

  for (const b of prepared) {
    const existing = await prisma.baselineSetup.findFirst({
      where: { setupSheetModelId: model.id, name: b.name },
      select: { id: true },
    });
    const values = Object.keys(b.data).length;

    if (dryRun) {
      console.log(`  ${existing ? "update" : "create"}  [${b.kind}] ${b.name} — ${values} values`);
      continue;
    }

    if (existing) {
      await prisma.baselineSetup.update({
        where: { id: existing.id },
        data: {
          kind: b.kind,
          notes: b.notes,
          surface: b.surface,
          gripLevel: b.gripLevel,
          data: b.data as Prisma.InputJsonValue,
        },
      });
      console.log(`  updated  [${b.kind}] ${b.name} — ${values} values`);
    } else {
      await prisma.baselineSetup.create({
        data: {
          setupSheetModelId: model.id,
          name: b.name,
          kind: b.kind,
          notes: b.notes,
          surface: b.surface,
          gripLevel: b.gripLevel,
          data: b.data as Prisma.InputJsonValue,
          createdByUserId: publisher?.id ?? null,
        },
      });
      console.log(`  created  [${b.kind}] ${b.name} — ${values} values`);
    }
  }

  console.log(dryRun ? "\nDry run — nothing written.\n" : "\nDone.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
