/**
 * Answer the launch set as CONVERSATIONS, in context.
 *
 *   npm run engineer:launch -- [--batch launch-2026-09-09] [--arm v1-nets] [--cases questions/launch-set.json] [--only d-01,f-03] [--contexts none,run-with-setup]
 *
 * Why this exists beside generate-answers.ts (2026-09-09, founder call): the seed harness answers
 * one question with no driver data. Real usage (283 threads on the production copy) is a third
 * one-word follow-ups — "Everywhere", "Exit" — answering the Engineer's own question, and every
 * live request carries the driver's latest run. So a case here is a list of driver turns, each
 * Engineer reply is generated live and fed back as history exactly as the chat route does, and
 * every case runs once per context: `none` (no driver data — 63% of accounts) and a fixture file
 * under fixtures/<name>.txt used verbatim as the driver-data block (a real render captured from
 * driverData.ts, trimmed to the majority active user: car, track, laps, setup).
 *
 * A context may also carry fixtures/<name>.liverc.txt — the Engineer's one tool's answer, captured
 * for real by capture-run-fixture.ts --practice-day. When that file exists the tool is offered
 * exactly as the chat route offers it, and every call is answered from the file, so a round is
 * repeatable and never touches LiveRC. An assistant turn records the calls it made in `fetched`.
 *
 * Writes answers/<batch>/<arm>__<context>.json (gitignored). Resumes per case. Requires
 * OPENAI_API_KEY (answers run on the Engineer's own model/transport).
 *
 * Model and reasoning effort come from ENGINEER_MODEL / ENGINEER_REASONING_EFFORT (shell beats
 * .env.local). Every case records the model, the effort it ran at and each turn's time, because an
 * unrecorded effort once left a round's answers unmatched to what drivers get. `--dry` prints the
 * settings a run would use and stops before any call.
 */
import fs from "node:fs";
import path from "node:path";
import { generateEngineerChatReply } from "@/lib/engineer/chat";
import { engineerChatModel, engineerReasoningEffort } from "@/lib/engineer/openai";
import type { EngineerChatMessage, EngineerPayloadBlock } from "@/lib/engineer/payload";
import { ENGINEER_PROMPT_VERSION } from "@/lib/engineer/prompt";
import { LIVERC_PRACTICE_TOOL_DEFINITION } from "@/lib/engineer/livercPracticeTool";
import type { EngineerTools } from "@/lib/engineer/toolTypes";
import { getArm } from "./arms";

type LaunchCase = { id: string; shape: string; source: string; turns: string[] };
type LaunchSet = { contexts: string[]; cases: LaunchCase[] };
type Turn = { role: "user" | "assistant"; content: string; fetched?: string[] };
type CaseResult = {
  shape: string;
  source: string;
  turns: Turn[];
  model: string;
  /** The effort sent, or "model default" when none was (the production case today). */
  effort?: string;
  usage: unknown[];
  /** Wall time of each assistant turn, ms. */
  ms?: number[];
};
type AnswerFile = {
  arm: string;
  context: string;
  batch: string;
  promptVersion: string;
  fixture: string | null;
  cases: Record<string, CaseResult>;
};

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function loadFixture(name: string): string | null {
  if (name === "none") return null;
  const file = path.join(__dirname, "fixtures", `${name}.txt`);
  if (!fs.existsSync(file)) throw new Error(`No fixture file for context "${name}": ${file}`);
  return fs.readFileSync(file, "utf8").trim();
}

/** The tool, answered from the context's recorded LiveRC text; null when the context has none. */
function loadToolFixture(name: string, fetched: string[]): EngineerTools | null {
  if (name === "none") return null;
  const file = path.join(__dirname, "fixtures", `${name}.liverc.txt`);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").trim();
  return {
    definitions: [LIVERC_PRACTICE_TOOL_DEFINITION],
    run: async (toolName, args) => {
      fetched.push(`${toolName} ${args}`);
      return text;
    },
  };
}

async function main() {
  const armId = argValue("--arm") ?? "v1-nets";
  const arm = getArm(armId);
  const batch = argValue("--batch") ?? `launch-${new Date().toISOString().slice(0, 10)}`;
  const casesPath = argValue("--cases") ?? path.join(__dirname, "questions", "launch-set.json");
  const set = JSON.parse(fs.readFileSync(casesPath, "utf8")) as LaunchSet;
  const only = argValue("--only")?.split(",").map((s) => s.trim()) ?? null;
  const contexts = argValue("--contexts")?.split(",").map((s) => s.trim()) ?? set.contexts;
  const cases = set.cases.filter((c) => !only || only.includes(c.id));

  const setting = engineerChatModel().model;
  const effortOf = (model: string) => engineerReasoningEffort(model) ?? "model default";
  console.log(`model ${setting} · reasoning effort ${effortOf(setting)}`);
  if (process.argv.includes("--dry")) return;

  const blocks = await arm.buildBlocks();
  const outDir = path.join(__dirname, "answers", batch);
  fs.mkdirSync(outDir, { recursive: true });

  for (const context of contexts) {
    const fixture = loadFixture(context);
    const driverBlocks: EngineerPayloadBlock[] = fixture
      ? [{ id: "driver-data", cacheStable: false, content: fixture }]
      : [];
    const outPath = path.join(outDir, `${arm.id}__${context}.json`);
    const file: AnswerFile = fs.existsSync(outPath)
      ? (JSON.parse(fs.readFileSync(outPath, "utf8")) as AnswerFile)
      : { arm: arm.id, context, batch, promptVersion: ENGINEER_PROMPT_VERSION, fixture, cases: {} };

    let done = 0;
    for (const c of cases) {
      if (file.cases[c.id]) {
        done++;
        continue;
      }
      process.stdout.write(`[${arm.id} · ${context}] ${c.id} (${c.turns.length} turn${c.turns.length > 1 ? "s" : ""}) … `);
      const turns: Turn[] = [];
      const usage: unknown[] = [];
      const ms: number[] = [];
      let model = "";
      try {
        for (const q of c.turns) {
          turns.push({ role: "user", content: q });
          const history: EngineerChatMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
          const fetched: string[] = [];
          const tools = loadToolFixture(context, fetched) ?? undefined;
          const started = Date.now();
          const out = await generateEngineerChatReply({ messages: history, blocks, driverBlocks, tools });
          ms.push(Date.now() - started);
          turns.push({ role: "assistant", content: out.reply, ...(fetched.length > 0 ? { fetched } : {}) });
          usage.push(out.usage);
          model = out.model;
        }
        file.cases[c.id] = { shape: c.shape, source: c.source, turns, model, effort: effortOf(model), usage, ms };
        done++;
        const fetches = turns.filter((t) => t.fetched?.length).length;
        console.log(`ok (${turns.filter((t) => t.role === "assistant").map((t) => t.content.length).join("+")} chars${fetches ? `, fetched LiveRC on ${fetches} turn${fetches === 1 ? "" : "s"}` : ""})`);
      } catch (err) {
        console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
      fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
    }
    console.log(`${done}/${cases.length} conversations in context "${context}" → ${outPath}\n`);
  }
}

void main();
