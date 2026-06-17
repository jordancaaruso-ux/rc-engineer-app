import "server-only";

import { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetTemplateId";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { buildA800SeedSchema } from "@/lib/setupSheetModels/seedA800Model";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";

/**
 * A curated chassis seed: a globally-shared, brand-confirmed ("authorized") setup sheet model.
 * Most entries start from the generic touring-car preset; users/admins refine the schema and add a
 * PDF/image calibration over time. The Awesomatix entry ships with its full structured schema.
 */
export type AuthorizedChassisSeed = {
  name: string;
  slug: string;
  buildSchema: () => SetupSheetModelSchema;
};

const generic = (name: string) => (): SetupSheetModelSchema => buildGenericPresetSchema(name);

/**
 * Popular 1/10 electric touring chassis. Adding a row here makes it appear (Authorized) for every
 * user; uploads/quick-add reuse it by slug. Keep slugs stable — they key community aggregation.
 */
export const AUTHORIZED_CHASSIS_CATALOG: AuthorizedChassisSeed[] = [
  { name: "Awesomatix A800RR", slug: SETUP_SHEET_MODEL_SLUG_A800RR, buildSchema: buildA800SeedSchema },
  { name: "Mugen MTC3", slug: "mugen_mtc3", buildSchema: generic("Mugen MTC3") },
  { name: "Mugen MTC2", slug: "mugen_mtc2", buildSchema: generic("Mugen MTC2") },
  { name: "Xray T4", slug: "xray_t4", buildSchema: generic("Xray T4") },
  { name: "Xray X4", slug: "xray_x4", buildSchema: generic("Xray X4") },
  { name: "Yokomo BD11", slug: "yokomo_bd11", buildSchema: generic("Yokomo BD11") },
  { name: "Yokomo BD12", slug: "yokomo_bd12", buildSchema: generic("Yokomo BD12") },
  { name: "Tamiya TRF421", slug: "tamiya_trf421", buildSchema: generic("Tamiya TRF421") },
  { name: "Infinity IF14", slug: "infinity_if14", buildSchema: generic("Infinity IF14") },
  { name: "Schumacher Atom 2", slug: "schumacher_atom2", buildSchema: generic("Schumacher Atom 2") },
  { name: "Destiny RX-10", slug: "destiny_rx10", buildSchema: generic("Destiny RX-10") },
  { name: "ARC R12", slug: "arc_r12", buildSchema: generic("ARC R12") },
];
