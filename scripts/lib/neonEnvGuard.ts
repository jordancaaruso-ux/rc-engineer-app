/**
 * Which database is this script about to write to?
 *
 * `.env.local` has been repointed before (scratch-dev today, prod last month), so the filename
 * proves nothing — the host does. Every mutating catalog script prints the host up front and
 * refuses to `--apply` against prod unless the caller says `--prod` out loud.
 */

export const PROD_DB_HOST_FRAGMENT = "ep-hidden-rice";

export type DbTarget = {
  host: string;
  isProd: boolean;
};

export function describeDatabaseTarget(): DbTarget {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set — run through dotenv-cli (see the npm script).");
  }
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    // A password with URL-hostile characters can break `new URL`; the host is still after the @.
    const match = raw.match(/@([^/:?]+)/);
    host = match?.[1] ?? "";
  }
  if (!host) throw new Error("Could not read a host out of DATABASE_URL.");
  return { host, isProd: host.includes(PROD_DB_HOST_FRAGMENT) };
}

/**
 * Call once before any write. Prints the target; throws when applying somewhere the flags
 * don't cover. `requireBlobOnProd` is for scripts that store files: on prod, rows in Neon with
 * files in `.local-uploads/` are dead references on Vercel, so the Blob token must be present.
 */
export function guardDatabaseTarget(opts: {
  apply: boolean;
  prodFlag: boolean;
  requireBlobOnProd?: boolean;
}): DbTarget {
  const target = describeDatabaseTarget();
  const mode = opts.apply ? "APPLY" : "dry-run";
  console.log(`Database: ${target.host} (${target.isProd ? "PROD" : "not prod"}) — ${mode}`);

  if (!opts.apply) return target;
  if (target.isProd && !opts.prodFlag) {
    throw new Error(
      `Refusing to --apply against the prod host (${target.host}). Pass --prod if you mean it.`
    );
  }
  if (target.isProd && opts.requireBlobOnProd && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set: files would land in .local-uploads/ while rows land in prod."
    );
  }
  return target;
}
