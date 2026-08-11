/**
 * Bulk-ingest editable blank setup sheets as authorized catalog chassis.
 *
 * The founder collects fillable manufacturer PDFs, names each one, and this pushes them through
 * the same pipeline a driver's upload uses (`createModelFromBlank`) — so schema derivation,
 * fingerprint dedupe and page pre-rendering all behave identically. The only differences from the
 * driver door: refused files never touch the database (the founder is reading this console, not
 * the review queue), and created models are authorized immediately with `userId: null`, the
 * seeded-catalog convention.
 *
 * Dry-run by default: preflights every file read-only and reports what --apply would do.
 *
 *   npm run ingest-blanks -- manifest.json
 *   npm run ingest-blanks -- manifest.json --apply
 *   npm run ingest-blanks -- manifest.json --apply --prod        (after the branch ships)
 *
 * Manifest: [{ "name": "Kyosho MP10", "pdfPath": "C:\\...\\mp10_editable.pdf" }, ...]
 *
 * `--conditions=react-server` is required: `@/lib/prisma` imports `server-only`.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { isAuthAdminEmail, parseAuthAdminEmails } from "@/lib/authAdminLogic";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import {
  refusalForBlankExtraction,
  refusalForBlankFile,
  type BlankRefusal,
} from "@/lib/setupSheetModels/blankUploadDiagnosis";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import {
  derivedSheetFingerprint,
  derivedSheetSlug,
} from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { createModelFromBlank } from "@/lib/setupSheetModels/createModelFromBlank";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

type ManifestEntry = { name: string; pdfPath: string };

type Preflight = {
  entry: ManifestEntry;
  outcome:
    | { kind: "ok"; slug: string; bytes: Buffer; pages: number; fields: number; boxes: number }
    | { kind: "merge"; slug: string; existing: { id: string; name: string; isAuthorized: boolean } }
    | { kind: "refused"; refusal: BlankRefusal }
    | { kind: "error"; message: string };
  nameClashes: string[];
};

function readManifest(path: string): ManifestEntry[] {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Manifest must be a JSON array.");
  return parsed.map((row, i) => {
    if (typeof row?.name !== "string" || !row.name.trim()) {
      throw new Error(`Manifest entry ${i}: missing "name".`);
    }
    if (typeof row?.pdfPath !== "string" || !row.pdfPath.trim()) {
      throw new Error(`Manifest entry ${i} ("${row?.name}"): missing "pdfPath".`);
    }
    return { name: row.name.trim(), pdfPath: row.pdfPath.trim() };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const prodFlag = args.includes("--prod");
  const emailArg = args.find((a) => a.startsWith("--user-email="))?.slice("--user-email=".length);
  const manifestPath = args.find((a) => !a.startsWith("--"));
  if (!manifestPath) {
    console.error("Usage: npm run ingest-blanks -- <manifest.json> [--apply] [--prod] [--user-email=...]");
    process.exit(1);
  }

  guardDatabaseTarget({ apply, prodFlag, requireBlobOnProd: true });

  const email = emailArg ?? [...parseAuthAdminEmails()][0];
  if (!isAuthAdminEmail(email)) {
    throw new Error(
      `"${email ?? "(none)"}" is not in AUTH_ADMIN_EMAILS — the calibration would land unverified.`
    );
  }
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user row for ${email} in this database.`);

  const entries = readManifest(manifestPath);
  console.log(`${entries.length} sheet(s) in the manifest. Ingesting as ${user.email}.\n`);

  const existingModels = await prisma.setupSheetModel.findMany({
    select: { id: true, name: true, slug: true, isAuthorized: true },
  });
  const byNormalizedName = new Map<string, { name: string; isAuthorized: boolean }[]>();
  for (const m of existingModels) {
    const key = normalizeSetupSheetModelName(m.name);
    byNormalizedName.set(key, [...(byNormalizedName.get(key) ?? []), m]);
  }

  const slugSeenInManifest = new Map<string, string>();
  const preflights: Preflight[] = [];

  for (const entry of entries) {
    const nameClashes = (byNormalizedName.get(normalizeSetupSheetModelName(entry.name)) ?? []).map(
      (m) => `${m.name}${m.isAuthorized ? " (authorized)" : " (unreviewed)"}`
    );
    try {
      const bytes = readFileSync(resolve(entry.pdfPath));
      const fileRefusal = refusalForBlankFile({
        byteSize: bytes.length,
        mimeType: entry.pdfPath.toLowerCase().endsWith(".pdf") ? "application/pdf" : "",
      });
      if (fileRefusal) {
        preflights.push({ entry, outcome: { kind: "refused", refusal: fileRefusal }, nameClashes });
        continue;
      }
      const extraction = await extractPdfFormFields(bytes);
      const derived = deriveSchemaFromAcroForm(extraction, entry.name);
      const refusal = refusalForBlankExtraction({ extraction, boxCount: derived.boxes.length });
      if (refusal) {
        preflights.push({ entry, outcome: { kind: "refused", refusal }, nameClashes });
        continue;
      }
      const slug = derivedSheetSlug(derivedSheetFingerprint(derived));

      const priorInManifest = slugSeenInManifest.get(slug);
      if (priorInManifest) {
        preflights.push({
          entry,
          outcome: {
            kind: "error",
            message: `Same sheet as manifest entry "${priorInManifest}" (fingerprint ${slug}). Drop one.`,
          },
          nameClashes,
        });
        continue;
      }
      slugSeenInManifest.set(slug, entry.name);

      const existing = await prisma.setupSheetModel.findUnique({
        where: { slug },
        select: { id: true, name: true, isAuthorized: true },
      });
      if (existing) {
        preflights.push({ entry, outcome: { kind: "merge", slug, existing }, nameClashes });
        continue;
      }
      preflights.push({
        entry,
        outcome: {
          kind: "ok",
          slug,
          bytes,
          pages: extraction.pageCount ?? 1,
          fields: extraction.fields.length,
          boxes: derived.boxes.length,
        },
        nameClashes,
      });
    } catch (err) {
      preflights.push({
        entry,
        outcome: { kind: "error", message: err instanceof Error ? err.message : String(err) },
        nameClashes,
      });
    }
  }

  for (const p of preflights) {
    const o = p.outcome;
    if (o.kind === "ok") {
      console.log(
        `OK       ${p.entry.name} — ${o.pages} page(s), ${o.fields} PDF field(s), ${o.boxes} box(es), slug ${o.slug}`
      );
    } else if (o.kind === "merge") {
      console.log(
        `MERGE    ${p.entry.name} — this exact sheet already exists as "${o.existing.name}"` +
          `${o.existing.isAuthorized ? " (authorized)" : " (unreviewed — apply will authorize it)"}` +
          `${o.existing.name !== p.entry.name ? `; the existing name wins, "${p.entry.name}" is discarded` : ""}`
      );
    } else if (o.kind === "refused") {
      console.log(`REFUSED  ${p.entry.name} — ${o.refusal.code}: ${o.refusal.message}`);
    } else {
      console.log(`ERROR    ${p.entry.name} — ${o.message}`);
    }
    if (p.nameClashes.length > 0) {
      console.log(`         name clash: a model named like this already exists (${p.nameClashes.join(", ")})`);
    }
  }

  const okCount = preflights.filter((p) => p.outcome.kind === "ok").length;
  const mergeCount = preflights.filter((p) => p.outcome.kind === "merge").length;
  if (!apply) {
    console.log(
      `\nDry run: ${okCount} would be created, ${mergeCount} would join an existing row. Re-run with --apply.`
    );
    return;
  }

  console.log("");
  for (const p of preflights) {
    const o = p.outcome;
    if (o.kind === "merge") {
      // The sheet already exists (probably a driver got there first). The founder feeding it
      // through this script IS the verification, so authorize the row; its uploader keeps
      // attribution and the row keeps the first uploader's name.
      if (!o.existing.isAuthorized) {
        await prisma.setupSheetModel.update({
          where: { id: o.existing.id },
          data: { isAuthorized: true },
        });
        console.log(`authorized existing  ${o.existing.name} (${o.existing.id})`);
      } else {
        console.log(`already in catalog   ${o.existing.name} (${o.existing.id})`);
      }
      continue;
    }
    if (o.kind !== "ok") continue;

    // Buffer's backing store is ArrayBufferLike, which File's typings reject; copy the view.
    const file = new File([new Uint8Array(o.bytes)], basename(p.entry.pdfPath), {
      type: "application/pdf",
    });
    const result = await createModelFromBlank({
      user: { id: user.id, email: user.email },
      name: p.entry.name,
      upload: { kind: "file", file },
      derive: true,
      source: "admin",
    });
    if (!result.ok) {
      // Preflight said this couldn't happen; if it did, a refusal row may now sit in the queue.
      console.error(
        `FAILED   ${p.entry.name} — ${result.refusal.code}: ${result.refusal.message}` +
          (result.blankId ? ` (queue row ${result.blankId})` : "")
      );
      continue;
    }

    await prisma.setupSheetModel.update({
      where: { id: result.model.id },
      data: { isAuthorized: true, userId: null },
    });

    const blank = result.blankId
      ? await prisma.setupSheetBlank.findUnique({
          where: { id: result.blankId },
          select: { pageCount: true, pageImagesJson: true, fillSurface: true },
        })
      : null;
    const renderedPages = blank?.pageImagesJson ? Object.keys(blank.pageImagesJson as object).length : 0;
    const pageNote =
      blank && renderedPages < blank.pageCount
        ? `  WARNING: only ${renderedPages}/${blank.pageCount} page image(s) rendered`
        : "";
    console.log(
      `created  ${result.model.name} (${result.model.id}) — slug ${result.model.slug}, ` +
        `calibration ${result.calibrationId}, ${blank?.fillSurface ?? "?"} surface, ` +
        `${renderedPages}/${blank?.pageCount ?? "?"} page image(s)${pageNote}`
    );
  }
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
