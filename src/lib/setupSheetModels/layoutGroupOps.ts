import { inferSectionLayoutRows } from "@/lib/setupSheetModels/inferStructuredLayout";
import { collectModelLayoutKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
import type {
  LayoutGroupKind,
  LayoutGroupRole,
  SetupSheetLayoutGroup,
  SetupSheetModelFieldDef,
  SetupSheetModelLayoutRow,
  SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

const PAIR_ROLES: LayoutGroupRole[] = ["front", "rear"];
const CORNER_ROLES: LayoutGroupRole[] = ["ff", "fr", "rf", "rr"];

const KEY_CORNER_SUFFIX_RE = /_(ff|fr|rf|rr)$/;
const KEY_PAIR_SUFFIX_RE = /_(front|rear)$/;

function stripSideFromLabel(label: string): string {
  return label
    .replace(/\s*[-–—]\s*(FF|FR|RF|RR|Front|Rear)\s*$/i, "")
    .replace(/\s*[\(·]?\s*(FF|FR|RF|RR|Front|Rear)\s*\)?\s*$/i, "")
    .replace(/\s*[-–—]\s*$/g, "")
    .trim();
}

function humanizeKey(prefix: string): string {
  return prefix
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function inferLayoutGroupLabel(fields: SetupSheetModelFieldDef[]): string {
  const stripped = fields.map((f) => stripSideFromLabel(f.displayLabel)).filter(Boolean);
  if (stripped.length === 0) {
    const prefix = commonKeyPrefix(fields.map((f) => f.key));
    return humanizeKey(prefix);
  }

  let common = stripped[0]!;
  for (const s of stripped.slice(1)) {
    while (common && !s.toLowerCase().startsWith(common.toLowerCase())) {
      common = common.slice(0, -1).trimEnd();
    }
  }
  if (common.length >= 2) return common;

  const prefix = commonKeyPrefix(fields.map((f) => f.key));
  return prefix ? humanizeKey(prefix) : stripped[0]!;
}

function commonKeyPrefix(keys: string[]): string {
  if (keys.length === 0) return "";
  let prefix = keys[0]!;
  for (const key of keys.slice(1)) {
    while (prefix && !key.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix.replace(/_+$/, "");
}

function roleFromLabel(label: string): LayoutGroupRole | null {
  const t = label.trim();
  if (/[\s\-–—(]ff\s*\)?\s*$/i.test(t) || /\bFF\b/.test(t)) return "ff";
  if (/[\s\-–—(]fr\s*\)?\s*$/i.test(t) || /\bFR\b/.test(t)) return "fr";
  if (/[\s\-–—(]rf\s*\)?\s*$/i.test(t) || /\bRF\b/.test(t)) return "rf";
  if (/[\s\-–—(]rr\s*\)?\s*$/i.test(t) || /\bRR\b/.test(t)) return "rr";
  if (/[\s\-–—(]front\s*\)?\s*$/i.test(t)) return "front";
  if (/[\s\-–—(]rear\s*\)?\s*$/i.test(t)) return "rear";
  return null;
}

export function inferLayoutGroupRoleFromField(field: SetupSheetModelFieldDef): LayoutGroupRole | null {
  const keyMatch = field.key.match(KEY_CORNER_SUFFIX_RE);
  if (keyMatch) return keyMatch[1] as LayoutGroupRole;
  const pairMatch = field.key.match(KEY_PAIR_SUFFIX_RE);
  if (pairMatch) return pairMatch[1] as LayoutGroupRole;
  return roleFromLabel(field.displayLabel);
}

function pickSharedUnit(fields: SetupSheetModelFieldDef[]): string | undefined {
  const units = [...new Set(fields.map((f) => f.unit?.trim()).filter(Boolean))];
  return units.length === 1 ? units[0] : undefined;
}

export function createLayoutGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function rolesForKind(kind: LayoutGroupKind): LayoutGroupRole[] {
  return kind === "pair" ? PAIR_ROLES : CORNER_ROLES;
}

function fieldByRole(
  fields: SetupSheetModelFieldDef[],
  roles: LayoutGroupRole[]
): Map<LayoutGroupRole, SetupSheetModelFieldDef> | { error: string } {
  const map = new Map<LayoutGroupRole, SetupSheetModelFieldDef>();
  for (const field of fields) {
    const role = field.layoutGroupRole ?? inferLayoutGroupRoleFromField(field);
    if (!role) {
      return {
        error: `Could not infer location for "${field.displayLabel}" (${field.key}). Use keys or labels ending in Front/Rear or FF/FR/RF/RR.`,
      };
    }
    if (!roles.includes(role)) {
      return {
        error: `"${field.displayLabel}" looks like ${role.toUpperCase()}, but this group needs ${roles.join(", ")}.`,
      };
    }
    if (map.has(role)) {
      return { error: `Two fields map to the same location (${role}).` };
    }
    map.set(role, field);
  }
  for (const role of roles) {
    if (!map.has(role)) {
      return { error: `Missing ${role.toUpperCase()} — all locations are required.` };
    }
  }
  return map;
}

function layoutRowFromGroup(
  group: SetupSheetLayoutGroup,
  fields: SetupSheetModelFieldDef[]
): SetupSheetModelLayoutRow | { error: string } {
  const roles = rolesForKind(group.kind);
  const mapped = fieldByRole(fields, roles);
  if ("error" in mapped) return mapped;

  const unit = pickSharedUnit(fields);
  if (group.kind === "pair") {
    return {
      type: "pair",
      label: group.label,
      leftKey: mapped.get("front")!.key,
      rightKey: mapped.get("rear")!.key,
      unit,
      layoutGroupId: group.id,
    };
  }
  return {
    type: "corner4",
    label: group.label,
    ff: mapped.get("ff")!.key,
    fr: mapped.get("fr")!.key,
    rf: mapped.get("rf")!.key,
    rr: mapped.get("rr")!.key,
    unit,
    layoutGroupId: group.id,
  };
}

function normalizeLayoutGroups(
  layoutGroups: SetupSheetModelSchema["layoutGroups"]
): Record<string, SetupSheetLayoutGroup> {
  return layoutGroups ?? {};
}

export function assignFieldsToManualLayoutGroup(
  schema: SetupSheetModelSchema,
  fieldKeys: string[],
  kind: LayoutGroupKind,
  label?: string
): SetupSheetModelSchema | { error: string } {
  const uniqueKeys = [...new Set(fieldKeys.map((k) => k.trim()).filter(Boolean))];
  const expected = kind === "pair" ? 2 : 4;
  if (uniqueKeys.length !== expected) {
    return { error: `Select exactly ${expected} parameters to group as ${kind === "pair" ? "Front / Rear" : "FF / FR / RF / RR"}.` };
  }

  const fields = uniqueKeys.map((key) => schema.fields.find((f) => f.key === key));
  if (fields.some((f) => !f)) return { error: "One or more parameters were not found." };

  const resolved = fields as SetupSheetModelFieldDef[];
  const sectionIds = new Set(resolved.map((f) => f.sectionId));
  if (sectionIds.size !== 1) {
    return { error: "Grouped parameters must be in the same section." };
  }
  const sectionId = resolved[0]!.sectionId;

  if (resolved.some((f) => f.layoutGroupId)) {
    return { error: "One or more parameters are already in a layout group. Ungroup them first." };
  }

  const roles = rolesForKind(kind);
  const mapped = fieldByRole(resolved, roles);
  if ("error" in mapped) return mapped;

  const groupId = createLayoutGroupId();
  const groupLabel = label?.trim() || inferLayoutGroupLabel(resolved);
  const group: SetupSheetLayoutGroup = {
    id: groupId,
    kind,
    label: groupLabel,
    manual: true,
    sectionId,
  };

  const nextFields = schema.fields.map((f) => {
    if (!uniqueKeys.includes(f.key)) return f;
    const role = f.layoutGroupRole ?? inferLayoutGroupRoleFromField(f);
    if (!role) return f;
    return { ...f, layoutGroupId: groupId, layoutGroupRole: role };
  });

  const nextSchema: SetupSheetModelSchema = {
    ...schema,
    fields: nextFields,
    layoutGroups: { ...normalizeLayoutGroups(schema.layoutGroups), [groupId]: group },
  };

  return syncLayoutSectionsForGroups(nextSchema, [sectionId]);
}

export function ungroupLayoutGroup(
  schema: SetupSheetModelSchema,
  groupId: string
): SetupSheetModelSchema | { error: string } {
  const group = schema.layoutGroups?.[groupId];
  if (!group) return { error: "Layout group not found." };

  const nextGroups = { ...normalizeLayoutGroups(schema.layoutGroups) };
  delete nextGroups[groupId];

  const nextFields = schema.fields.map((f) =>
    f.layoutGroupId === groupId
      ? { ...f, layoutGroupId: undefined, layoutGroupRole: undefined }
      : f
  );

  const nextSections = schema.structuredSections.map((sec) => ({
    ...sec,
    rows: sec.rows.flatMap((row): SetupSheetModelLayoutRow[] => {
      if (layoutGroupIdForRow(row) !== groupId) return [row];
      const keys =
        row.type === "pair"
          ? [row.leftKey, row.rightKey]
          : row.type === "corner4"
            ? [row.ff, row.fr, row.rf, row.rr]
            : [];
      return keys.map((key) => {
        const field = nextFields.find((f) => f.key === key);
        return {
          type: "single" as const,
          key,
          label: field?.displayLabel ?? key,
          unit: field?.unit,
          multiline: field?.uiType === "textarea",
        };
      });
    }),
  }));

  return {
    ...schema,
    fields: nextFields,
    layoutGroups: Object.keys(nextGroups).length > 0 ? nextGroups : undefined,
    structuredSections: nextSections,
  };
}

export function ungroupLayoutRow(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number
): SetupSheetModelSchema | { error: string } {
  const sec = schema.structuredSections.find((s) => s.id === sectionId);
  if (!sec) return { error: "Section not found." };
  const row = sec.rows[rowIndex];
  if (!row) return { error: "Row not found." };
  if (row.type !== "pair" && row.type !== "corner4") {
    return { error: "Only pair and corner4 rows can be ungrouped." };
  }
  if (!row.layoutGroupId) {
    return { error: "This row is not a manual layout group." };
  }
  return ungroupLayoutGroup(schema, row.layoutGroupId);
}

export function updateLayoutGroupLabel(
  schema: SetupSheetModelSchema,
  groupId: string,
  label: string
): SetupSheetModelSchema | { error: string } {
  const trimmed = label.trim();
  if (!trimmed) return { error: "Group label is required." };
  const group = schema.layoutGroups?.[groupId];
  if (!group) return { error: "Layout group not found." };

  const nextGroups = {
    ...normalizeLayoutGroups(schema.layoutGroups),
    [groupId]: { ...group, label: trimmed },
  };

  const nextSections = schema.structuredSections.map((sec) => ({
    ...sec,
    rows: sec.rows.map((row) => {
      if ((row.type === "pair" || row.type === "corner4") && row.layoutGroupId === groupId) {
        return { ...row, label: trimmed };
      }
      return row;
    }),
  }));

  return { ...schema, layoutGroups: nextGroups, structuredSections: nextSections };
}

export function groupLayoutRows(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndexes: number[],
  kind: LayoutGroupKind,
  label?: string
): SetupSheetModelSchema | { error: string } {
  const sec = schema.structuredSections.find((s) => s.id === sectionId);
  if (!sec) return { error: "Section not found." };

  const keys: string[] = [];
  for (const idx of rowIndexes) {
    const row = sec.rows[idx];
    if (!row || row.type !== "single") {
      return { error: "Only single-parameter rows can be merged into a group." };
    }
    keys.push(row.key);
  }
  return assignFieldsToManualLayoutGroup(schema, keys, kind, label);
}

function manualGroupRowsForSection(
  schema: SetupSheetModelSchema,
  sectionId: string
): SetupSheetModelLayoutRow[] {
  const groups = normalizeLayoutGroups(schema.layoutGroups);
  const rows: SetupSheetModelLayoutRow[] = [];

  for (const group of Object.values(groups)) {
    if (group.sectionId !== sectionId || !group.manual) continue;
    const members = schema.fields
      .filter((f) => f.layoutGroupId === group.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
    if (members.length === 0) continue;
    const row = layoutRowFromGroup(group, members);
    if ("error" in row) continue;
    rows.push(row);
  }

  return rows;
}

function mergeSectionRows(
  manualRows: SetupSheetModelLayoutRow[],
  inferredRows: SetupSheetModelLayoutRow[],
  existingRows: SetupSheetModelLayoutRow[]
): SetupSheetModelLayoutRow[] {
  const manualKeys = new Set<string>();
  for (const row of manualRows) {
    for (const key of layoutRowFieldKeys(row)) manualKeys.add(key);
  }

  const autoRows = inferredRows.filter((row) => {
    if (layoutGroupIdForRow(row)) return false;
    return !layoutRowFieldKeys(row).some((key) => manualKeys.has(key));
  });

  const specialRows = existingRows.filter(
    (row) => row.type === "screw_strip" || row.type === "top_deck_block"
  );

  return [...manualRows, ...autoRows, ...specialRows];
}

function layoutRowFieldKeys(row: SetupSheetModelLayoutRow): string[] {
  if (row.type === "single") return [row.key];
  if (row.type === "pair") return [row.leftKey, row.rightKey];
  if (row.type === "corner4") return [row.ff, row.fr, row.rf, row.rr];
  return [];
}

function layoutGroupIdForRow(row: SetupSheetModelLayoutRow): string | undefined {
  if (row.type === "pair" || row.type === "corner4") return row.layoutGroupId;
  return undefined;
}

export function syncLayoutSectionsForGroups(
  schema: SetupSheetModelSchema,
  sectionIds?: string[]
): SetupSheetModelSchema {
  const targetSections = sectionIds ?? schema.structuredSections.map((s) => s.id);
  const targetSet = new Set(targetSections);

  const structuredSections = schema.structuredSections.map((sec) => {
    if (!targetSet.has(sec.id)) return sec;
    const secFields = schema.fields.filter((f) => f.sectionId === sec.id);
    const ungroupedFields = secFields.filter((f) => !f.layoutGroupId);
    const manualRows = manualGroupRowsForSection(schema, sec.id);
    const inferredRows = inferSectionLayoutRows(ungroupedFields);
    const merged = mergeSectionRows(manualRows, inferredRows, sec.rows);
    return { ...sec, rows: merged };
  });

  for (const sectionId of targetSections) {
    if (!structuredSections.some((s) => s.id === sectionId)) {
      const secFields = schema.fields.filter((f) => f.sectionId === sectionId);
      if (secFields.length === 0) continue;
      const title = secFields[0]!.sectionTitle;
      const manualRows = manualGroupRowsForSection(schema, sectionId);
      const inferredRows = inferSectionLayoutRows(secFields.filter((f) => !f.layoutGroupId));
      structuredSections.push({
        id: sectionId,
        title,
        rows: mergeSectionRows(manualRows, inferredRows, []),
      });
    }
  }

  return { ...schema, structuredSections };
}

export function rebuildSectionLayout(
  sections: SetupSheetModelSchema["structuredSections"],
  sectionId: string,
  sectionTitle: string,
  fields: SetupSheetModelFieldDef[],
  layoutGroups?: SetupSheetModelSchema["layoutGroups"]
): SetupSheetModelSchema["structuredSections"] {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "",
    fields,
    structuredSections: sections,
    layoutGroups,
  };
  const synced = syncLayoutSectionsForGroups(schema, [sectionId]);
  const syncedSec = synced.structuredSections.find((s) => s.id === sectionId);
  if (syncedSec) {
    return sections.map((s) => (s.id === sectionId ? { ...syncedSec, title: sectionTitle } : s));
  }
  return [
    ...sections,
    {
      id: sectionId,
      title: sectionTitle,
      rows: syncLayoutSectionsForGroups(
        { ...schema, structuredSections: [] },
        [sectionId]
      ).structuredSections[0]?.rows ?? [],
    },
  ];
}

export function inferStructuredLayoutFromFields(
  fields: SetupSheetModelFieldDef[],
  existingSections: SetupSheetModelSchema["structuredSections"] = [],
  layoutGroups?: SetupSheetModelSchema["layoutGroups"]
): SetupSheetModelSchema["structuredSections"] {
  const schema: SetupSheetModelSchema = {
    version: 1,
    label: "",
    fields,
    structuredSections: existingSections,
    layoutGroups,
  };

  const manualGroups = normalizeLayoutGroups(layoutGroups);
  const hasManual = Object.values(manualGroups).some((g) => g.manual);
  if (!hasManual) {
    const fieldsBySection = new Map<string, { title: string; fields: SetupSheetModelFieldDef[] }>();
    for (const f of fields) {
      let g = fieldsBySection.get(f.sectionId);
      if (!g) {
        g = { title: f.sectionTitle, fields: [] };
        fieldsBySection.set(f.sectionId, g);
      }
      g.fields.push(f);
      g.title = f.sectionTitle;
    }

    const existingById = new Map(existingSections.map((s) => [s.id, s] as const));
    const sectionOrder: string[] = [];
    for (const sec of existingSections) {
      if (!sectionOrder.includes(sec.id)) sectionOrder.push(sec.id);
    }
    for (const id of fieldsBySection.keys()) {
      if (!sectionOrder.includes(id)) sectionOrder.push(id);
    }

    return sectionOrder
      .filter((id) => fieldsBySection.has(id))
      .map((id) => {
        const { title, fields: secFields } = fieldsBySection.get(id)!;
        const existing = existingById.get(id);
        const manualRows = manualGroupRowsForSection(schema, id);
        const inferred = inferSectionLayoutRows(secFields.filter((f) => !f.layoutGroupId));
        return {
          id,
          title: existing?.title ?? title,
          rows: mergeSectionRows(manualRows, inferred, existing?.rows ?? []),
        };
      });
  }

  const synced = syncLayoutSectionsForGroups(schema);
  const syncedIds = new Set(synced.structuredSections.map((s) => s.id));
  const extras = existingSections.filter((s) => !syncedIds.has(s.id));
  return [...synced.structuredSections, ...extras];
}

export function fieldsInSameManualGroup(
  schema: SetupSheetModelSchema,
  fieldKey: string
): SetupSheetLayoutGroup | null {
  const field = schema.fields.find((f) => f.key === fieldKey);
  if (!field?.layoutGroupId) return null;
  return schema.layoutGroups?.[field.layoutGroupId] ?? null;
}

export function layoutGroupMemberKeys(schema: SetupSheetModelSchema, groupId: string): string[] {
  return schema.fields.filter((f) => f.layoutGroupId === groupId).map((f) => f.key);
}

export function countUngroupedFieldsNotInLayout(schema: SetupSheetModelSchema): number {
  const layoutKeys = collectModelLayoutKeys(schema.structuredSections);
  return schema.fields.filter((f) => !layoutKeys.has(f.key)).length;
}
