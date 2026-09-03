"use client";

/**
 * Local-first clip playback: attach a video file from THIS device to a surface that
 * wants to play sector clips, without uploading a byte. The storage doctrine
 * (VIDEO_ANALYSIS_REWORK, locked 2026-07-12) keeps heat videos on the phone; this
 * hook is what lets the run page's compare section play footage anyway.
 *
 * Where the File System Access API exists (Chromium desktop), the picked file's
 * HANDLE is remembered per key in IndexedDB, so the next visit is one "Reopen" tap
 * plus the browser's permission chip instead of a re-browse. Everywhere else
 * (iOS Safari, Firefox) it degrades to a plain file pick — on a phone that's the
 * camera roll, which is where the video lives anyway. Object URLs stay in the tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type PermState = "granted" | "denied" | "prompt";

/** Minimal structural type for FileSystemFileHandle — not in our TS lib set. */
export type LocalFileHandle = {
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission?(desc: { mode: "read" }): Promise<PermState>;
  requestPermission?(desc: { mode: "read" }): Promise<PermState>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (opts?: {
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    multiple?: boolean;
  }) => Promise<LocalFileHandle[]>;
};

const DB_NAME = "rc-local-video-handles";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbGet(key: string): Promise<LocalFileHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const rq = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as LocalFileHandle | undefined) ?? null);
      rq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function useLocalVideoSource(key: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  /** The File behind `url` — for a caller that wants to offer saving it to the library. */
  const [file, setFile] = useState<File | null>(null);
  /** A handle is stored for this key but not opened yet this visit. */
  const [rememberedName, setRememberedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const canRemember =
    typeof window !== "undefined" &&
    typeof (window as PickerWindow).showOpenFilePicker === "function";

  const setObjectUrl = useCallback((file: File | null) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (!file) {
      setUrl(null);
      setFileName(null);
      setFile(null);
      return;
    }
    const u = URL.createObjectURL(file);
    urlRef.current = u;
    setUrl(u);
    setFileName(file.name);
    setFile(file);
  }, []);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  // Surface a remembered handle's name on mount. No permission request here —
  // browsers only grant on a user gesture, so Reopen is always an explicit tap.
  useEffect(() => {
    let alive = true;
    setRememberedName(null);
    if (!key || !canRemember) return;
    void idbGet(key).then((h) => {
      if (alive && h?.name) setRememberedName(h.name);
    });
    return () => {
      alive = false;
    };
  }, [key, canRemember]);

  /** Plain-input path (iOS camera roll, Firefox) — no remembering possible. */
  const attachFile = useCallback(
    (file: File) => {
      setError(null);
      setObjectUrl(file);
    },
    [setObjectUrl]
  );

  /** FS Access picker — attaches AND remembers the handle for next visit. */
  const pickWithPicker = useCallback(async () => {
    setError(null);
    const w = window as PickerWindow;
    if (!w.showOpenFilePicker) return;
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [
          { description: "Video", accept: { "video/*": [".mp4", ".mov", ".webm"] } },
        ],
        multiple: false,
      });
      if (!handle) return;
      const file = await handle.getFile();
      setObjectUrl(file);
      setRememberedName(handle.name);
      if (key) await idbSet(key, handle).catch(() => {});
    } catch (e) {
      // AbortError = the user closed the picker; not an error state.
      if ((e as DOMException | null)?.name !== "AbortError") {
        setError("Could not open that file.");
      }
    }
  }, [key, setObjectUrl]);

  const reopenRemembered = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!key) return false;
    const handle = await idbGet(key);
    if (!handle) {
      setRememberedName(null);
      return false;
    }
    try {
      let perm: PermState = "granted";
      if (handle.queryPermission) perm = await handle.queryPermission({ mode: "read" });
      if (perm !== "granted" && handle.requestPermission) {
        perm = await handle.requestPermission({ mode: "read" });
      }
      if (perm !== "granted") {
        setError("The browser blocked access — pick the file instead.");
        return false;
      }
      const file = await handle.getFile();
      setObjectUrl(file);
      return true;
    } catch {
      // The file moved or was renamed since last visit.
      setError("That file has moved — pick it again.");
      await idbDel(key).catch(() => {});
      setRememberedName(null);
      return false;
    }
  }, [key, setObjectUrl]);

  /**
   * Reopen the remembered file ONLY if the browser already holds permission — never
   * prompts, never raises an error, never clears the handle. The sibling of
   * `reopenRemembered`, for the load path: a permission request needs a user gesture, so
   * calling that one on mount would set the "browser blocked access" error against a
   * driver who never asked for anything. This one just returns false and stays quiet, and
   * the visible Reopen control is still there for the tap that can prompt.
   */
  const reopenIfGranted = useCallback(async (): Promise<boolean> => {
    if (!key) return false;
    const handle = await idbGet(key);
    if (!handle) return false;
    try {
      if (handle.queryPermission) {
        const perm = await handle.queryPermission({ mode: "read" });
        if (perm !== "granted") return false;
      }
      setObjectUrl(await handle.getFile());
      return true;
    } catch {
      // Moved, renamed, or permission withdrawn — the tap path reports it properly.
      return false;
    }
  }, [key, setObjectUrl]);

  const clear = useCallback(() => setObjectUrl(null), [setObjectUrl]);

  return {
    url,
    file,
    fileName,
    rememberedName,
    canRemember,
    attachFile,
    pickWithPicker,
    reopenRemembered,
    reopenIfGranted,
    clear,
    error,
  };
}
