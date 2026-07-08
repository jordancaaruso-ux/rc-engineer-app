import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { SetupSheetModelWizardClient } from "@/components/cars/CarSetupWizardClient";

export default async function SetupSheetModelNewSetupPage() {
  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");

  return (
    <section className="page-body">
      <div>
        <Link href="/setup-sheet-models" className="text-xs text-muted-foreground hover:text-foreground">
          ← Chassis types
        </Link>
        <h1 className="ui-title mt-2 text-lg">New setup sheet model</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl">
          Add a car <span className="font-medium text-foreground">type</span> to the app: upload its editable AcroForm
          PDF and the AI drafts the parameter list from the sheet&rsquo;s field boxes for you to review. Add your own
          car in Assets › Cars.
        </p>
      </div>
      <SetupSheetModelWizardClient />
    </section>
  );
}
