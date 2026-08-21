import { redirect } from "next/navigation";

/**
 * `/more` is gone (nav restructure 2026-08-18).
 *
 * It was the phone's overflow drawer: a menu word holding a dock cell, listing Events,
 * Garage and Tools as three doors that each needed a sentence to explain themselves. Events
 * and Garage are Paddock now, Tools stayed as doors on `/analysis`, and the cell went with
 * them.
 *
 * The route stays as a redirect rather than a 404 because it was linkable for six days and
 * the dock cell was the only way most people reached anything behind it — a bookmark or a
 * back-button landing here should arrive somewhere real.
 */
export default function MoreHubPage(): never {
  redirect("/paddock");
}
