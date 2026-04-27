import type { ReactNode } from "react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { TeamsClient } from "./TeamsClient";

export const dynamic = "force-dynamic";

export default async function TeamsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Teams</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  await requireCurrentUser();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">
            Create a team, add members by email, and open shared sessions from the Sessions page. Run-level
            “share with team” is on the log / edit run form.
          </p>
        </div>
      </header>
      <section className="page-body">
        <TeamsClient />
      </section>
    </>
  );
}
