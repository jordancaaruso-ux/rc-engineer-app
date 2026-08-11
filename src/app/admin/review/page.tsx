import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { formatRunDateOnly } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { listPendingChassisTypeRequests } from "@/lib/setupSheetModels/chassisTypeRequests";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CatalogVerifyToggleButton } from "@/components/assets/CatalogVerifyToggleButton";
import { ChassisRequestResolveButton } from "@/components/admin/ChassisRequestResolveButton";
import { SetupSheetModelAuthorizeToggle } from "@/components/setup-sheet-models/SetupSheetModelAuthorizeToggle";
import { CatalogDeleteButton } from "@/components/admin/CatalogDeleteButton";
import { CatalogMergeControl } from "@/components/admin/CatalogMergeControl";
import { BlankReviewedButton } from "@/components/admin/BlankReviewedButton";
import { loadBlankReviewQueue } from "@/lib/setupSheetModels/blankReviewQueue";
import {
  tireTypeIdsInUse,
  additiveTypeIdsInUse,
  trackIdsInUse,
} from "@/lib/assets/catalogUsageBulk";

const TAKE = 50;

/**
 * Founder review queue — every unverified global-catalog row + pending chassis-type requests in
 * one surface. One-tap Approve (verify); Open drills into the row for edit/merge/delete. Keeping
 * this loop cheap is what lets a solo founder stay the sole verifier at open signup.
 * See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export default async function AdminReviewPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/setup/admin" />
            <div>
              <h1 className="page-title">Review queue</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();

  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
  const [tireTypes, additiveTypes, tracks, calibrations, chassisTypes, chassisRequests, blanks] =
    await Promise.all([
    prisma.tireType.findMany({
      where: { verifiedAt: null },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        displayName: true,
        modelCode: true,
        createdAt: true,
        brand: true,
        compound: true,
        surface: true,
        productUrl: true,
        sourceUrl: true,
      },
    }),
    prisma.additiveType.findMany({
      where: { verifiedAt: null },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, displayName: true, modelCode: true, createdAt: true },
    }),
    prisma.track.findMany({
      // Demo clones are unverified by construction — they are not review candidates.
      where: { ...trackCatalogScopeWhere(user), verifiedAt: null },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        name: true,
        location: true,
        latitude: true,
        longitude: true,
        createdAt: true,
      },
    }),
    prisma.setupSheetCalibration.findMany({
      where: { verifiedAt: null },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, name: true, sourceType: true, createdAt: true },
    }),
    // Chassis types a driver built. They go live for everyone the moment they are created, so
    // without this queue they stay flagged "unreviewed" forever with no way to promote them.
    // `userId: not null` keeps seeded catalog rows out — those are curated by construction.
    prisma.setupSheetModel.findMany({
      where: { isAuthorized: false, userId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        schemaJson: true,
        user: { select: { email: true } },
        _count: { select: { cars: true, calibrations: true } },
      },
    }),
    listPendingChassisTypeRequests(TAKE),
    loadBlankReviewQueue(),
  ]);

  // A chassis that came from an uploaded sheet gets the richer section below, which knows how much
  // of it is still unnamed. Without this it would be listed twice on the same page.
  const handBuiltChassis = chassisTypes.filter((m) => !blanks.modelIdsShown.has(m.id));

  // Delete is offered only for rows nothing references; anything in use must be merged.
  const [tireInUse, additiveInUse, trackInUse] = await Promise.all([
    tireTypeIdsInUse(tireTypes.map((t) => t.id)),
    additiveTypeIdsInUse(additiveTypes.map((a) => a.id)),
    trackIdsInUse(tracks.map((t) => t.id)),
  ]);

  const total =
    tireTypes.length +
    additiveTypes.length +
    tracks.length +
    calibrations.length +
    handBuiltChassis.length +
    chassisRequests.length +
    blanks.waiting.length +
    blanks.refusals.length;

  /** How much sheet is actually there — the one number that says whether it is worth promoting. */
  const chassisFieldCount = (schemaJson: unknown): number => {
    const fields = (schemaJson as { fields?: unknown[] } | null)?.fields;
    return Array.isArray(fields) ? fields.length : 0;
  };

  const fmt = (d: Date) => formatRunDateOnly(d, displayTimeZone);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/setup/admin" />
          <div>
            <h1 className="page-title">Review queue</h1>
            <p className="page-subtitle">
              {total === 0
                ? "Nothing waiting — the catalog is clean."
                : `${total} item${total === 1 ? "" : "s"} awaiting review.`}
            </p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-2xl space-y-4">
        {total === 0 ? (
          <CardPanel contentClassName="text-sm text-muted-foreground">
            No unverified catalog rows or open chassis requests. Newly created tires, tracks,
            additives, and calibrations will appear here for one-tap approval.
          </CardPanel>
        ) : null}

        <ReviewSection eyebrow="Tire types" empty={tireTypes.length === 0}>
          {tireTypes.map((t) => {
            const attrs = [t.brand, t.compound, t.surface].filter(Boolean).join(" · ");
            return (
              <ReviewRow
                key={t.id}
                title={t.displayName}
                meta={`${attrs || t.modelCode} · ${fmt(t.createdAt)}`}
                sourceUrl={t.productUrl ?? t.sourceUrl ?? undefined}
                endpoint={`/api/tire-types/${t.id}`}
                openHref="/tires"
                deletable={!tireInUse.has(t.id)}
                merge={{ type: "tire", label: t.displayName }}
              />
            );
          })}
        </ReviewSection>

        <ReviewSection eyebrow="Additive types" empty={additiveTypes.length === 0}>
          {additiveTypes.map((a) => (
            <ReviewRow
              key={a.id}
              title={a.displayName}
              meta={`${a.modelCode} · ${fmt(a.createdAt)}`}
              endpoint={`/api/additive-types/${a.id}`}
              openHref="/additives"
              deletable={!additiveInUse.has(a.id)}
            />
          ))}
        </ReviewSection>

        <ReviewSection eyebrow="Tracks" empty={tracks.length === 0}>
          {tracks.map((t) => {
            const hasGps = t.latitude != null && t.longitude != null;
            const metaParts = [t.location?.trim() || "no location", hasGps ? "GPS" : "no GPS", fmt(t.createdAt)];
            return (
              <ReviewRow
                key={t.id}
                title={t.name}
                meta={metaParts.join(" · ")}
                endpoint={`/api/tracks/${t.id}`}
                openHref={`/tracks/${t.id}`}
                deletable={!trackInUse.has(t.id)}
                merge={{ type: "track", label: t.name }}
              />
            );
          })}
        </ReviewSection>

        <ReviewSection eyebrow="Calibrations" empty={calibrations.length === 0}>
          {calibrations.map((c) => (
            <ReviewRow
              key={c.id}
              title={c.name}
              meta={`${c.sourceType} · ${fmt(c.createdAt)}`}
              endpoint={`/api/setup-calibrations/${c.id}`}
              openHref={`/setup-calibrations/${c.id}`}
            />
          ))}
        </ReviewSection>

        <ReviewSection eyebrow="Setup sheets drivers uploaded" empty={blanks.waiting.length === 0}>
          {blanks.waiting.map((b) => (
            <li key={b.blankId} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <Link
                  href={`/setup-sheet-models/${b.modelId}`}
                  className="block truncate text-xs text-foreground hover:underline"
                >
                  {b.chassisName}
                </Link>
                <div className="text-[10px] text-muted-foreground">
                  {b.uploaderEmail ?? "uploader has gone"} · {fmt(b.uploadedAt)} · {b.boxCount} boxes
                  {b.namedCount > 0 ? `, ${b.namedCount} described` : ""}
                  {b.carCount > 0 ? ` · ${b.carCount} car(s)` : ""}
                  {b.pageCount > 1 ? ` · ${b.pageCount} pages` : ""}
                </div>
                {b.typedNameIfDifferent ? (
                  <div className="text-[10px] text-faint">
                    uploaded as &ldquo;{b.typedNameIfDifferent}&rdquo;
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/setup-sheet-models/${b.modelId}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                >
                  Open
                </Link>
                <SetupSheetModelAuthorizeToggle modelId={b.modelId} isAuthorized={false} />
              </div>
            </li>
          ))}
        </ReviewSection>

        {blanks.nameClashes.length > 0 ? (
          <div className="space-y-2">
            <div className="px-1">
              <Eyebrow>Same name, different sheet</Eyebrow>
            </div>
            <SurfaceCard variant="panel" contentClassName="p-0">
              <ul className="divide-y divide-border">
                {blanks.nameClashes.map((group) => (
                  <li key={group.name} className="space-y-1 px-4 py-2">
                    <div className="text-xs text-foreground">{group.name}</div>
                    <ul className="space-y-0.5">
                      {group.rows.map((r, i) => (
                        <li key={r.modelId} className="flex items-baseline gap-2 text-[10px]">
                          <span className="text-muted-foreground">{i === 0 ? "keep?" : "or"}</span>
                          <Link
                            href={`/setup-sheet-models/${r.modelId}`}
                            className="truncate text-foreground hover:underline"
                          >
                            {r.boxCount} boxes · {r.carCount} car(s) ·{" "}
                            {r.isAuthorized ? "authorized" : "unreviewed"} · {fmt(r.uploadedAt)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-faint">
                      Two different files. They are not merged, because each driver&rsquo;s saved
                      values are keyed to the boxes on their own sheet.
                    </p>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          </div>
        ) : null}

        <ReviewSection eyebrow="Sheets nothing could be read from" empty={blanks.refusals.length === 0}>
          {blanks.refusals.map((r) => (
            <li key={r.blankId} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs text-foreground">{r.typedName}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {r.status === "NOT_FILLABLE" ? "nothing to type into" : "unreadable"} ·{" "}
                  {r.filename ?? "file gone"} · {r.uploaderEmail ?? "uploader has gone"} ·{" "}
                  {fmt(r.uploadedAt)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.documentId ? (
                  <a
                    href={`/api/setup-documents/${r.documentId}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    Open PDF
                  </a>
                ) : null}
                <BlankReviewedButton blankId={r.blankId} reviewed={false} />
              </div>
            </li>
          ))}
        </ReviewSection>

        <ReviewSection eyebrow="Chassis types built by hand" empty={handBuiltChassis.length === 0}>
          {handBuiltChassis.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <Link
                  href={`/setup-sheet-models/${m.id}/schema`}
                  className="block truncate text-xs text-foreground hover:underline"
                >
                  {m.name}
                </Link>
                <div className="text-[10px] text-muted-foreground">
                  {m.user?.email ?? "unknown"} · {fmt(m.createdAt)} ·{" "}
                  {chassisFieldCount(m.schemaJson)} fields
                  {m._count.cars > 0 ? ` · ${m._count.cars} car(s)` : ""}
                  {m._count.calibrations > 0 ? ` · ${m._count.calibrations} calibration(s)` : ""}
                </div>
              </div>
              <SetupSheetModelAuthorizeToggle modelId={m.id} isAuthorized={false} />
            </li>
          ))}
        </ReviewSection>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <Eyebrow>Chassis type requests</Eyebrow>
            <Link
              href="/setup-sheet-models"
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
            >
              Add one
            </Link>
          </div>
          <SurfaceCard variant="panel" contentClassName="p-0">
            {chassisRequests.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">No open requests.</div>
            ) : (
              <ul className="divide-y divide-border">
                {chassisRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">{r.requestedName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.requesterEmail ?? "unknown"} · {fmt(r.createdAt)}
                        {r.requestCount > 1 ? ` · asked ${r.requestCount}x` : ""}
                      </div>
                    </div>
                    <ChassisRequestResolveButton id={r.id} />
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </div>
      </section>
    </>
  );
}

function ReviewSection({
  eyebrow,
  empty,
  children,
}: {
  eyebrow: string;
  empty: boolean;
  children: ReactNode;
}): ReactNode {
  if (empty) return null;
  return (
    <div className="space-y-2">
      <div className="px-1">
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <SurfaceCard variant="panel" contentClassName="p-0">
        <ul className="divide-y divide-border">{children}</ul>
      </SurfaceCard>
    </div>
  );
}

function ReviewRow({
  title,
  meta,
  endpoint,
  openHref,
  deletable = false,
  merge,
  sourceUrl,
}: {
  title: string;
  meta: string;
  endpoint: string;
  openHref: string;
  deletable?: boolean;
  merge?: { type: "tire" | "track"; label: string };
  sourceUrl?: string;
}): ReactNode {
  return (
    <li className="space-y-1.5 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-foreground">{title}</div>
          <div className="truncate text-[10px] text-muted-foreground">{meta}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
            >
              Source
            </a>
          ) : null}
          <Link
            href={openHref}
            className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          >
            Open
          </Link>
          {deletable ? <CatalogDeleteButton endpoint={endpoint} label={title} /> : null}
          <CatalogVerifyToggleButton endpoint={endpoint} verified={false} />
        </div>
      </div>
      {merge ? (
        <CatalogMergeControl type={merge.type} loserId={endpoint.split("/").pop()!} loserLabel={merge.label} />
      ) : null}
    </li>
  );
}
