import type { EngineerPayloadBlock } from "@/lib/engineer/payload";
import type { UnitSystem } from "@/lib/units/unitSystem";

/**
 * The driver's units (the Settings switch, founder call 2026-09-24): how a temperature or a wind
 * speed is SAID to this driver, never what is true. Everything the Engineer reads stays metric
 * (the KB, the nets and the driver-data blocks are written in °C and km/h), and the answer
 * converts on the way out.
 *
 * Only a driver on °F gets the block. A metric request is byte-identical to the one before the
 * switch existed, so nothing measured on the harness moved for them.
 *
 * Cache-stable, straight after the prompt: it never changes between one driver's turns, so it
 * lengthens the cached prefix instead of breaking it. `buildEngineerMessages` enforces the
 * order; the chat route puts it ahead of the per-turn driver data.
 *
 * Why each clause is there:
 *  · "converting a figure is not inventing a number": the prompt bans numbers from anywhere but
 *    the driver, the KB and the driver-data block; a converted figure must not read as a breach.
 *  · the no-32 difference: "10 °C warmer" is 18 °F warmer, not 50 — the one conversion a model
 *    gets wrong by rote.
 *  · a bare temperature is °F: an American writes "it was 95 today".
 *  · setup keeps its units: "imperial" must not turn ride height into inches.
 */
export const ENGINEER_IMPERIAL_UNITS_TEXT = `UNITS
This driver reads temperatures in °F and wind speeds in mph. Every figure in this request — the knowledge base, the nets and the driver data — is in °C and km/h. When you give the driver a temperature or a wind speed, give it in °F or mph; converting a figure is not inventing a number, and a difference converts without the 32 (10 °C warmer is 18 °F warmer). A temperature the driver writes without a unit is °F. Setup figures keep their own units.`;

export function engineerUnitsBlocks(units: UnitSystem): EngineerPayloadBlock[] {
  return units === "imperial"
    ? [{ id: "units", cacheStable: true, content: ENGINEER_IMPERIAL_UNITS_TEXT }]
    : [];
}
