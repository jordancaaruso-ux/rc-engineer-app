/**
 * The shape `GET /api/runs/[id]/correction-options` answers with — the lists the
 * session view's pickers may offer for one run.
 *
 * Type-only and Prisma-free, so the client component and the route that builds it
 * are held to the same shape by the compiler rather than by memory.
 */
export type RunCorrectionOptionRow = {
  id: string;
  label: string;
  /**
   * Heading this row sits under in the picker sheet, or absent for one flat list.
   *
   * The server already knows which compounds are the driver's recent ones — it
   * sorts them to the front. In a native `<select>` that ordering was all there
   * was; in a searchable sheet an unlabelled list that runs 12 rows and then
   * restarts at "A" reads as a sorting bug, so the break gets a name.
   */
  group?: string;
};

export type RunCorrectionOptions = {
  /** Every car the driver owns. */
  cars: RunCorrectionOptionRow[];
  /** Compounds the driver has actually run, most recent first, then the rest of the catalog. */
  tireTypes: RunCorrectionOptionRow[];
};
