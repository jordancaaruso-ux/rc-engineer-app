/** Local-midnight helpers for “event is on today” checks (dashboard + event lap detection). */

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Event calendar range includes today (local midnight boundaries). */
export function eventIsActiveOnLocalToday(ev: { startDate: Date; endDate: Date }): boolean {
  const today = startOfLocalDay(new Date());
  const start = startOfLocalDay(ev.startDate);
  const end = startOfLocalDay(ev.endDate);
  return start.getTime() <= today.getTime() && today.getTime() <= end.getTime();
}
