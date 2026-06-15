import { redirect } from "next/navigation";

/** Lap sync is the primary video analysis flow — skip the old sector-analysis hub. */
export default function VideoAnalysisPage() {
  redirect("/videos/analysis/manual/new");
}
