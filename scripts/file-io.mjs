import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSIENT_WRITE_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES", "EMFILE", "ENFILE"]);

export async function writeTextFile(path, contents, encoding = "utf8") {
  const delays = [25, 50, 100, 200, 400, 800];
  let lastError;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await writeFile(path, contents, encoding);
      return;
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_WRITE_CODES.has(error.code) || attempt === delays.length) break;
      await wait(delays[attempt]);
    }
  }

  throw lastError;
}

export async function backupFile(path, options = {}) {
  const source = path instanceof URL ? fileURLToPath(path) : String(path);
  try {
    await stat(source);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }

  const outputDir = options.outputDir || join(dirname(source), "backups");
  await mkdir(outputDir, { recursive: true });
  const extension = extname(source);
  const name = basename(source, extension);
  const backupPath = join(outputDir, `${name}.${timestampForFilename()}${extension}`);
  await copyFile(source, backupPath);
  return backupPath;
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
