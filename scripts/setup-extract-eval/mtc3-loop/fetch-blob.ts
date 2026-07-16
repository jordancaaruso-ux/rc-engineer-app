import "dotenv/config";
import { writeFileSync } from "node:fs";
async function main() {
  const url = process.argv[2]!;
  const out = process.argv[3]!;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${out}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
