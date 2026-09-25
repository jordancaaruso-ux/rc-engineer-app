// Compiles src/app/globals.css with the app's own Tailwind setup and writes it to argv[2].
//
// Plain Node on purpose: under tsx, Tailwind's loader cannot read tailwind.config.ts, the
// `@config` is dropped without a word and the compile dies on the first custom colour
// ("Cannot apply unknown utility class `text-foreground`"). build.tsx runs this as a child.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const entry = path.join(process.cwd(), "src/app/globals.css");
const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/design-system/compile-app-css.mjs <out.css>");

const result = await postcss([tailwind({ optimize: { minify: true } })]).process(
  readFileSync(entry, "utf8"),
  { from: entry }
);
writeFileSync(out, result.css);
