// Rulings roll-call: is every founder ruling on the Engineer actually in the code?
//
//   npm run engineer:rulings                       the working tree
//   npm run engineer:rulings -- --ref origin/main  what production builds from
//   npm run engineer:rulings -- --ref origin/beta  what the beta site builds from
//
// Exit code 1 when any ruling is missing. No dependencies — it has to run anywhere, including a
// fresh worktree before `npm ci`. The list is scripts/engineer-eval/rulings.json.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const ref = refAt >= 0 ? args[refAt + 1] : null;
const squash = (s) => s.replace(/\r\n/g, "\n").replace(/\s+/g, " ");

function read(file) {
  try {
    if (!ref) return fs.readFileSync(path.join(root, file), "utf8");
    return execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const { rulings } = JSON.parse(fs.readFileSync(path.join(root, "scripts/engineer-eval/rulings.json"), "utf8"));
let missing = 0;
console.log(`Rulings roll-call against ${ref ?? "the working tree"}\n`);
for (const r of rulings) {
  const text = read(r.file);
  let ok, why = "";
  if (text === null) {
    ok = false;
    why = `file not found: ${r.file}`;
  } else if (r.present !== undefined) {
    ok = squash(text).includes(squash(r.present));
    if (!ok) why = `sentence not found in ${r.file}`;
  } else {
    ok = !squash(text).includes(squash(r.absent));
    if (!ok) why = `"${r.absent}" is still in ${r.file}`;
  }
  if (!ok) missing++;
  console.log(`${ok ? "  in  " : "MISSING"}  ${r.date}  ${r.ruling}${ok ? "" : `\n           ${why}`}`);
}
console.log(`\n${rulings.length - missing} of ${rulings.length} rulings are in ${ref ?? "the working tree"}.`);
process.exit(missing ? 1 : 0);
