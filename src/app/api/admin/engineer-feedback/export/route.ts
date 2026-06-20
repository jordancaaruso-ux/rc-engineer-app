import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import {
  fetchFeedbackInboxEntries,
  isFeedbackFilesystemExportMode,
  serializeInboxJsonl,
  serializeInboxMarkdown,
  writeFeedbackInboxFiles,
} from "@/lib/engineerFeedback/exportFeedbackInbox";
import { buildStoreOnlyZip } from "@/lib/engineerFeedback/zipStore";

export async function POST() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const entries = await fetchFeedbackInboxEntries();

  if (isFeedbackFilesystemExportMode()) {
    const { count } = await writeFeedbackInboxFiles(entries);
    return NextResponse.json({
      ok: true,
      mode: "filesystem",
      count,
      message: "Exported to docs/engineer-feedback/",
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const zip = buildStoreOnlyZip([
    { name: "inbox.jsonl", content: serializeInboxJsonl(entries) },
    { name: "inbox.md", content: serializeInboxMarkdown(entries) },
  ]);

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="engineer-feedback-inbox-${stamp}.zip"`,
    },
  });
}
