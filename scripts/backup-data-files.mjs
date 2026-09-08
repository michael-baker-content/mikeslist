import { backupFile } from "./file-io.mjs";
import { fileURLToPath } from "node:url";

const dryRun = process.argv.includes("--dry-run");
const DATA_FILES = [
  "../data/imported-events.js",
  "../data/artists.js",
  "../data/public-artists.js",
  "../data/venues.js"
];

const files = DATA_FILES.map((path) => new URL(path, import.meta.url));
const backups = [];

for (const file of files) {
  if (dryRun) {
    backups.push({ source: fileURLToPath(file), backup: "" });
    continue;
  }
  backups.push({ source: fileURLToPath(file), backup: await backupFile(file) });
}

console.log(JSON.stringify({
  dryRun,
  backups
}, null, 2));
