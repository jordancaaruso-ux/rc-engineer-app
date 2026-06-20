import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { SetupSheetModelSchemaPageClient } from "@/components/setup-sheet-models/SetupSheetModelSchemaPageClient";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; tab?: string }>;
};

export default async function SetupSheetModelSchemaPage({ params, searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return (
      <section className="page-body">
        <p className="text-sm text-muted-foreground">Database not configured.</p>
      </section>
    );
  }
  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;
  const returnTo = typeof sp.returnTo === "string" ? sp.returnTo.trim() : null;
  const initialTab = sp.tab === "parameters" ? "parameters" : "layout";
  const model = await prisma.setupSheetModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true, slug: true, schemaJson: true },
  });
  if (!model) {
    return (
      <section className="page-body">
        <p className="text-sm text-destructive">Sheet model not found.</p>
        <Link href="/cars" className="text-sm text-accent hover:underline mt-2 inline-block">
          Back to cars
        </Link>
      </section>
    );
  }

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) {
    return (
      <section className="page-body">
        <p className="text-sm text-destructive">Invalid schema data.</p>
      </section>
    );
  }

  return (
    <section className="page-body max-w-6xl">
      <div>
        <Link href="/cars" className="text-xs text-muted-foreground hover:text-foreground">
          ← Cars
        </Link>
        <h1 className="ui-title mt-2 text-lg">{model.name}</h1>
        <p className="text-xs text-muted-foreground font-mono">{model.slug}</p>
      </div>
      <SetupSheetModelSchemaPageClient
        modelId={model.id}
        modelName={model.name}
        initialSchema={schema}
        initialTab={initialTab}
        returnTo={returnTo}
      />
    </section>
  );
}
