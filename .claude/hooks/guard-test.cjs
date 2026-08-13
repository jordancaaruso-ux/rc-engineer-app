// Guard proof harness for .claude/hooks/*.cjs — run: node .claude/hooks/guard-test.cjs
// Builds hook stdin in-process so no shell escaping is involved.
const { execFileSync } = require("child_process");
const REPO = require("path").resolve(__dirname, "../..");  // repo root, wherever it is cloned
const WIN = String.raw`c:\Users\Jordan\rc-engineer-app`;

function run(hook, tool_input) {
  const out = execFileSync("node", [`${REPO}/.claude/hooks/${hook}`], {
    input: JSON.stringify({ tool_input }),
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.permissionDecision.toUpperCase() : "ALLOW";
}

const cases = [
  // [hook, label, tool_input, expected]
  ["kb-guard.cjs", "Edit locked prose (Windows abs)", { file_path: `${WIN}\\content\\vehicle-dynamics\\roll-centre.md` }, "ASK"],
  ["kb-guard.cjs", "Edit locked prose (POSIX rel)", { file_path: "content/vehicle-dynamics/roll-centre.md" }, "ASK"],
  ["kb-guard.cjs", "Edit reviewed net", { file_path: "content/nets/touring/front-arb.yaml" }, "ASK"],
  ["kb-guard.cjs", "Edit nets draft", { file_path: "content/nets/drafts/rear-toe.yaml" }, "ALLOW"],
  ["kb-guard.cjs", "Edit DRAFT (Windows abs)", { file_path: `${WIN}\\content\\vehicle-dynamics\\drafts\\upstop.md` }, "ALLOW"],
  ["kb-guard.cjs", "Edit DRAFT (POSIX rel)", { file_path: "content/vehicle-dynamics/drafts/upstop.md" }, "ALLOW"],
  ["kb-guard.cjs", "Edit unrelated source", { file_path: "src/lib/runs/tirePrep.ts" }, "ALLOW"],
  ["kb-guard.cjs", "Bash redirect into locked", { command: "echo pwned > content/vehicle-dynamics/roll-centre.md" }, "ASK"],
  ["kb-guard.cjs", "Bash tee into locked", { command: "cat f | tee content/vehicle-dynamics/bite.md" }, "ASK"],
  ["kb-guard.cjs", "Bash sed -i on locked", { command: "sed -i s/a/b/ content/vehicle-dynamics/bite.md" }, "ASK"],
  ["kb-guard.cjs", "Bash rm locked", { command: "rm content/vehicle-dynamics/bite.md" }, "ASK"],
  ["kb-guard.cjs", "Bash overwrite reviewed net", { command: "echo x > content/nets/touring/front-arb.yaml" }, "ASK"],
  ["kb-guard.cjs", "Bash redirect into DRAFT", { command: "echo x > content/vehicle-dynamics/drafts/upstop.md" }, "ALLOW"],
  ["kb-guard.cjs", "Bash grep locked (read only)", { command: "grep -n camber content/vehicle-dynamics/roll-centre.md" }, "ALLOW"],

  ["prod-guard.cjs", "npm run build", { command: "npm run build" }, "DENY"],
  ["prod-guard.cjs", "dotenv-cli -> prisma db push", { command: "npx dotenv-cli -e .env.local -- prisma db push" }, "DENY"],
  ["prod-guard.cjs", "npm run db:push", { command: "npm run db:push" }, "DENY"],
  ["prod-guard.cjs", "npm run db:migrate:deploy", { command: "npm run db:migrate:deploy" }, "DENY"],
  ["prod-guard.cjs", "prisma migrate deploy (raw)", { command: "npx prisma migrate deploy" }, "DENY"],
  ["prod-guard.cjs", "npm run db:seed", { command: "npm run db:seed" }, "DENY"],
  ["prod-guard.cjs", "composed: sh -c npm run build", { command: 'sh -c "npm run build"' }, "DENY"],
  ["prod-guard.cjs", "composed: echo && db:push", { command: "echo hi && npm run db:push" }, "DENY"],
  ["prod-guard.cjs", "npx next build", { command: "npx next build" }, "ALLOW"],
  ["prod-guard.cjs", "db:migrate:reconcile (repair)", { command: "npm run db:migrate:reconcile" }, "ALLOW"],
  ["prod-guard.cjs", "migrate resolve (repair)", { command: "npm run db:migrate:resolve:applied" }, "ALLOW"],
  ["prod-guard.cjs", "npm run test:roll-center", { command: "npm run test:roll-center" }, "ALLOW"],
  ["prod-guard.cjs", "npx tsc --noEmit", { command: "npx tsc --noEmit" }, "ALLOW"],

  // Prose that MENTIONS a blocked command must not trip the guard (regression: the guard
  // blocked the very commit that introduced it).
  ["prod-guard.cjs", "commit msg heredoc mentions db:push", { command: "git commit -F - <<'EOF'\nHarness: guard db:push and npm run build\n\nDrop the db:push allow.\nEOF" }, "ALLOW"],
  ["prod-guard.cjs", "commit -m mentions db:push", { command: `git commit -m "deny db:push and npm run build"` }, "ALLOW"],
  ["prod-guard.cjs", "commit -m single-quoted", { command: "git commit -m 'block npm run build'" }, "ALLOW"],
  // ...but quoting must NOT become a bypass.
  ["prod-guard.cjs", "BYPASS ATTEMPT sh -c single-quoted", { command: "sh -c 'npm run db:push'" }, "DENY"],
  ["prod-guard.cjs", "BYPASS ATTEMPT heredoc to shell", { command: "bash <<'EOF'\nnpm run db:push\nEOF" }, "DENY"],
];

let fail = 0;
for (const [hook, label, input, expected] of cases) {
  const got = run(hook, input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${hook.replace(".cjs", "").padEnd(10)} ${label.padEnd(32)} expected ${expected.padEnd(5)} got ${got}`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
