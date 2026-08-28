import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { runsTag } from "@/lib/cacheTags";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getMyRcmDriverNamesForUser } from "@/lib/appSettings";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { importMyRcmPdf } from "@/lib/lapImport/importMyRcmPdf";
import { selectMyRcmPdfDriver } from "@/lib/lapUrlParsers/myRcmPdf";

/**
 * Import a MyRCM run result from the PDF the **driver** downloaded.
 *
 * The counterpart to `../import/route.ts`, which takes URLs. This one deliberately accepts no URL
 * of any kind: `myrcm.ch` is on the fetch denylist so the app can never request anything from
 * MyRCM, and this route exists so it never needs to — the driver taps MyRCM's own "Download PDF"
 * and hands the file over.
 *
 * Nothing is saved unless the file's own numbers reconcile; see `myRcmPdf.ts`.
 */

/**
 * Measured: an 8-driver, 78-lap final is ~960 KB; a 10-driver EFRA final ~290 KB. 8 MB leaves room
 * for a large national A-main while still refusing an entire event's worth of pages.
 *
 * Production caps uploads below this anyway — the point of the check is to fail with a sentence a
 * driver can act on instead of a bare 413.
 */
const MAX_BYTES = 8 * 1024 * 1024;

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkApiRateLimit({
    key: `lap-import-pdf:${user.id}`,
    limit: 60,
    windowMs: 60 * 60 * 1000,
    userEmail: user.email,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the PDF as multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is bigger than we can read. Download a single run rather than a whole event.`,
        code: "too_large",
      },
      { status: 413 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const driverNames = await getMyRcmDriverNamesForUser(user.id);

  const result = await importMyRcmPdf({
    userId: user.id,
    bytes,
    fileName: file.name || null,
    driverNames,
  });

  if (!result.success) {
    // Not a server fault: the driver brought the wrong file, or MyRCM's layout moved. Either way
    // the message names the next thing to do, so it is safe to show as-is.
    return NextResponse.json(
      { error: result.error, code: result.code, issues: result.issues ?? [] },
      { status: 422 }
    );
  }

  revalidateTag(runsTag(user.id), { expire: 0 });

  const { report } = result;
  // Which row is theirs, by the names in Settings — pure, so cheap to ask again here. `null`
  // means the form must make them pick; it never guesses a row.
  const matched = selectMyRcmPdfDriver(report, driverNames);
  return NextResponse.json({
    fileName: file.name || null,
    matchedDriverId: matched ? `myrcm-pdf-p${matched.position}` : null,
    importedSessionId: result.importedSessionId,
    parserId: result.parserId,
    sourceUrl: result.sourceUrl,
    alreadyImported: result.alreadyImported,
    recordedAt: result.recordedAt,
    sessionCompletedAtIso: result.sessionCompletedAtIso,
    sessionCompletedAtDbIso: result.sessionCompletedAtDbIso,
    session: {
      name: report.sessionName,
      eventName: report.eventName,
      className: report.className,
    },
    laps: result.laps,
    driverNotFound: result.driverNotFound,
    // The card prints `message`; the parser's issues carry `detail` and a name. Handed over raw,
    // every warning drew as an empty line under "Things to know" (2026-08-29).
    warnings: result.warnings.map((issue) => ({
      kind: issue.kind,
      severity: issue.severity,
      message: `${issue.driverName}: ${issue.detail}`,
    })),
    drivers: report.drivers.map((driver) => ({
      id: `myrcm-pdf-p${driver.position}`,
      position: driver.position,
      carNumber: driver.carNumber,
      driverName: driver.driverName,
      club: driver.club,
      note: driver.note,
      lapCount: driver.laps.length,
      bestLapSeconds: driver.laps.length ? Math.min(...driver.laps) : null,
      laps: driver.laps,
    })),
  });
}
