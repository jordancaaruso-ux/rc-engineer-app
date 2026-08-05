import { isAuthAdminEmail } from "@/lib/authAdminLogic";
import { APP_SETTING_KEYS, getUserSetting, setUserSetting } from "@/lib/appSettings";

/**
 * The Engineer lab: a private, per-account way to put facts back in front of the model one rung
 * at a time, without changing what anyone else's Engineer does.
 *
 * WHY IT IS BUILT THIS WAY. Engineer v0 (2026-08-05) deliberately ships with nothing but the
 * knowledge base, and the ladder back up is meant to be walked one rung at a time with each rung
 * earning its place. That only works if a rung can be switched on for one person, judged in real
 * use, and switched off again — so the gate is an admin check AND a per-user setting that
 * defaults to off. A second admin would get the toggles, never the behaviour.
 *
 * The route calls `loadEngineerLabRungs` on every chat turn; when it returns no active rungs the
 * request is byte-for-byte the shipped one.
 */

export const ENGINEER_LAB_RUNGS = [
  {
    id: "setupSheet",
    settingKey: APP_SETTING_KEYS.engineerLabSetupSheet,
    label: "Setup sheet",
    description:
      "The pinned run's actual setup values — tuning parameters only, no motor or electronics.",
  },
  {
    id: "sessionFacts",
    settingKey: APP_SETTING_KEYS.engineerLabSessionFacts,
    label: "Session facts",
    description:
      "Where and on what: track, layout, grip, tyre, conditions, lap count and your rating.",
  },
  {
    id: "comparableRuns",
    settingKey: APP_SETTING_KEYS.engineerLabComparableRuns,
    label: "Comparable runs",
    description:
      "The nearest earlier runs on this car by tyre, grip and layout, and how close each one is.",
  },
] as const;

export type EngineerLabRungId = (typeof ENGINEER_LAB_RUNGS)[number]["id"];

/** Stable order for prompt-version labels and block order — never sort by Set iteration. */
const RUNG_ORDER: EngineerLabRungId[] = ENGINEER_LAB_RUNGS.map((r) => r.id);

export function canUseEngineerLab(email: string | null | undefined): boolean {
  return isAuthAdminEmail(email);
}

export async function loadEngineerLabRungs(params: {
  userId: string;
  email: string | null | undefined;
}): Promise<EngineerLabRungId[]> {
  if (!canUseEngineerLab(params.email)) return [];
  const values = await Promise.all(
    ENGINEER_LAB_RUNGS.map(async (rung) => {
      const raw = await getUserSetting(params.userId, rung.settingKey).catch(() => null);
      return raw === "1" ? rung.id : null;
    })
  );
  const active = new Set(values.filter((v): v is EngineerLabRungId => v != null));
  return RUNG_ORDER.filter((id) => active.has(id));
}

export async function setEngineerLabRung(params: {
  userId: string;
  rung: EngineerLabRungId;
  on: boolean;
}): Promise<void> {
  const rung = ENGINEER_LAB_RUNGS.find((r) => r.id === params.rung);
  if (!rung) throw new Error(`Unknown Engineer lab rung: ${params.rung}`);
  await setUserSetting(params.userId, rung.settingKey, params.on ? "1" : null);
}
