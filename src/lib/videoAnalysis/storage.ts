import "server-only";

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const LOCAL_ROOT = path.join(process.cwd(), ".local-uploads", "video-analysis");

/** Reference stills and large local videos (dev / Capacitor — not for Vercel serverless bodies). */
export async function storeVideoAnalysisLocalFile(
  file: File,
  subdir: "reference" | "videos"
): Promise<{ storagePath: string; absolutePath: string }> {
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : ".jpg";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const dir = path.join(LOCAL_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, bytes);
  const storagePath = `/uploads/video-analysis/${subdir}/${filename}`;
  return { storagePath, absolutePath };
}

export function localPathFromStorageRef(storagePath: string): string | null {
  if (!storagePath.startsWith("/uploads/video-analysis/")) return null;
  const rel = storagePath.replace("/uploads/", "");
  return path.join(process.cwd(), ".local-uploads", rel);
}
