/**
 * dev-scrub-demo-lap-sessions.ts — FOUNDER-RUN. Anonymises driver names inside the demo account's
 * imported lap sessions.
 *
 * seed-demo-account.ts scrubs runs, setups and threads, but misses `ImportedLapTimeSession`
 * entirely. That table carries `fieldStatsJson.drivers[].driverName` and
 * `eventDetectionSessionLabel` — the full field from real club races. So the public demo, and any
 * marketing screenshot of lap comparison or field stats, shows the founder's real name AND the
 * real names of every other racer who happened to be in that heat.
 *
 * This maps every real name to a stable fictional one (same input always yields the same output,
 * so a driver stays consistent across sessions and the field comparisons still read coherently),
 * and masks transponder numbers. The founder's own name maps to the demo account's display name so
 * it matches the rest of the seeded data.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-scrub-demo-lap-sessions.ts --dry-run     # report only
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-scrub-demo-lap-sessions.ts               # apply
 *
 * Idempotent: fictional names do not match the real-name patterns, so a second run is a no-op.
 * The real fix belongs in seed-demo-account.ts; this repairs an already-seeded database.
 */
import { prisma } from "@/lib/prisma";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

const DRY = process.argv.includes("--dry-run");

/** Fictional field. Deliberately plausible-but-invented; assigned deterministically by sort order. */
const FAKE_NAMES = [
  "Dane Kessler", "Rhett Alvarez", "Nico Brandt", "Kai Lindqvist", "Owen Marchetti",
  "Elias Vance", "Milo Ferreira", "Zane Okafor", "Caleb Nordin", "Ari Solberg",
  "Theo Bergman", "Jonas Reyes", "Luca Hartmann", "Ivan Petrov", "Marco Delgado",
  "Finn Larsson", "Otto Grimaldi", "Rex Coleman", "Silas Munro", "Tobias Wren",
  "Vaughn Pike", "Casper Nyman", "Emil Rasmussen", "Felix Duarte", "Gideon Marsh",
  "Hugo Valente", "Ismael Cortez", "Jarrah Whitlock", "Kirby Nolan", "Lars Ostergaard",
  "Mateo Rivas", "Niall Brennan", "Orson Fairweather", "Piers Calloway", "Quinn Halloran",
  "Roman Escobar", "Soren Blackwood", "Tarquin Vale", "Ulrich Sand", "Viggo Amsel",
];

/** Non-person strings that happen to sit in the same fields. */
const NOT_A_NAME =
  /^(race\s|heat\s|qual|practice|main|istc|open|stock|mod|round|final|a-main|b-main|group)/i;

type NameMap = Map<string, string>;

function isPersonName(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 4 || s.length > 40) return false;
  if (NOT_A_NAME.test(s)) return false;
  if (/\d/.test(s)) return false;
  // Two or more alphabetic tokens — a first and last name.
  return s.split(/\s+/).filter((t) => /^[A-Za-z'’.-]+$/.test(t)).length >= 2;
}

/** Strip decorations the app appends so the same driver maps to one identity. */
function baseName(raw: string): string {
  return raw
    .replace(/\s*·.*$/, "") // " · 18 laps"
    .replace(/\s+M$/i, "") // trailing marshal/marker flag
    .replace(/\s+/g, " ")
    .trim();
}

/** Match the casing of the source so ALL-CAPS field rows stay ALL-CAPS. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source === source.toLowerCase()) return replacement.toLowerCase();
  return replacement;
}

function collectNames(value: unknown, found: Set<string>) {
  if (value == null) return;
  if (typeof value === "string") {
    const b = baseName(value);
    if (isPersonName(b)) found.add(b.toUpperCase());
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((v) => collectNames(v, found));
  for (const v of Object.values(value as Record<string, unknown>)) collectNames(v, found);
}

function scrubString(s: string, map: NameMap): string {
  let out = s;
  for (const [real, fake] of map) {
    // Word-boundary, case-insensitive; casing of each hit is preserved.
    const re = new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, (hit) => matchCase(hit, fake));
  }
  // Transponder-shaped numbers (6-8 digits) — identifying on their own.
  out = out.replace(/\b\d{6,8}\b/g, (n) => "9" + "0".repeat(Math.max(0, n.length - 2)) + "1");
  return out;
}

function scrubDeep<T>(value: T, map: NameMap): T {
  if (typeof value === "string") return scrubString(value, map) as unknown as T;
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, map)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, map);
  return out as unknown as T;
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}${DRY ? "   (DRY RUN)" : ""}`);
  if (/ep-hidden-rice/.test(dbHost) && DRY === false) {
    throw new Error("REFUSING TO WRITE: that is PRODUCTION. Re-run with --dry-run to inspect.");
  }

  const demoId = demoCatalogUserId();
  const demoUser = await prisma.user.findUnique({ where: { id: demoId }, select: { name: true } });
  const demoName = demoUser?.name?.trim() || "Alex Marino";

  const sessions = await prisma.importedLapTimeSession.findMany({ where: { userId: demoId } });
  console.log(`imported sessions: ${sessions.length}`);

  const found = new Set<string>();
  for (const s of sessions) {
    collectNames(s as unknown, found);
    const label = (s as unknown as Record<string, unknown>).eventDetectionSessionLabel;
    if (typeof label === "string") collectNames(label, found);
  }

  // Deterministic assignment: sort, then take from the pool in order.
  const realNames = [...found].sort();
  const map: NameMap = new Map();
  let poolIdx = 0;
  for (const real of realNames) {
    if (/JORDAN\s+CARUSO/i.test(real)) {
      map.set(real, demoName); // the founder maps to the demo identity already used elsewhere
    } else if (real === demoName.toUpperCase()) {
      // Already the demo identity (seed-demo-account.ts scrubbed it here but missed other rows).
      // Leave it alone: remapping would desync these rows from the account name and avatar.
      continue;
    } else {
      map.set(real, FAKE_NAMES[poolIdx % FAKE_NAMES.length]);
      poolIdx += 1;
    }
  }
  // Bare first/last name fallbacks, after the full names so they never pre-empt them.
  map.set("JORDANCAARUSO", "demodriver");
  map.set("CARUSO", demoName.split(" ").pop() ?? demoName);
  map.set("JORDAN", demoName.split(" ")[0] ?? demoName);

  console.log(`\nname mappings (${map.size}):`);
  [...map].slice(0, 12).forEach(([r, f]) => console.log(`   ${r}  →  ${f}`));
  if (map.size > 12) console.log(`   … ${map.size - 12} more`);

  if (DRY) {
    console.log("\nDry run — nothing written.");
    return;
  }

  let changed = 0;
  for (const s of sessions) {
    const row = s as unknown as Record<string, unknown>;
    const nextField = scrubDeep(row.fieldStatsJson ?? null, map);
    const nextParsed = scrubDeep(row.parsedPayload ?? null, map);
    const nextLabel =
      typeof row.eventDetectionSessionLabel === "string"
        ? scrubString(row.eventDetectionSessionLabel, map)
        : row.eventDetectionSessionLabel;

    const dirty =
      JSON.stringify(nextField) !== JSON.stringify(row.fieldStatsJson ?? null) ||
      JSON.stringify(nextParsed) !== JSON.stringify(row.parsedPayload ?? null) ||
      nextLabel !== row.eventDetectionSessionLabel;
    if (!dirty) continue;

    await prisma.importedLapTimeSession.update({
      where: { id: s.id },
      data: {
        ...(nextField !== null ? { fieldStatsJson: nextField as never } : {}),
        ...(nextParsed !== null ? { parsedPayload: nextParsed as never } : {}),
        eventDetectionSessionLabel: (nextLabel as string | null) ?? null,
      },
    });
    changed += 1;
  }

  console.log(`\nrewrote ${changed} session row(s).`);
}

main()
  .catch((e) => {
    console.error("ERR: " + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
