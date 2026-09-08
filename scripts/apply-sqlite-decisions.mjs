import { readFile } from "node:fs/promises";
import { writeTextFile } from "./file-io.mjs";
import {
  DEFAULT_DB_PATH,
  applySchema,
  argValue,
  openDatabase,
  parseJson,
  suppressionFieldsForEvent
} from "./sqlite-store.mjs";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const dbPath = argValue("db", DEFAULT_DB_PATH);
const dryRun = process.argv.includes("--dry-run");

const events = await readEvents();
const db = openDatabase(dbPath);
await applySchema(db);
const suppressed = db.prepare("SELECT * FROM suppressed_imports WHERE entity_type = 'show'").all();
const overrides = db.prepare("SELECT * FROM show_overrides").all();
const exactIds = new Set(suppressed.map((row) => row.source_event_id).filter(Boolean));
const fuzzyKeys = new Set(suppressed.map((row) => fuzzySuppressionKey(row.event_date, row.venue_key, row.artist_key)).filter(Boolean));
const currentEventIds = new Set(events.map((event) => event.id).filter(Boolean));
const exactOverrides = new Map(overrides.map((row) => [row.show_id, row]));
const fuzzyOverrides = new Map(overrides
  .filter((row) => row.show_id && !currentEventIds.has(row.show_id))
  .map((row) => [fuzzySuppressionKey(row.event_date, row.venue_key, row.artist_key), row])
  .filter(([key]) => key));

const kept = [];
const removed = [];
let appliedOverrides = 0;
for (const event of events) {
  if (isSuppressed(event)) removed.push(event);
  else {
    if (applyOverride(event)) appliedOverrides += 1;
    kept.push(event);
  }
}

if (!dryRun && (removed.length || appliedOverrides)) {
  await writeTextFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(kept, null, 2)};\n`, "utf8");
}

db.close();

console.log(JSON.stringify({
  database: dbPath,
  dryRun,
  suppressedRules: suppressed.length,
  showOverrides: overrides.length,
  appliedOverrides,
  removed: removed.length,
  remaining: kept.length,
  removedEvents: removed.slice(0, 25).map((event) => ({
    id: event.id,
    date: event.date,
    venue: event.venue,
    artists: (event.artists || []).map((artist) => artist.displayName || artist.name).filter(Boolean).slice(0, 3)
  }))
}, null, 2));

async function readEvents() {
  const text = await readFile(EVENTS_PATH, "utf8");
  const match = text.match(/window\.SHOW_EXPLORER_EVENTS\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error("Could not read data/imported-events.js");
  return JSON.parse(match[1]);
}

function isSuppressed(event) {
  if (exactIds.has(event.id)) return true;
  return fuzzyKeys.has(eventSuppressionKey(event));
}

function applyOverride(event) {
  const override = exactOverrides.get(event.id) || fuzzyOverrides.get(eventSuppressionKey(event));
  if (!override) return false;
  const data = parseJson(override.data_json, {});
  const before = JSON.stringify(manualShowFields(event));
  applyManualShowFields(event, data);
  return before !== JSON.stringify(manualShowFields(event));
}

function manualShowFields(event) {
  return {
    showType: event.showType,
    title: event.title,
    displayName: event.displayName,
    details: event.details,
    eventDescription: event.eventDescription,
    eventTypes: event.eventTypes,
    themes: event.themes,
    artists: event.artists,
    infoUrl: event.infoUrl,
    imageUrl: event.imageUrl,
    imageSource: event.imageSource,
    mikesPick: event.mikesPick
  };
}

function applyManualShowFields(event, data) {
  copyStringField(event, data, "showType");
  copyStringField(event, data, "title");
  copyStringField(event, data, "displayName");
  copyStringField(event, data, "details");
  copyStringField(event, data, "eventDescription");
  copyStringField(event, data, "infoUrl");
  copyStringField(event, data, "imageUrl");
  copyStringField(event, data, "imageSource");
  copyArrayField(event, data, "eventTypes");
  copyArrayField(event, data, "themes");
  copyArrayField(event, data, "artists");
  if (typeof data.mikesPick === "boolean") event.mikesPick = data.mikesPick;
}

function copyStringField(target, source, key) {
  if (typeof source[key] === "string") target[key] = source[key];
}

function copyArrayField(target, source, key) {
  if (Array.isArray(source[key])) target[key] = source[key];
}

function eventSuppressionKey(event) {
  const fields = suppressionFieldsForEvent(event);
  return fuzzySuppressionKey(
    fields.eventDate,
    fields.venueKey,
    fields.artistKey
  );
}

function fuzzySuppressionKey(date, venueKey, artistKey) {
  if (!date || !venueKey || !artistKey) return "";
  return `${date}|${venueKey}|${artistKey}`;
}
