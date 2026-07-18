import { prisma } from "@/lib/prisma";
import { loadLiveCalibration } from "./mtc3-common";

async function main() {
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  console.log("ref", ref.widthPx, ref.heightPx, "contentBox", ref.contentBox);
  for (const f of live.imageCalibration.fields) {
    const extra =
      f.kind === "singleChoiceGroup" || f.kind === "multiSelectGroup"
        ? ` opts=${(f as { options: Array<{ value: string }> }).options.map((o) => o.value).join("|")}`
        : "";
    console.log(`${f.kind.padEnd(18)} ${f.key}${extra}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
