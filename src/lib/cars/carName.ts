/**
 * Two cars in one garage may not share a name.
 *
 * Nothing in the app addresses a car by anything but its name — the run form's picker, the
 * teammate compare list, the Engineer's "which car is this?" line — so a second "A800RR" is not a
 * duplicate row, it is two rows the driver can no longer tell apart. Matching is case- and
 * whitespace-insensitive because "a800rr " and "A800RR" read as the same car to a human, and the
 * human is the one who has to pick.
 */
export function normalizeCarName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * The existing car whose name collides with `name`, or null. Pass `exceptCarId` when renaming, so
 * a car does not collide with itself.
 */
export function findCarNameClash<T extends { id: string; name: string }>(
  cars: readonly T[],
  name: string,
  exceptCarId?: string | null
): T | null {
  const wanted = normalizeCarName(name);
  if (!wanted) return null;
  return (
    cars.find((c) => c.id !== exceptCarId && normalizeCarName(c.name) === wanted) ?? null
  );
}

/** What the driver is told, on the form and from the API, in one place. */
export function carNameTakenMessage(existingName: string): string {
  return `You already have a car called “${existingName}”. Give this one a different name.`;
}
