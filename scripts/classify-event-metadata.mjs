import { readFile, writeFile } from "node:fs/promises";
import { classifyEventText, mergeClassifications } from "./event-classifier.mjs";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { generatedAt: "", artists: {} });
const nonArtistIds = new Set();
let updatedEvents = 0;

const classifiedEvents = events.map((event) => {
  const classifications = [classifyEventText([event.title, event.details].filter(Boolean).join(" "))];
  const artists = [];
  const titles = [];

  for (const artist of event.artists || []) {
    const classification = classifyEventText(artist.name);
    classifications.push(classification);
    if (classification.isNonArtistListing) {
      nonArtistIds.add(slugify(artist.name));
      titles.push(artist.name);
    } else {
      artists.push(artist);
    }
  }

  const merged = mergeClassifications(...classifications);
  const next = {
    ...event,
    title: event.title || titles.join(", "),
    showType: artists.length ? "artist" : "event",
    eventTypes: merged.eventTypes,
    themes: merged.themes,
    artists
  };

  if (event.showType !== next.showType || (event.artists || []).length !== artists.length || next.eventTypes.length !== (event.eventTypes || []).length || next.themes.length !== (event.themes || []).length) {
    updatedEvents += 1;
  }

  return next;
});

let removedArtists = 0;
for (const id of nonArtistIds) {
  if (store.artists?.[id]) {
    delete store.artists[id];
    removedArtists += 1;
  }
}

store.generatedAt = new Date().toISOString();
await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(classifiedEvents, null, 2)};\n`, "utf8");
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");

console.log(`Classified metadata on ${updatedEvents} events and removed ${removedArtists} non-artist records.`);

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

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
