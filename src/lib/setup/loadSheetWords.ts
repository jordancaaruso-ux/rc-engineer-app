import { prisma } from "@/lib/prisma";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import { sheetWordsFromFields, type SheetWords } from "@/lib/setup/sheetWords";

/**
 * Each car's sheet words (`sheetWords.ts`), for the lists of setup changes drawn on the server — the
 * dashboard and the team feed. A car with no chassis sheet is simply absent, and its rows keep the
 * app's generic names.
 *
 * Chassis are global, so this reads whichever car ids it is handed; the caller has already decided
 * the viewer may see those runs. What comes back is the words printed on a manufacturer's sheet,
 * never anybody's setup.
 */
export async function loadSheetWordsByCarId(
  userId: string,
  carIds: Iterable<string | null | undefined>
): Promise<Map<string, SheetWords>> {
  const ids = [...new Set([...carIds].filter((id): id is string => Boolean(id)))];
  const out = new Map<string, SheetWords>();
  if (ids.length === 0) return out;

  try {
    const cars = await prisma.car.findMany({
      where: { id: { in: ids } },
      select: { id: true, setupSheetModelId: true, setupSheetTemplate: true },
    });
    // One read per chassis, however many of the cars share it.
    const byChassis = new Map<string, Promise<SheetWords | null>>();
    await Promise.all(
      cars.map(async (car) => {
        const chassis = car.setupSheetModelId ?? `template:${car.setupSheetTemplate ?? ""}`;
        let words = byChassis.get(chassis);
        if (!words) {
          words = resolveSetupSheetModelForCar(userId, car).then((model) =>
            model ? sheetWordsFromFields(model.schema.fields) : null
          );
          byChassis.set(chassis, words);
        }
        const resolved = await words;
        if (resolved) out.set(car.id, resolved);
      })
    );
  } catch (e) {
    // The names are a nicety on a list that already works. A failed read leaves its rows as they
    // were rather than taking the dashboard or the feed down with it.
    console.warn("[sheet-words] could not read the chassis sheets", e);
  }
  return out;
}
