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

/**
 * Copy a setup you can see but don't own — a teammate's session — onto one of your cars.
 *
 * Copies rather than marks, because marking would put the row in THEIR library. The values are
 * frozen at this moment: they can edit or delete theirs afterwards and yours is untouched. The
 * server re-checks that you may see the source run and that the car reads the same sheet.
 */
export async function copySetupToCar(input: {
  setupId: string;
  carId: string;
  name: string;
}): Promise<{ id: string }> {
  const res = await fetch("/api/setup-snapshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      carId: input.carId,
      name: input.name,
      fromSetupSnapshotId: input.setupId,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not save this setup.");
  }
  const body = (await res.json()) as { setup: { id: string } };
  return { id: body.setup.id };
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
