import { hasDatabaseUrl } from "@/lib/env";
import { SetupPageClient } from "@/components/setup/SetupPageClient";

export default async function SetupPage() {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </div>
        </section>
      </>
    );
  }

  return <SetupPageClient />;
}
