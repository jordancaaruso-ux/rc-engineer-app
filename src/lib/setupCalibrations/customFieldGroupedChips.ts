import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import { isSingleSelectGroupedBehavior } from "@/lib/setupCalibrations/types";

export type CustomGroupedChipEntry = { value: string; label: string };

/**
 * When a custom field has groupedOptions (2+), enable the same pick-chip → click-PDF
 * workflow as catalog Awesomatix fields. Returns null if this key is not a custom grouped field.
 */
export function customFieldGroupedChipContext(
  def: CustomSetupFieldDefinition | undefined
): { kind: "single" | "multi"; entries: CustomGroupedChipEntry[] } | null {
  if (!def?.groupedOptions || def.groupedOptions.length < 2) return null;
  const sorted = [...def.groupedOptions].sort((a, b) => a.order - b.order);
  const entries: CustomGroupedChipEntry[] = sorted.map((o) => ({
    value: o.optionValue,
    label: o.optionLabel?.trim() ? o.optionLabel : o.optionValue,
  }));
  // #region agent log
  fetch("http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6b04c6" },
    body: JSON.stringify({
      sessionId: "6b04c6",
      runId: "chips-ctx",
      hypothesisId: "H1",
      location: "customFieldGroupedChips:entry",
      message: "chipContext input",
      data: {
        uiType: def.uiType,
        groupBehaviorType: def.groupBehaviorType,
        nOptions: def.groupedOptions.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (def.uiType === "multiSelect") {
    // #region agent log
    fetch("http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6b04c6" },
      body: JSON.stringify({
        sessionId: "6b04c6",
        runId: "chips-ctx",
        hypothesisId: "H1",
        location: "customFieldGroupedChips:branch",
        message: "uiType multiSelect -> kind multi",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return { kind: "multi", entries };
  }
  if (def.uiType === "select") {
    if (def.groupBehaviorType === "visualMulti" || def.groupBehaviorType === "multiChoiceGroup") {
      // #region agent log
      fetch("http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6b04c6" },
        body: JSON.stringify({
          sessionId: "6b04c6",
          runId: "chips-ctx",
          hypothesisId: "H1",
          location: "customFieldGroupedChips:branch",
          message: "uiType select+multi behavior -> kind multi",
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return { kind: "multi", entries };
    }
    if (!def.groupBehaviorType || isSingleSelectGroupedBehavior(def.groupBehaviorType)) {
      // #region agent log
      fetch("http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6b04c6" },
        body: JSON.stringify({
          sessionId: "6b04c6",
          runId: "chips-ctx",
          hypothesisId: "H1",
          location: "customFieldGroupedChips:branch",
          message: "uiType select+single behavior -> kind single",
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return { kind: "single", entries };
    }
  }
  // #region agent log
  fetch("http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6b04c6" },
    body: JSON.stringify({
      sessionId: "6b04c6",
      runId: "chips-ctx",
      hypothesisId: "H1",
      location: "customFieldGroupedChips:null",
      message: "no chip context",
      data: { uiType: def.uiType, groupBehaviorType: def.groupBehaviorType },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return null;
}
