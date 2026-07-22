import { redirect } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { NewChassisTypeClient } from "@/components/setup-sheet-models/NewChassisTypeClient";
import { PageBackLink } from "@/components/ui/PageBackLink";

export default async function NewChassisTypePage() {
  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");
  // Chassis types are curated global setup sheets — only an admin adds new ones.
  if (!isAuthAdminEmail(user.email)) redirect("/setup-sheet-models");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/setup-sheet-models" />
          <div>
            <h1 className="page-title">New chassis type</h1>
            <p className="page-subtitle">Name it, upload the blank sheet, then map it box by box.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <NewChassisTypeClient />
      </section>
    </>
  );
}
