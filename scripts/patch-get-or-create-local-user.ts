/**
 * One-shot codemod: replace getOrCreateLocalUser with session-aware helpers.
 * Run: npx tsx scripts/patch-get-or-create-local-user.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
}

const files: string[] = [];
walk(srcRoot, files);

for (const file of files) {
  if (file.endsWith(`${path.sep}currentUser.ts`)) continue;
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("getOrCreateLocalUser")) continue;

  const isApi = file.includes(`${path.sep}api${path.sep}`) && file.endsWith("route.ts");

  if (isApi) {
    const hasNextResponse = /import\s*\{[^}]*NextResponse[^}]*\}\s*from\s*["']next\/server["']/.test(
      text
    );
    text = text.replace(
      /import \{ getOrCreateLocalUser \} from "@\/lib\/currentUser";/,
      hasNextResponse
        ? `import { getAuthenticatedApiUser } from "@/lib/currentUser";`
        : `import { NextResponse } from "next/server";\nimport { getAuthenticatedApiUser } from "@/lib/currentUser";`
    );
    text = text.replace(
      /const user = await getOrCreateLocalUser\(\);/g,
      'const user = await getAuthenticatedApiUser();\n    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });'
    );
    let n = 0;
    text = text.replace(/await getOrCreateLocalUser\(\);/g, () => {
      n += 1;
      const v = n === 1 ? "__authUser" : `__authUser${n}`;
      return `const ${v} = await getAuthenticatedApiUser();\n    if (!${v}) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`;
    });
  } else {
    text = text.replace(
      /import \{ getOrCreateLocalUser \} from "@\/lib\/currentUser";/,
      `import { requireCurrentUser } from "@/lib/currentUser";`
    );
    text = text.replace(/await getOrCreateLocalUser\(\);/g, "await requireCurrentUser();");
    text = text.replace(
      /const user = await getOrCreateLocalUser\(\);/g,
      "const user = await requireCurrentUser();"
    );
  }

  fs.writeFileSync(file, text, "utf8");
  console.log("patched", path.relative(srcRoot, file));
}

console.log("done");
