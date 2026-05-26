/** User-scoped Next.js cache tag helpers. Never share tags across users. */
export function dashboardTag(userId: string): string {
  return `dashboard-${userId}`;
}

export function runsTag(userId: string): string {
  return `runs-${userId}`;
}

export function carsTag(userId: string): string {
  return `cars-${userId}`;
}

export function tracksTag(userId: string): string {
  return `tracks-${userId}`;
}
