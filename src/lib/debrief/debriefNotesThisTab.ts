/**
 * The debrief box's memory for the life of the tab: per meeting, the newest note the server
 * confirmed from here, and whatever was typed that no save has confirmed yet.
 *
 * Why it exists (bug found 2026-09-17). `DebriefCard` is uncontrolled and is drawn afresh
 * every time the Sessions pane changes — another day, a run opened and closed, the phone's
 * back gesture — and each time it started from the page's copy of the note. That copy is the
 * page as it was loaded: picking a day is client state, not a trip to the server, so it never
 * sees a save made since. A saved note came back as the old one, a cleared note came back
 * whole, and anything typed into that stale box saved over the real note.
 *
 * A reload empties this, and by then the server's copy is current. Everything here is written
 * from browser events only, so the server's instance of the module never holds anything.
 */

export type DebriefNote = { text: string; updatedAtIso: string | null };

/**
 * A save the server answered, stamped with the server's clock at the write. The row's own time
 * can't do that job alone: a cleared note has no row.
 */
export type ConfirmedDebriefNote = DebriefNote & { savedAtIso: string };

const confirmedByMeeting = new Map<string, ConfirmedDebriefNote>();
const draftByMeeting = new Map<string, string>();

/**
 * The page's copy, unless this tab has saved since. The page only wins when the server wrote
 * its copy after that save — the note was changed somewhere else and the page loaded again.
 * Both stamps come from `toISOString`, so string order is time order.
 */
export function newestDebriefNote(
  page: DebriefNote,
  mine: ConfirmedDebriefNote | undefined
): DebriefNote {
  if (!mine) return page;
  if (page.updatedAtIso != null && page.updatedAtIso > mine.savedAtIso) return page;
  return { text: mine.text, updatedAtIso: mine.updatedAtIso };
}

/**
 * What a card opens with: the newest saved note, and the text its box should hold — an
 * unconfirmed draft if there is one (its save failed, or is still on its way on a slow
 * signal), else the saved note.
 */
export function openDebriefNote(
  meetingKey: string,
  page: DebriefNote
): { saved: DebriefNote; boxText: string } {
  const saved = newestDebriefNote(page, confirmedByMeeting.get(meetingKey));
  return { saved, boxText: draftByMeeting.get(meetingKey) ?? saved.text };
}

/** Every keystroke, so a card drawn again mid-save opens on what was typed, not on the page. */
export function rememberDebriefDraft(meetingKey: string, text: string): void {
  draftByMeeting.set(meetingKey, text);
}

/** A draft the server already holds is no longer a draft. The server stores the text trimmed. */
export function settleDebriefDraft(meetingKey: string, savedText: string): void {
  if (draftByMeeting.get(meetingKey)?.trim() === savedText) draftByMeeting.delete(meetingKey);
}

/**
 * Record the server's answer and return the newest confirmed note. Two saves can cross in
 * flight, so an answer stamped earlier than one already recorded doesn't roll it back.
 */
export function confirmDebriefSave(meetingKey: string, answer: ConfirmedDebriefNote): DebriefNote {
  const known = confirmedByMeeting.get(meetingKey);
  const newest = !known || answer.savedAtIso >= known.savedAtIso ? answer : known;
  confirmedByMeeting.set(meetingKey, newest);
  settleDebriefDraft(meetingKey, newest.text);
  return { text: newest.text, updatedAtIso: newest.updatedAtIso };
}
