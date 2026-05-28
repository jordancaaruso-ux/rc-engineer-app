export type CalibrationPickerRow = {
  id: string;
  name: string;
  setupSheetModelId: string | null;
  setupSheetModelName: string | null;
};

export type CalibrationPickerGroup = "this_model" | "unlinked" | "other_model";

export type CalibrationPickerOption = {
  calibration: CalibrationPickerRow;
  group: CalibrationPickerGroup;
  groupLabel: string;
  optionLabel: string;
  isDefaultForDocModel: boolean;
};

const GROUP_ORDER: CalibrationPickerGroup[] = ["this_model", "unlinked", "other_model"];

const GROUP_LABELS: Record<CalibrationPickerGroup, string> = {
  this_model: "This car type",
  unlinked: "Unlinked (same PDF, assign to car type)",
  other_model: "Other car types",
};

export function buildDocumentCalibrationPickerOptions(input: {
  calibrations: CalibrationPickerRow[];
  docSetupSheetModelId: string | null;
  docSetupSheetModelName: string | null;
  defaultCalibrationIdForDocModel: string | null;
}): {
  options: CalibrationPickerOption[];
  matchedForDocModelCount: number;
  unlinkedCount: number;
  totalCount: number;
} {
  const docModelId = input.docSetupSheetModelId?.trim() || null;
  const docModelName = input.docSetupSheetModelName?.trim() || "This car type";
  const defaultId = input.defaultCalibrationIdForDocModel?.trim() || null;

  const buckets: Record<CalibrationPickerGroup, CalibrationPickerRow[]> = {
    this_model: [],
    unlinked: [],
    other_model: [],
  };

  for (const c of input.calibrations) {
    const calModelId = c.setupSheetModelId?.trim() || null;
    if (!docModelId) {
      buckets.unlinked.push(c);
      continue;
    }
    if (!calModelId) buckets.unlinked.push(c);
    else if (calModelId === docModelId) buckets.this_model.push(c);
    else buckets.other_model.push(c);
  }

  const sortByName = (a: CalibrationPickerRow, b: CalibrationPickerRow) =>
    a.name.localeCompare(b.name);
  for (const g of GROUP_ORDER) buckets[g].sort(sortByName);

  const options: CalibrationPickerOption[] = [];
  for (const group of GROUP_ORDER) {
    const list = buckets[group];
    if (list.length === 0) continue;
    const groupLabel =
      group === "this_model" ? docModelName : GROUP_LABELS[group];
    for (const calibration of list) {
      const isDefault = Boolean(defaultId && calibration.id === defaultId);
      let optionLabel = calibration.name;
      if (isDefault) optionLabel += " (default)";
      if (group === "unlinked" && docModelId) optionLabel += " — unlinked";
      if (group === "other_model" && calibration.setupSheetModelName) {
        optionLabel += ` — ${calibration.setupSheetModelName}`;
      }
      options.push({
        calibration,
        group,
        groupLabel,
        optionLabel,
        isDefaultForDocModel: isDefault,
      });
    }
  }

  return {
    options,
    matchedForDocModelCount: buckets.this_model.length,
    unlinkedCount: buckets.unlinked.length,
    totalCount: input.calibrations.length,
  };
}
