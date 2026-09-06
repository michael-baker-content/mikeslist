import { readFile, writeFile } from "node:fs/promises";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);

const REMOVE_EVENT_TYPES = new Set([
  "book",
  "chess",
  "comedy",
  "film",
  "game",
  "openMic",
  "poetry",
  "storytelling",
  "trivia"
]);

const MUSIC_ADJACENT_EVENT_TYPES = new Set([
  "coverBand",
  "dance",
  "jam",
  "karaoke"
]);

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const retained = [];
const removed = [];

for (const event of events) {
  if (shouldRemoveEvent(event)) removed.push(event);
  else retained.push(event);
}

await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(retained, null, 2)};\n`, "utf8");

const removedSourceCount = removed.filter(hasRemovedSource).length;
const categoryCount = removed.length - removedSourceCount;
console.log(`Removed ${removed.length} non-scope events (${removedSourceCount} removed source, ${categoryCount} non-music category) from ${EVENTS_PATH.pathname}`);

function shouldRemoveEvent(event) {
  if (hasRemovedSource(event)) return true;
  if (showTypeForEvent(event) !== "event") return false;
  const eventTypes = event.eventTypes || [];
  if (eventTypes.some((type) => MUSIC_ADJACENT_EVENT_TYPES.has(type))) return false;
  return eventTypes.some((type) => REMOVE_EVENT_TYPES.has(type));
}

function hasRemovedSource(event) {
  return [...(event.sources || []), event.source].filter(Boolean).some((source) => {
    return /badslava/i.test(source.name || "") || /badslava\.com/i.test(source.url || "");
  });
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
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
