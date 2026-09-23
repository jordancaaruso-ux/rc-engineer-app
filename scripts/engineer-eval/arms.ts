/**
 * Arm registry — an "arm" is one (prompt × payload) combination the harness can answer
 * with. Changes to the Engineer ship only when an arm beats the incumbent on this harness
 * (docs/ENGINEER_NORTH_STAR.md §4).
 *
 * Model comes from ENGINEER_MODEL / the shipped default, so a model bench is
 * `ENGINEER_MODEL=x npm run engineer:eval -- --arm v1` per candidate.
 */
import fs from "node:fs";
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

/**
 * A trial: exact find/replace edits on the prompt, KB or nets text of the v1-nets payload, so a
 * change — Claude's own, or one waiting on the founder's call — is measured on the harness before
 * any shipped file moves (and without a src/ save reloading the dev server he may be driving).
 * Each `find` must occur exactly once in its block, or the run stops.
 */
type TrialFile = { about?: string; edits: { block: "prompt" | "kb" | "nets"; find: string; replace: string; why?: string }[] };

ARMS.push({
  id: "v1-nets-trial",
  description: "v1-nets with the edits in ENGINEER_TRIAL=<path to scripts/engineer-eval/trials/*.json> applied.",
  buildBlocks: async () => {
    const trialPath = process.env.ENGINEER_TRIAL;
    if (!trialPath) throw new Error("v1-nets-trial needs ENGINEER_TRIAL=<trial json path>");
    const trial = JSON.parse(fs.readFileSync(trialPath, "utf8")) as TrialFile;
    const blocks = await getArm("v1-nets").buildBlocks();
    for (const e of trial.edits) {
      const b = blocks.find((x) => x.id === e.block);
      if (!b) throw new Error(`trial edit targets block "${e.block}", not in the payload`);
      const count = b.content.split(e.find).length - 1;
      if (count !== 1) throw new Error(`trial edit find occurs ${count}× in "${e.block}" (must be 1): ${e.find.slice(0, 80)}`);
      b.content = b.content.replace(e.find, () => e.replace);
    }
    return blocks;
  },
});

export function getArm(id: string): EvalArm {
  const arm = ARMS.find((a) => a.id === id);
  if (!arm) {
    throw new Error(`Unknown arm "${id}". Known arms: ${ARMS.map((a) => a.id).join(", ")}`);
  }
  return arm;
}
