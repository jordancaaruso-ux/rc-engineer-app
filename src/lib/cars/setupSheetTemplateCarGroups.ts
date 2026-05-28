import {
  canonicalSetupSheetTemplateId,
  labelForSetupSheetTemplate,
} from "@/lib/setupSheetTemplateId";

export type CarForTemplateGroup = {
  id: string;
  name: string;
  setupSheetTemplate: string | null;
  setupSheetModelId?: string | null;
  setupSheetModelName?: string | null;
};

export type SetupSheetTemplateCarGroup = {
  key: string;
  label: string;
  carIds: string[];
  /** POST `carId` (first in group) — used to resolve owned car and stored template/model. */
  defaultCarId: string;
  setupSheetModelId?: string | null;
};

function sortedCars(cars: CarForTemplateGroup[]): CarForTemplateGroup[] {
  return [...cars].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One row per shared setup sheet model or legacy template.
 * Cars with neither get one row each (orphans).
 */
export function carTemplateSelectGroups(cars: CarForTemplateGroup[]): SetupSheetTemplateCarGroup[] {
  const modelBuckets = new Map<string, CarForTemplateGroup[]>();
  const templateBuckets = new Map<string, CarForTemplateGroup[]>();
  const unset: CarForTemplateGroup[] = [];

  for (const c of cars) {
    const modelId = c.setupSheetModelId?.trim() || null;
    if (modelId) {
      if (!modelBuckets.has(modelId)) modelBuckets.set(modelId, []);
      modelBuckets.get(modelId)!.push(c);
      continue;
    }
    const can = canonicalSetupSheetTemplateId(c.setupSheetTemplate);
    if (can) {
      if (!templateBuckets.has(can)) templateBuckets.set(can, []);
      templateBuckets.get(can)!.push(c);
    } else {
      unset.push(c);
    }
  }

  const out: SetupSheetTemplateCarGroup[] = [];

  for (const [modelId, list0] of modelBuckets) {
    const list = sortedCars(list0);
    const first = list[0]!;
    const modelName = first.setupSheetModelName?.trim() || "Setup sheet model";
    const label =
      list.length > 1 ? `${modelName} (${list.length} cars)` : `${modelName} — ${first.name}`;
    out.push({
      key: `m:${modelId}`,
      label,
      carIds: list.map((x) => x.id),
      defaultCarId: first.id,
      setupSheetModelId: modelId,
    });
  }

  for (const [can, list0] of templateBuckets) {
    const list = sortedCars(list0);
    const first = list[0]!;
    const typeLabel = labelForSetupSheetTemplate(can);
    const label =
      list.length > 1 ? `${typeLabel} (${list.length} cars)` : `${typeLabel} — ${first.name}`;
    out.push({
      key: `t:${can}`,
      label,
      carIds: list.map((x) => x.id),
      defaultCarId: first.id,
    });
  }

  for (const c of sortedCars(unset)) {
    out.push({
      key: `u:${c.id}`,
      label: `${c.name} (no setup sheet model — use car wizard)`,
      carIds: [c.id],
      defaultCarId: c.id,
    });
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** True when upload can proceed without showing the model picker. */
export function shouldSkipSetupUploadCarPicker(cars: CarForTemplateGroup[]): boolean {
  if (cars.length <= 1) return cars.length === 1;
  return carTemplateSelectGroups(cars).length === 1;
}
