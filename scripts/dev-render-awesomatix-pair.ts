import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdf } from "pdf-to-img";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\sheets`;

async function render(label: string, file: string) {
  const bytes = await readFile(file);
  const doc = await pdf(bytes, { scale: 3 });
  let i = 0;
  for await (const page of doc) {
    i += 1;
    await writeFile(path.join(OUT, `${label}-p${i}.png`), page);
  }
  console.log(`${label}: ${i} page(s)`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await render("original", path.resolve("public/setup-sheets/A800RR.pdf"));
  await render("lucas", path.resolve("scripts/tmp-lucas-setup2.pdf"));
}

main();
