import { writeFile } from "node:fs/promises";

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
