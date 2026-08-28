import { redirect } from "next/navigation";

/**
 * The old import bench, now a signpost.
 *
 * `/laps/import` was a workbench: paste a URL, get the parse back as raw JSON. It has been
 * replaced by `/laps/analysis`, which imports the same way and then actually reads the
 * session. The route stays because it is in bookmarks, in one dashboard card's history and
 * in any link shared before the change — and because `?sessionId=` was how a detected
 * session was opened, which now means "open the sheet on it".
 */
export default async function LapImportRedirectPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const search = (await props.searchParams) ?? {};
  const first = (v: string | string[] | undefined): string | null =>
    (Array.isArray(v) ? v[0] : v)?.trim() || null;

  const sessionId = first(search.sessionId);
  const eventId = first(search.eventId);
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (eventId) params.set("eventId", eventId);
  const query = params.toString();
  redirect(query ? `/laps/analysis?${query}` : "/laps/analysis");
}
