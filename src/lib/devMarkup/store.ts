import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where the markup notes live: a gitignored folder in the checkout, so they are trivially readable
 * from a terminal (`cat .markup/notes.json`) without a database round trip and never get committed
 * by accident. This is a dev-only scratch surface — see `api/_dev/markup/route.ts` for the guard.
 */
const DIR = path.join(process.cwd(), ".markup");
const FILE = path.join(DIR, "notes.json");

export type MarkupNote = {
  id: string;
  createdAt: string;
  /** Pathname the note was pinned on, so a route only ever shows its own pins. */
  route: string;
  kind: "pin" | "draw";
  text: string;
  /** Best-effort CSS selector for the element under the tap; re-resolved on load. */
  selector: string | null;
  tag: string | null;
  /** The element's own class attribute — usually the fastest way to find the component. */
  className: string | null;
  /** First line of the element's text, which is normally enough to identify it on sight. */
  label: string | null;
  /** Page coordinates, used when the selector no longer resolves. */
  x: number;
  y: number;
  /** Viewport at capture time — a note about a 390px layout means nothing at 1280px. */
  vw: number;
  vh: number;
  /** Freehand strokes as SVG path data, in page coordinates. Only on `kind: "draw"`. */
  paths?: string[];
  done?: boolean;
};

async function readAll(): Promise<MarkupNote[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MarkupNote[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(notes: MarkupNote[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

export async function listNotes(): Promise<MarkupNote[]> {
  return readAll();
}

/** Insert or replace by id, newest last. */
export async function upsertNote(note: MarkupNote): Promise<MarkupNote[]> {
  const notes = await readAll();
  const at = notes.findIndex((n) => n.id === note.id);
  if (at >= 0) notes[at] = note;
  else notes.push(note);
  await writeAll(notes);
  return notes;
}

/** Remove one note, or every note when `id` is omitted. */
export async function deleteNote(id?: string): Promise<MarkupNote[]> {
  if (!id) {
    await writeAll([]);
    return [];
  }
  const notes = (await readAll()).filter((n) => n.id !== id);
  await writeAll(notes);
  return notes;
}
