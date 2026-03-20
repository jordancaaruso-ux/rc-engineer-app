export default function DashboardPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Overview of your current car, tires, and run history.
          </p>
        </div>
      </header>
      <section className="page-body grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-secondary/40 p-4 md:col-span-2">
          <div className="text-xs font-mono text-muted-foreground mb-1">
            Session summary
          </div>
          <div className="text-sm text-muted-foreground">
            No runs logged yet. Start with{" "}
            <span className="font-semibold text-foreground">Log your run</span> to
            capture your first session.
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-4 flex flex-col gap-2">
          <div className="text-xs font-mono text-muted-foreground">
            Quick actions
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span>- Log a new run</span>
            <span>- Review last setup change</span>
            <span>- Ask the engineer for a plan</span>
          </div>
        </div>
      </section>
    </>
  );
}

