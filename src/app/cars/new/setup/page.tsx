import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { CarSetupWizardClient } from "@/components/cars/CarSetupWizardClient";

export default async function CarNewSetupPage() {
  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");

  return (
    <section className="page-body space-y-4">
      <div>
        <Link href="/cars" className="text-xs text-muted-foreground hover:text-foreground">
          ← Cars
        </Link>
        <h1 className="ui-title mt-2 text-lg">New car & setup sheet</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl">
          Define the parameter list for this car model, upload your setup PDF, then map fields in the calibration
          editor.
        </p>
      </div>
      <CarSetupWizardClient />
    </section>
  );
}
