/**
 * Following a Lab seed's reference back to the row it came from.
 *
 * ============================== WHY THE LAB FETCHES AT ALL ==============================
 *
 * A Lab link carries the geometry slice: 19 field keys, base64 in the URL. That is what makes a link
 * shareable with no session and no car, and it stays the Lab's only *required* input. But the slice
 * cannot draw a sheet. An A800RR sheet is getting on for 300 boxes; showing a driver their own setup
 * with 280 of them blank would not read as "the geometry Lab", it would read as data loss — and a
 * save built on that view really would be data loss.
 *
 * So when a seed names its source, the Lab fetches the whole setup. The URL still carries no data
 * that the viewer's own session doesn't already entitle them to: both routes below re-check access
 * server-side, and a reference to a row you cannot read simply fails to load.
 *
 * ============================== WHY `write` IS DECIDED HERE ==============================
 *
 * What the Lab may do with a setup is not the Lab's choice — it is already settled by the API:
 * `PATCH /api/setup-snapshots/[id]` refuses a `data` write on any snapshot a run points at, because
 * that snapshot IS what the run recorded. Rather than let the Lab draw a button and discover the 409
 * afterwards, the destination is resolved at load time and the button is labelled with the truth.
 */

import {
  extractGeometryFields,
  type LabFields,
  type LabSource,
} from "@/lib/rollCenter/labState";

/** Where a save from this slot is allowed to land. */
export type LabWriteTarget =
  /** A saved setup no run points at — writable in place. */
  | { kind: "in-place"; setupId: string }
  /** This run's own record: never overwritten, corrected by writing a new snapshot. */
  | { kind: "run"; runId: string }
  /** Someone else's, or a row with history behind it — the only honest exit is a copy. */
  | { kind: "copy"; carId: string | null };

export type LabSourceLoad = {
  /** The geometry slice, for the sliders and the solve. */
  fields: LabFields;
  /** Every stored value, so the sheet draws honestly and a save can merge rather than replace. */
  fullData: Record<string, unknown>;
  setupSheetModelId: string | null;
  write: LabWriteTarget;
  label: string | null;
};

/**
 * Write a Lab what-if back to the row it came from.
 *
 * Only two destinations actually write, and neither is chosen by the driver — the destination is a
 * property of what they opened (see the type above). Everything else exits through the run prefill,
 * which needs no row at all.
 *
 * `data` must be the WHOLE setup with the geometry changes merged in, never the geometry slice on
 * its own: these routes store what they are given, so a slice would erase springs, diffs and tyres.
 */
export async function saveLabSlot(
  write: LabWriteTarget,
  data: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const call = async (url: string, method: "PATCH", body: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true } as const;
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false as const, error: detail?.error ?? "That didn't save. Try again." };
  };

  if (write.kind === "in-place") {
    return call(`/api/setup-snapshots/${encodeURIComponent(write.setupId)}`, "PATCH", { data });
  }
  if (write.kind === "run") {
    /*
     * Deliberately the run route, not the snapshot route. This one writes a NEW snapshot and
     * repoints the run at it, so the setup the run originally recorded survives untouched — a
     * correction, not a rewrite of what the car was on.
     */
    return call(`/api/runs/${encodeURIComponent(write.runId)}/setup-snapshot`, "PATCH", {
      setupData: data,
    });
  }
  return { ok: false, error: "This setup isn't yours to change — use it for your next run instead." };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Load the setup a seed points at, or null when it can't be read.
 *
 * Null is not an error state for the caller: the Lab keeps whatever the URL slice gave it and simply
 * stays in sliders-only mode. A stale link, a deleted setup, or a teammate's row that stopped being
 * shared should all degrade to "the geometry still works", never to an error screen.
 */
export async function loadLabSource(source: LabSource): Promise<LabSourceLoad | null> {
  try {
    if (source.kind === "run") return await loadFromRun(source.id);
    return await loadFromSetup(source.id);
  } catch {
    return null;
  }
}

async function loadFromRun(runId: string): Promise<LabSourceLoad | null> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/setup-snapshot`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    isOwner?: boolean;
    run?: { car?: { setupSheetModelId?: string | null; id?: string | null } | null };
    setupSnapshot?: { data?: unknown } | null;
  };
  const fullData = asRecord(body.setupSnapshot?.data);
  if (!fullData) return null;

  const carId = body.run?.car?.id ?? null;
  return {
    fields: extractGeometryFields(fullData),
    fullData,
    setupSheetModelId: body.run?.car?.setupSheetModelId ?? null,
    // A teammate's run is readable and never writable — copying it onto your own car is the only move.
    write: body.isOwner ? { kind: "run", runId } : { kind: "copy", carId },
    label: null,
  };
}

async function loadFromSetup(setupId: string): Promise<LabSourceLoad | null> {
  const res = await fetch(`/api/setup-snapshots/${encodeURIComponent(setupId)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    setup?: {
      name?: string | null;
      data?: unknown;
      carId?: string | null;
      setupSheetModelId?: string | null;
      runCount?: number;
    };
  };
  const setup = body.setup;
  const fullData = asRecord(setup?.data);
  if (!setup || !fullData) return null;

  /*
   * A library setup with runs behind it is the same row as one of those runs' records — saving from
   * "All setups" marks, it does not copy. So it carries history, and which run to correct is
   * ambiguous once there is more than one. Copy is the only unambiguous answer.
   */
  const write: LabWriteTarget =
    (setup.runCount ?? 0) > 0
      ? { kind: "copy", carId: setup.carId ?? null }
      : { kind: "in-place", setupId };

  return {
    fields: extractGeometryFields(fullData),
    fullData,
    setupSheetModelId: setup.setupSheetModelId ?? null,
    write,
    label: setup.name ?? null,
  };
}
