import type { ReactNode } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { SetupAggregationsDebugClient } from "@/components/setup/SetupAggregationsDebugClient";

export default async function SetupAggregationsDebugPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup aggregations (debug)</h1>
            <p className="page-subtitle">DATABASE_URL is not set.</p>
          </div>
        </header>
      </>
    );
  }

  const user = await requireCurrentUser();
  const cars = await prisma.car.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, chassis: true },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup aggregations (debug)</h1>
          <p className="page-subtitle">
            Car × parameter stats from eligible parsed snapshots —{" "}
            <Link href="/setup" className="underline underline-offset-2">
              Back to setup
            </Link>
          </p>
        </div>
      </header>
      <section className="page-body">
        <SetupAggregationsDebugClient initialCars={cars} />
      </section>
    </>
  );
}
