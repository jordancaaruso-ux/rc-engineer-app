/**
 * What the Save control inside a session needs to know, decided on the server.
 *
 * The client never works out whether it may save something: it is told. `GET
 * /api/runs/[id]/setup-snapshot` builds this after its own access check, and the control below it
 * only renders what it is handed. Lives here rather than beside that route so the button can import
 * the type without pulling a `server-only` module into the browser bundle.
 */
export type SetupSaveContext = {
  /**
   * - `mark` — your own run: flip `isLibrary` on the snapshot it already points at, no copy.
   * - `copy` — a teammate's run: write a new setup of your own onto one of your cars.
   * - `none` — the run has no setup to save.
   */
  action: "mark" | "copy" | "none";
  /**
   * Already in your setups. Only ever true for `mark` — a copy leaves no link back to its source,
   * so on a teammate's run the honest answer is "can't tell" and the bookmark stays hollow.
   */
  saved: boolean;
  /** The name one tap would save it under. */
  name: string;
  /** For `copy`: your cars that read the same setup sheet, most recently driven first. */
  targetCars: Array<{ id: string; name: string }>;
  /** The chassis the setup is written for ("Xray X4"), or null when it's on the generic sheet. */
  chassisLabel: string | null;
};
