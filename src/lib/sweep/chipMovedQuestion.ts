import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getSpeedhiveTransponderCarsSetting,
  getSpeedhiveTransponderMovedSetting,
  setSpeedhiveTransponderCarsSetting,
  setSpeedhiveTransponderMovedSetting,
} from "@/lib/appSettings";
import { formatTransponderCarsSetting, parseTransponderCarsSetting } from "@/lib/speedhive/transponderCars";
import {
  declinedKey,
  formatChipMovedSetting,
  livePendingChipQuestion,
  parseChipMovedSetting,
} from "@/lib/speedhive/transponderMoved";

export type ChipMovedQuestion = {
  chip: string;
  carId: string;
  carName: string;
  fromCarId: string;
  fromCarName: string;
};

/** The "has this chip moved?" question waiting for the driver, if one still means something. */
export async function loadChipMovedQuestion(userId: string): Promise<ChipMovedQuestion | null> {
  const [movedRaw, carsRaw, cars] = await Promise.all([
    getSpeedhiveTransponderMovedSetting(userId),
    getSpeedhiveTransponderCarsSetting(userId),
    prisma.car.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  const q = livePendingChipQuestion({
    state: parseChipMovedSetting(movedRaw),
    map: parseTransponderCarsSetting(carsRaw),
    userCarIds: cars.map((c) => c.id),
  });
  if (!q) return null;
  const name = (id: string) => cars.find((c) => c.id === id)?.name ?? "";
  return { ...q, carName: name(q.carId), fromCarName: name(q.fromCarId) };
}

/**
 * The driver's answer. "In <car> now" re-pairs the chip; "Still in <car>" is remembered so that
 * chip and car are never asked about again. Either way the question is cleared.
 */
export async function answerChipMovedQuestion(input: {
  userId: string;
  chip: string;
  carId: string;
  moved: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const { userId, chip, carId, moved } = input;
  const [movedRaw, carsRaw, car] = await Promise.all([
    getSpeedhiveTransponderMovedSetting(userId),
    getSpeedhiveTransponderCarsSetting(userId),
    prisma.car.findFirst({ where: { id: carId, userId }, select: { id: true } }),
  ]);
  if (!car) return { error: "Car not found" };
  const state = parseChipMovedSetting(movedRaw);
  if (!state.pending || state.pending.chip !== chip || state.pending.carId !== carId) {
    return { error: "Nothing to answer" };
  }
  if (moved) {
    const map = parseTransponderCarsSetting(carsRaw);
    await setSpeedhiveTransponderCarsSetting(userId, formatTransponderCarsSetting({ ...map, [chip]: carId }));
  }
  const key = declinedKey(chip, carId);
  await setSpeedhiveTransponderMovedSetting(
    userId,
    formatChipMovedSetting({
      pending: null,
      declined: moved ? state.declined.filter((d) => d !== key) : [...state.declined.filter((d) => d !== key), key],
    }),
  );
  return { ok: true };
}
