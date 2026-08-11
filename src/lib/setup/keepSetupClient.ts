/**
 * Save a setup, or stop saving it — one definition of the call, for every surface that offers it.
 *
 * Marks the existing snapshot rather than copying it (see `api/setup-snapshots/[id]/save`), and
 * sends the name the row was already showing so one tap needs no question. The rename is offered
 * afterwards, in the toast.
 */
export async function keepSetup(input: {
  setupId: string;
  saved: boolean;
  /** The title the driver is looking at. Only used when the setup has no name yet. */
  name: string;
}): Promise<void> {
  const res = await fetch(`/api/setup-snapshots/${input.setupId}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: input.saved, name: input.name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not save this setup.");
  }
}

/** Rename a saved setup. Allowed even on a run's own record — only its values are frozen. */
export async function renameSetup(setupId: string, name: string): Promise<void> {
  const res = await fetch(`/api/setup-snapshots/${setupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not rename this setup.");
  }
}
