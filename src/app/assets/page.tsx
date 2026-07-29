import { redirect } from "next/navigation";

/**
 * The Garage hub is gone (founder call 2026-07-29). It duplicated `/cars` — same setup lists,
 * one row deeper — and mixed in shared catalogs that now live under Settings. Kept as a redirect
 * for bookmarks, the iOS shell, and any saved home-screen link.
 */
export default function AssetsHubRedirectPage() {
  redirect("/cars");
}
