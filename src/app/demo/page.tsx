import { DemoEntryScreen } from "@/components/demo/DemoEntryScreen";
import { getDemoSeasonFacts } from "@/lib/demo/demoSeasonFacts";

/**
 * Demo entry (MONETISATION_NORTH_STAR.md Phase 3). A server shell that reads the season's
 * real facts, wrapping a client screen that does the navigating — NOT a server redirect, so
 * that a <Link> prefetch of /demo can never mint sign-in tokens; the token is only created
 * when a real browser lands here and follows /api/auth/demo.
 *
 * The facts read is cached for an hour (getDemoSeasonFacts) and every field is optional, so
 * this stays a cheap render even on a box with no seeded demo account.
 */
export default async function DemoEntryPage() {
  const facts = await getDemoSeasonFacts();
  return <DemoEntryScreen facts={facts} />;
}
