/**
 * Arm registry — an "arm" is one (prompt × payload) combination the harness can answer
 * with. Changes to the Engineer ship only when an arm beats the incumbent on this harness
 * (docs/ENGINEER_NORTH_STAR.md §4).
 *
 * Model comes from ENGINEER_MODEL / the shipped default, so a model bench is
 * `ENGINEER_MODEL=x npm run engineer:eval -- --arm v1` per candidate.
 */
import { loadFullVehicleDynamicsKb } from "@/lib/engineer/kb";
import { ENGINEER_NETS_HEADER, loadNets } from "@/lib/engineer/nets";
import { standardEngineerBlocks, type EngineerPayloadBlock } from "@/lib/engineer/payload";

export type EvalArm = {
  id: string;
  description: string;
  buildBlocks: () => Promise<EngineerPayloadBlock[]>;
};

export const ARMS: EvalArm[] = [
  {
    id: "v1",
    description: "The shipped payload: full KB + prompt (rebuild baseline, identical to v0).",
    buildBlocks: async () => {
      const kb = await loadFullVehicleDynamicsKb();
      return standardEngineerBlocks(kb.markdown);
    },
  },
  {
    id: "v1-nets",
    description: "Shipped payload + the nets block between KB and prompt.",
    buildBlocks: async () => {
      const kb = await loadFullVehicleDynamicsKb();
      const nets = await loadNets({ discipline: "touring" });
      const [kbBlock, promptBlock] = standardEngineerBlocks(kb.markdown);
      const blocks: EngineerPayloadBlock[] = [kbBlock];
      if (nets.text.trim().length > 0) {
        blocks.push({ id: "nets", cacheStable: true, content: ENGINEER_NETS_HEADER + nets.text });
      }
      blocks.push(promptBlock);
      return blocks;
    },
  },
];

export function getArm(id: string): EvalArm {
  const arm = ARMS.find((a) => a.id === id);
  if (!arm) {
    throw new Error(`Unknown arm "${id}". Known arms: ${ARMS.map((a) => a.id).join(", ")}`);
  }
  return arm;
}
