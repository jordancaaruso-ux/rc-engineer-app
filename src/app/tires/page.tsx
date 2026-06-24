import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { ensureSeedTireTypes } from "@/lib/tires/ensureSeedTireTypes";
import { TireGaragePanel } from "@/components/tires/TireGaragePanel";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

export const revalidate = 30;

export default async function TiresPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">Tires</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage tires.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const isAdmin = isAuthAdminEmail(user.email);
  const count = await prisma.tireType.count();
  if (count === 0) {
    await ensureSeedTireTypes();
  }
  const tireTypes = await prisma.tireType.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, modelCode: true },
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">Tires</h1>
            <p className="page-subtitle">Tire type catalog.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <TireGaragePanel initialTireTypes={tireTypes} isAdmin={isAdmin} />
        </div>
      </section>
    </>
  );
}
