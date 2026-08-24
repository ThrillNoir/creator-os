import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Provide at least one generated type declaration path.");

for (const file of files) {
  const filePath = path.resolve(file);
  const source = readFileSync(filePath, "utf8");
  const normalized = source.replace(/[\t ]+(?=\r?\n)/g, "");
  if (normalized !== source) writeFileSync(filePath, normalized);
}
