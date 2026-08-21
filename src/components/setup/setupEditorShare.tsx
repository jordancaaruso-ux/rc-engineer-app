"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Lets the Share button at the top of the setup editor see what the editor below it is doing.
 *
 * Two facts cross this line, and both exist for the same reason: **the share picture is drawn on
 * the server from what is STORED**, never from the boxes on screen.
 *
 *  - `dirty` — there are unsaved changes, so a share right now would send the old numbers with
 *    nothing on screen admitting it. The button says so instead of sending.
 *  - `savedCount` — a counter that ticks on every save. It rides along in the picture's URL, and
 *    that is the whole point: `useShareFiles` caches a drawn picture against its URL and never
 *    re-draws it, so without a URL that moves, tapping Share after an edit-and-save would hand the
 *    driver the picture drawn when the page first loaded. The two belong together — telling
 *    somebody to save first, and then sending their pre-save sheet, is worse than not asking.
 *
 * The context has a resting default, so `ShareSetupButton` works unchanged on the setup details
 * page, where nothing is editable and there is no provider.
 */

export type SetupEditorShareState = {
  dirty: boolean;
  savedCount: number;
};

const REST: SetupEditorShareState = { dirty: false, savedCount: 0 };

const SetupEditorShareContext = createContext<{
  state: SetupEditorShareState;
  publish: (state: SetupEditorShareState) => void;
} | null>(null);

export function SetupEditorShareProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SetupEditorShareState>(REST);

  // Identity-stable, and a no-op when nothing moved: the editors publish on every render of
  // theirs, and a fresh object each time would loop the provider against them forever.
  const publish = useCallback((next: SetupEditorShareState) => {
    setState((prev) =>
      prev.dirty === next.dirty && prev.savedCount === next.savedCount ? prev : next
    );
  }, []);

  const value = useMemo(() => ({ state, publish }), [state, publish]);

  return (
    <SetupEditorShareContext.Provider value={value}>{children}</SetupEditorShareContext.Provider>
  );
}

/** Read by the Share button. No provider means a page with nothing to save — the resting state. */
export function useSetupEditorShareState(): SetupEditorShareState {
  return useContext(SetupEditorShareContext)?.state ?? REST;
}

/**
 * Why Share won't send, under the button row rather than inside it — the sentence is wider than
 * any button, and as a flex item it wraps the ones beside it onto a second line.
 *
 * Said BEFORE the tap, not after. A dialog would be the obvious way to ask and would break the
 * share outright: WebKit only opens the share sheet while the tap that asked for it is still live,
 * so anything interrupting the gesture costs the very thing the button is for.
 */
export function SetupEditorShareNote() {
  const { dirty } = useSetupEditorShareState();
  if (!dirty) return null;
  return (
    <p className="ui-caption px-1">Sharing sends the saved sheet. Save your changes first.</p>
  );
}

/** Called by each editor client, so the button above it knows where the setup stands. */
export function useReportSetupEditorState(dirty: boolean, savedCount: number): void {
  const ctx = useContext(SetupEditorShareContext);
  const publish = ctx?.publish;
  useEffect(() => {
    publish?.({ dirty, savedCount });
  }, [publish, dirty, savedCount]);
}
