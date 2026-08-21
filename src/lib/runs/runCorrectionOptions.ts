/**
 * The shape `GET /api/runs/[id]/correction-options` answers with — the lists the
 * session view's pickers may offer for one run.
 *
 * Type-only and Prisma-free, so the client component and the route that builds it
 * are held to the same shape by the compiler rather than by memory.
 */
export type RunCorrectionOptionRow = { id: string; label: string };

export type RunCorrectionOptions = {
  /** Every car the driver owns. */
  cars: RunCorrectionOptionRow[];
  /** Compounds the driver has actually run, most recent first, then the rest of the catalog. */
  tireTypes: RunCorrectionOptionRow[];
};
