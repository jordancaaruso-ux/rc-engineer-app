/**
 * Swallow taps for a beat after a card or overlay dismisses itself.
 *
 * Measured 2026-08-18 on a fresh account: the "Get set up" card's Ignore button
 * sits at the very top-right of the dashboard's first card, and the moment the
 * card unmounts the "Start a new run" bar jumps up and occupies the exact pixel
 * the finger was on — `document.elementFromPoint` at the Ignore centre goes from
 * the button to the CTA's link in the same frame. A second tap (an impatient
 * double tap, or a touch the webview replays as a ghost click) therefore lands on
 * the CTA, and with no car yet that lands on "Add a car first" — so tapping
 * Ignore reads as "it took me to add a car". Same shape on the welcome overlay,
 * whose buttons uncover whatever the dashboard has at those coordinates.
 *
 * The guard is a plain DOM node, not React: the component that dismissed is
 * usually unmounting (or about to be dropped by `router.refresh()`), so anything
 * tied to its lifecycle would disappear before the window it has to cover. The
 * removal timer is owned by the node, so it always lifts.
 */
const GUARD_MS = 400;

export function guardTapsAfterDismiss(ms: number = GUARD_MS): void {
  if (typeof document === "undefined") return;
  const shield = document.createElement("div");
  shield.setAttribute("aria-hidden", "true");
  shield.dataset.dismissTapGuard = "";
  // Above the dock and every overlay; transparent, so nothing visibly happens.
  shield.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:transparent;touch-action:none";
  document.body.appendChild(shield);
  window.setTimeout(() => shield.remove(), ms);
}
