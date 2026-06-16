import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { ensureSeedTireTypes } from "@/lib/tires/ensureSeedTireTypes";
import { TireGaragePanel } from "@/components/tires/TireGaragePanel";

export const revalidate = 30;

export default async function TiresPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Tires</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage tires.
          </div>
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
        <div>
          <h1 className="page-title">Tires</h1>
          <p className="page-subtitle">Tire type catalog.</p>
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
