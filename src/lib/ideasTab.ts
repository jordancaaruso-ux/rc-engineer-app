/**
 * Shared plumbing for the notes tab's "open me" nudge.
 *
 * Lives out here rather than on `IdeasEdgeTab` for one reason: the thing that needs
 * to ANNOUNCE an add is `ActionItemListPanel`, and `IdeasEdgeTab` already imports
 * that panel. Hanging the event off the tab would make the two files import each
 * other, so the announcement lives in a module neither of them owns.
 *
 * A window event rather than a context provider, matching how the desktop rail
 * already reaches the panel (`openIdeasPanel`): the tab is mounted once at the shell
 * root and the add rows sit several levels down inside the dashboard, so a provider
 * would have to wrap the whole shell to serve one listener.
 */

const ITEM_ADDED_EVENT = "jrc:ideas-item-added";

/**
 * Remembers, per device, that this driver has opened the ideas panel at least once —
 * which permanently retires the idle nudge for them.
 *
 * localStorage and not the database, on purpose. This is a first-run hint: getting it
 * wrong costs one extra nudge on a new phone, whereas putting it on the user row would
 * cost a write on first open and a field in the dashboard payload for something no
 * other surface ever reads. Failures are swallowed because Safari throws on storage
 * access in private mode, and someone browsing privately should still get a working
 * tab rather than an exception.
 */
const OPENED_KEY = "jrc:ideas-opened";

export function hasOpenedIdeasPanel(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OPENED_KEY) === "1";
  } catch {
    // Storage blocked. Treat it as already-opened: better to skip the hint than to
    // nag someone forever because we cannot record that they answered it.
    return true;
  }
}

export function markIdeasPanelOpened(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPENED_KEY, "1");
  } catch {
    /* Private mode. The caller's in-memory flag still stops the nudge this session. */
  }
}

/** Announced after an item is successfully saved to either list. */
export function notifyIdeasItemAdded(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ITEM_ADDED_EVENT));
}

/** Returns its own unsubscribe, so an effect can hand it straight back. */
export function onIdeasItemAdded(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ITEM_ADDED_EVENT, handler);
  return () => window.removeEventListener(ITEM_ADDED_EVENT, handler);
}
