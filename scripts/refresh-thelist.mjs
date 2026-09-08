import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const steps = [
  ["Back up current data files", "scripts/backup-data-files.mjs"],
  ["Import The List", "scripts/import-thelist.mjs", ...process.argv.slice(2)],
  ["Import KALX", "scripts/import-kalx.mjs", ...process.argv.slice(2)],
  ["Classify event metadata", "scripts/classify-event-metadata.mjs"],
  ["Prune out-of-scope event listings", "scripts/prune-nonmusic-events.mjs"],
  ["Sync import ledger", "scripts/sync-sqlite-imports.mjs"],
  ["Apply saved review decisions", "scripts/apply-sqlite-decisions.mjs"],
  ["Rebuild artist store", "scripts/build-artist-store.mjs"],
  ["Rebuild public artist store", "scripts/build-public-artist-store.mjs"],
  ["Rebuild venue store", "scripts/build-venue-store.mjs"],
  ["Sync canonical database", "scripts/sync-sqlite-canonical.mjs"]
];

for (const [label, script, ...args] of steps) {
  console.log(`\n${label}`);
  await run("node", [script, ...args]);
}

console.log("\nThe List refresh complete.");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: true,
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
