/**
 * The grid of boxes clicked while naming a parameter in the calibration editor: one row per
 * position, one column per option box within that position. `null` is a slot still waiting for its
 * box.
 *
 * Kept pure and separate from the editor component because the walk order *is* the interaction —
 * a click fills the next empty cell, and getting that order wrong silently maps the rear row's
 * boxes onto the front row's options.
 */
export type PendingGrid = readonly (readonly (string | null)[])[];

export type PendingCell = { row: number; col: number };

/**
 * First cell matching `match`, row-major: across one position's option boxes, then on to the next
 * position (founder decision 2026-07-25 — it's the order a sheet prints a checkbox row).
 */
export function findPendingCell(
  grid: PendingGrid,
  match: (sourceKey: string | null) => boolean
): PendingCell | null {
  for (const [row, cells] of grid.entries()) {
    for (const [col, sourceKey] of cells.entries()) {
      if (match(sourceKey)) return { row, col };
    }
  }
  return null;
}

/**
 * Resize to `counts` columns per row, keeping whatever is already clicked at its coordinates.
 * Widening a row (simple kind → grouped) leaves column 0 alone; narrowing drops the tail.
 */
export function reshapePendingGrid(grid: PendingGrid, counts: readonly number[]): (string | null)[][] {
  return counts.map((n, row) =>
    Array.from({ length: n }, (_, col) => grid[row]?.[col] ?? null)
  );
}

/** Whether the shape already matches `counts` — lets a caller skip a no-op state update. */
export function pendingGridMatchesShape(grid: PendingGrid, counts: readonly number[]): boolean {
  return grid.length === counts.length && counts.every((n, i) => (grid[i]?.length ?? 0) === n);
}

/** Every box clicked so far, row-major, holes dropped. */
export function pendingGridSourceKeys(grid: PendingGrid): string[] {
  return grid.flat().filter((k): k is string => k !== null);
}
