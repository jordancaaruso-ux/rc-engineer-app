import { createHash } from "node:crypto";
import { isAuthAdminEmail } from "@/lib/authAdminLogic";

export type GoldSetCase = {
  id: string;
  tags?: string[];
  question: string;
  runId?: string | null;
  compareRunId?: string | null;
};

export function hashQuestion(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function shouldCaptureGoldSetCandidate(userEmail: string | null | undefined): boolean {
  return isAuthAdminEmail(userEmail);
}

export function slugifyGoldCaseId(question: string, taken: Set<string>): string {
  const base =
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "case";
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

export function mergeGoldSetCases(staticCases: GoldSetCase[], extra: GoldSetCase[]): GoldSetCase[] {
  const seen = new Set<string>();
  const out: GoldSetCase[] = [];
  for (const c of [...staticCases, ...extra]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function goldCasesFromCandidates(
  rows: Array<{
    promotedCaseId: string | null;
    id: string;
    question: string;
    runId: string | null;
    compareRunId: string | null;
  }>
): GoldSetCase[] {
  return rows.map((row) => ({
    id: row.promotedCaseId ?? `auto-${row.id.slice(0, 8)}`,
    question: row.question,
    runId: row.runId,
    compareRunId: row.compareRunId,
    tags: ["auto-captured"],
  }));
}
