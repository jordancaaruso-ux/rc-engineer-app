/**
 * Is the on-screen keyboard covering the log-run wizard's bottom bar?
 *
 * The bar hides itself while the keyboard is up. Twice now that hide has stuck with no keyboard
 * on screen, and both times the bar was still there and still took taps — invisible, not gone:
 *
 *  - 2026-08-15: guessed from focus alone. The sheet holds one input focused for a whole editing
 *    session and iOS can drop the keyboard without dropping focus, so the guess stayed "open".
 *  - 2026-09-19: measured from the visual viewport alone. Anything else that makes the visual
 *    viewport short reads as a keyboard — a page left pinch-zoomed by as little as 1.2× hid the
 *    bar for good (reproduced), and a measurement taken mid-navigation had only a later `resize`
 *    to correct it, which may never come. The founder finished a run by tapping where the
 *    buttons used to be.
 *
 * So it takes BOTH, because each covers the other's lie. There is no keyboard without a text box
 * holding focus, so a stale or fooled measurement clears the moment focus leaves; and a held focus
 * with the keyboard dismissed measures as closed. The measurement is also taken in layout pixels
 * (`height × scale`), which a pinch-zoom leaves unchanged.
 */
export const KEYBOARD_MIN_PX = 120;

export function keyboardCoversBar(input: {
  /** A text box holds focus (`isTextEntry`). */
  focusedTextEntry: boolean;
  /** `window.innerHeight`. */
  layoutHeight: number;
  /** `visualViewport.height` / `.scale`, or null on a browser without one. */
  visualHeight: number | null;
  visualScale: number | null;
}): boolean {
  if (!input.focusedTextEntry) return false;
  // No visual viewport to measure: focus is all there is to go on.
  if (input.visualHeight == null) return true;
  const scale = input.visualScale && input.visualScale > 0 ? input.visualScale : 1;
  // 120px: above iOS URL-bar show/hide noise (~60px), well under any keyboard.
  return input.layoutHeight - input.visualHeight * scale > KEYBOARD_MIN_PX;
}
