import {
  canonicalSetupSheetTemplateId,
  labelForSetupSheetTemplate,
} from "@/lib/setupSheetTemplateId";

export type CarForTemplateGroup = { id: string; name: string; setupSheetTemplate: string | null };

export type SetupSheetTemplateCarGroup = {
  key: string;
  label: string;
  carIds: string[];
  /** POST `carId` (first in group) — used to resolve owned car and stored template. */
  defaultCarId: string;
};

function sortedCars(cars: CarForTemplateGroup[]): CarForTemplateGroup[] {
  return [...cars].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One row per shared setup sheet type. Cars with no `setupSheetTemplate` get one row each
 * (they need a type under Cars to share sheets with siblings).
 */
export function carTemplateSelectGroups(cars: CarForTemplateGroup[]): SetupSheetTemplateCarGroup[] {
  const templateBuckets = new Map<string, CarForTemplateGroup[]>();
  const unset: CarForTemplateGroup[] = [];
  for (const c of cars) {
    const can = canonicalSetupSheetTemplateId(c.setupSheetTemplate);
    if (can) {
      if (!templateBuckets.has(can)) templateBuckets.set(can, []);
      templateBuckets.get(can)!.push(c);
    } else {
      unset.push(c);
    }
  }
  const out: SetupSheetTemplateCarGroup[] = [];
  for (const [can, list0] of templateBuckets) {
    const list = sortedCars(list0);
    const first = list[0]!;
    const typeLabel = labelForSetupSheetTemplate(can);
    const label =
      list.length > 1
        ? `${typeLabel} (${list.length} cars)`
        : `${typeLabel} — ${first.name}`;
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
      label: `${c.name} (set car type in Cars)`,
      carIds: [c.id],
      defaultCarId: c.id,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
