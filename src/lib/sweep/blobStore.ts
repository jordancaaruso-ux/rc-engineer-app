import "server-only";

import { del, get, list, put } from "@vercel/blob";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tiny JSON document store for the sweep's schedule, on Vercel Blob (already a dependency) so a
 * quiet tick never touches Postgres. One store is shared by dev and prod, so every key is
 * prefixed by environment. Without a Blob token (local dev) documents live under
 * `.next/sweep-store/` instead, which keeps the whole sweep drivable on a laptop.
 *
 * Reads bypass the CDN cache: a schedule read five minutes stale is a schedule read wrong.
 */

const LOCAL_ROOT = path.join(process.cwd(), ".next", "sweep-store");

function token(): string | null {
  const t = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return t || null;
}

export function sweepKeyPrefix(): string {
  const env = process.env.SWEEP_BLOB_PREFIX?.trim() || process.env.VERCEL_ENV?.trim() || "dev";
  return `sweep/${env}/`;
}

function fullKey(key: string): string {
  return `${sweepKeyPrefix()}${key.replace(/^\/+/, "")}`;
}

function localPath(key: string): string {
  return path.join(LOCAL_ROOT, fullKey(key));
}

async function streamToText(stream: ReadableStream): Promise<string> {
  return new Response(stream).text();
}

export async function readDoc<T>(key: string): Promise<T | null> {
  const t = token();
  if (!t) {
    try {
      return JSON.parse(await readFile(localPath(key), "utf8")) as T;
    } catch {
      return null;
    }
  }
  try {
    const res = await get(fullKey(key), { access: "private", token: t, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return JSON.parse(await streamToText(res.stream)) as T;
  } catch {
    return null;
  }
}

export async function writeDoc<T>(key: string, doc: T): Promise<void> {
  const body = JSON.stringify(doc);
  const t = token();
  if (!t) {
    const p = localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, "utf8");
    return;
  }
  await put(fullKey(key), body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    token: t,
  });
}

export async function deleteDoc(key: string): Promise<void> {
  const t = token();
  if (!t) {
    try {
      await unlink(localPath(key));
    } catch {
      // already gone
    }
    return;
  }
  try {
    await del(fullKey(key), { token: t });
  } catch {
    // already gone
  }
}

/** Keys (relative to the environment prefix) under a folder such as `armed/`. */
export async function listDocs(folder: string): Promise<string[]> {
  const t = token();
  const prefix = fullKey(folder);
  if (!t) {
    try {
      const dir = path.join(LOCAL_ROOT, prefix);
      const names = await readdir(dir);
      return names.map((n) => `${folder}${n}`);
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token: t, limit: 1000, cursor });
    for (const b of page.blobs) out.push(b.pathname.slice(sweepKeyPrefix().length));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
