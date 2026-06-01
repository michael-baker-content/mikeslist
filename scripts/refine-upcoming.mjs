import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const ROOT = fileURLToPath(new URL("../", import.meta.url));

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const days = Number(args.get("days") || 14);
const limit = Number(args.get("limit") || 25);
const from = args.get("from") || todayLocalDate();
const retryConsidered = args.has("retry-considered");
const dryRun = args.has("dry-run");
const listOnly = args.has("list-only");

if (!Number.isFinite(days) || days < 1) {
  throw new Error("--days must be a positive number.");
}

if (!Number.isFinite(limit) || limit < 1) {
  throw new Error("--limit must be a positive number.");
}

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const artistByName = new Map(Object.values(store.artists || {}).map((artist) => [normalizeName(artist.name), artist]));

const startDate = parseLocalDate(from);
const endDate = addDays(startDate, days);
const upcoming = upcomingArtists(events, startDate, endDate, artistByName)
  .filter(({ artist }) => artist.confidence === "review")
  .filter(({ artist }) => retryConsidered || !artist.reconsideredAt)
  .slice(0, limit);

console.log(JSON.stringify({
  from: formatLocalDate(startDate),
  through: formatLocalDate(addDays(endDate, -1)),
  days,
  candidates: upcoming.length,
  dryRun,
  listOnly,
  retryConsidered
}, null, 2));

if (!upcoming.length) {
  console.log("No upcoming review artists need refinement in that date window.");
  process.exit(0);
}

if (listOnly) {
  for (const { artist, event } of upcoming) {
    console.log(`${event.date} | ${event.venue} | ${artist.name}`);
  }
  process.exit(0);
}

for (const { artist, event } of upcoming) {
  console.log(`\nRefining ${artist.name} (${event.date}, ${event.venue})`);
  await run(process.execPath, [
    "scripts/reconsider-review-artists.mjs",
    `--artist=${artist.name}`,
    "--limit=1",
    "--save-every=1",
    ...(retryConsidered ? ["--retry-considered"] : []),
    ...(dryRun ? ["--dry-run"] : [])
  ]);
}

console.log(`\nRefined ${upcoming.length} upcoming artist records.`);

function upcomingArtists(events, startDate, endDate, artistByName) {
  const seen = new Set();
  const candidates = [];

  for (const event of events) {
    const eventDate = parseLocalDate(event.date);
    if (eventDate < startDate || eventDate >= endDate) continue;

    for (const eventArtist of event.artists || []) {
      const key = normalizeName(eventArtist.name);
      if (seen.has(key)) continue;
      seen.add(key);

      const artist = artistByName.get(key);
      if (artist) candidates.push({ artist, event });
    }
  }

  return candidates.sort((a, b) => {
    return a.event.date.localeCompare(b.event.date) || a.artist.name.localeCompare(b.artist.name);
  });
}

async function readWindowData(path, globalName, fallback) {
  try {
    const text = await readFile(path, "utf8");
    const match = text.match(new RegExp(`window\\.${globalName}\\s*=\\s*([\\s\\S]*);\\s*$`));
    return match ? JSON.parse(match[1]) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function run(command, runArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, runArgs, {
      cwd: ROOT,
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${runArgs.map((arg) => JSON.stringify(arg)).join(" ")} exited with ${code}`));
    });
  });
}

function parseLocalDate(date) {
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Expected date as YYYY-MM-DD, got "${date}".`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayLocalDate() {
  return formatLocalDate(new Date());
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
