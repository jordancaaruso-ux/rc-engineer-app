/**
 * Generate answers for one arm over the seed set.
 *
 *   npm run engineer:eval -- --arm v1 [--batch 2026-08-14] [--questions path.json] [--only dir-01,dir-02]
 *
 * Writes scripts/engineer-eval/answers/<batch>/<arm>.json (gitignored). Requires
 * OPENAI_API_KEY (the answers run on the Engineer's own model/transport).
 */
import fs from "node:fs";
import path from "node:path";
import { runEngineerChatTurn } from "@/lib/engineer/chat";
import { ENGINEER_PROMPT_VERSION } from "@/lib/engineer/prompt";
import { getArm } from "./arms";

type SeedQuestion = { id: string; archetype: string; question: string };

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const armId = argValue("--arm");
  if (!armId) {
    console.error("Usage: engineer:eval -- --arm <id> [--batch <name>] [--questions <file>] [--only id1,id2]");
    process.exit(1);
  }
  const arm = getArm(armId);
  const batch = argValue("--batch") ?? new Date().toISOString().slice(0, 10);
  const questionsPath =
    argValue("--questions") ?? path.join(__dirname, "questions", "seed-questions.json");
  const only = argValue("--only")?.split(",").map((s) => s.trim()) ?? null;

  const seed = JSON.parse(fs.readFileSync(questionsPath, "utf8")) as {
    questions: SeedQuestion[];
  };
  const questions = seed.questions.filter((q) => !only || only.includes(q.id));

  const blocks = await arm.buildBlocks();
  const outDir = path.join(__dirname, "answers", batch);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${arm.id}.json`);

  // Resume: keep answers already generated in a previous partial run of this batch/arm.
  const existing: Record<string, unknown> = fs.existsSync(outPath)
    ? (JSON.parse(fs.readFileSync(outPath, "utf8")).answers ?? {})
    : {};

  const answers = existing as Record<
    string,
    { question: string; archetype: string; reply: string; model: string; usage: unknown }
  >;

  let done = 0;
  for (const q of questions) {
    if (answers[q.id]) {
      done++;
      continue;
    }
    process.stdout.write(`[${arm.id}] ${q.id} … `);
    try {
      const out = await runEngineerChatTurn({ question: q.question, blocks });
      answers[q.id] = {
        question: q.question,
        archetype: q.archetype,
        reply: out.reply,
        model: out.model,
        usage: out.usage,
      };
      done++;
      console.log(`ok (${out.reply.length} chars)`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        { arm: arm.id, batch, promptVersion: ENGINEER_PROMPT_VERSION, answers },
        null,
        2
      )
    );
  }

  console.log(`\n${done}/${questions.length} answered → ${outPath}`);
}

void main();
