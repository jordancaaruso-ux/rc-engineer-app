import { redirect } from "next/navigation";

/** Legacy two-file overlay — use unified video analysis (single file + lap sync). */
export default function VideoOverlayPage() {
  redirect("/videos/analysis/manual/new");
}
