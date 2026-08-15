import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/**
 * Which of your cars a teammate's setup may be copied onto.
 *
 * A setup is a bag of values keyed to the fields of ONE sheet. Land an X4's numbers on a T4 and the
 * keys that don't exist there are simply not read: the setup opens looking half-empty, and nothing
 * on screen says which half went missing. So a copy is only offered onto a car that reads the same
 * sheet — then every key means the same thing on both sides.
 *
 * "The same sheet" is `Car.setupSheetModelId`, the shared `SetupSheetModel` row — NOT `Car.chassis`,
 * which is free text a driver typed and would pair "X4 '24" with "xray x4" only by luck.
 */
export type ChassisIdentity = {
  setupSheetModelId?: string | null;
  /** Legacy per-car template, still the only chassis mark on pre-model A800RR cars. */
  setupSheetTemplate?: string | null;
};

/**
 * One comparable string for a car's chassis.
 *
 * The three cases are deliberately kept apart. A car with a model id is that chassis. A car with
 * only the legacy template string is an A800RR that predates the model table — pairing it with a
 * modern A800RR is out of scope here (their key differs; the picker just won't offer it), but
 * pairing it with a *generic* car would be wrong, and this is what stops that. Everything else is
 * on the generic template, where the field keys are the shared vocabulary, so those cars do pair.
 */
export function chassisMatchKey(car: ChassisIdentity): string {
  if (car.setupSheetModelId) return `model:${car.setupSheetModelId}`;
  const legacy = canonicalSetupSheetTemplateId(car.setupSheetTemplate ?? null);
  if (legacy) return `template:${legacy}`;
  return "generic";
}

/** Do these two cars read the same setup sheet? */
export function chassisMatches(a: ChassisIdentity, b: ChassisIdentity): boolean {
  return chassisMatchKey(a) === chassisMatchKey(b);
}

/** Your cars that could hold this setup. Empty means "you don't own one of these". */
export function carsMatchingChassis<T extends ChassisIdentity>(
  source: ChassisIdentity,
  cars: readonly T[]
): T[] {
  const key = chassisMatchKey(source);
  return cars.filter((car) => chassisMatchKey(car) === key);
}
