import Database from "better-sqlite3";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const dataDirectory = path.resolve(".creator-os");
const databasePath = path.join(dataDirectory, "creator-os.sqlite");
const backupDirectory = path.join(dataDirectory, "backups");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const destination = path.join(backupDirectory, `creator-os-${stamp}.sqlite`);

await mkdir(backupDirectory, { recursive: true });
const db = new Database(databasePath);
const integrity = db.pragma("quick_check", { simple: true });
if (integrity !== "ok") throw new Error(`Database integrity check failed: ${integrity}`);
db.pragma("wal_checkpoint(FULL)");
await db.backup(destination);
db.close();

const backups = (await readdir(backupDirectory))
  .filter((name) => /^creator-os-.*\.sqlite$/.test(name))
  .sort()
  .reverse();
for (const oldBackup of backups.slice(10)) await rm(path.join(backupDirectory, oldBackup));

console.log(`Backup created: ${destination}`);
console.log(`Retained ${Math.min(backups.length, 10)} recent backups.`);
