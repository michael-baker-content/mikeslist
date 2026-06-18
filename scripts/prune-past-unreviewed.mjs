import { readFile } from "node:fs/promises";
import { writeTextFile } from "./file-io.mjs";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const PUBLIC_ARTISTS_PATH = new URL("../data/public-artists.js", import.meta.url);

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
  return [key, valueParts.join("=") || "true"];
}));

const beforeDate = dateArgument(args.get("before") || "today");
const dryRun = args.has("dry-run");
const keepImportNotes = args.has("keep-import-notes");
const purgeInactiveUnmarked = args.has("purge-inactive-unmarked");

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const artistStore = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", {
  generatedAt: "",
  artists: {}
});

const keptEvents = events.filter((event) => !event.date || event.date >= beforeDate);
const removedEvents = events.length - keptEvents.length;
const activeArtistIds = activeArtistIdsFor(keptEvents);
const removedArtists = [];
const keptArtists = {};

for (const [id, artist] of Object.entries(artistStore.artists || {})) {
  const inactive = !activeArtistIds.has(id);
  if (inactive && shouldRemoveInactiveArtist(artist)) {
    removedArtists.push({ id, name: artist.displayName || artist.name || id });
    continue;
  }
  keptArtists[id] = artist;
}

const nextArtistStore = {
  ...artistStore,
  generatedAt: new Date().toISOString(),
  artists: Object.fromEntries(Object.entries(keptArtists).sort(([a], [b]) => a.localeCompare(b)))
};

if (!dryRun) {
  await writeTextFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(keptEvents, null, 2)};\n`, "utf8");
  await writeTextFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(nextArtistStore, null, 2)};\n`, "utf8");
  await writeTextFile(PUBLIC_ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(publicArtistStore(nextArtistStore))};\n`, "utf8");
}

console.log(JSON.stringify({
  beforeDate,
  dryRun,
  removedEvents,
  remainingEvents: keptEvents.length,
  removedArtists: removedArtists.length,
  remainingArtists: Object.keys(nextArtistStore.artists).length,
  removedArtistNames: removedArtists.map((artist) => artist.name)
}, null, 2));

function activeArtistIdsFor(list) {
  const ids = new Set();
  for (const event of list) {
    if (showTypeForEvent(event) !== "artist") continue;
    for (const artist of event.artists || []) {
      const id = slugify(artist.id || artist.name);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function shouldRemoveInactiveArtist(artist) {
  if (purgeInactiveUnmarked && !hasImageInfo(artist) && !hasManualNote(artist.reviewNotes) && !hasManualNote(artist.note)) {
    return true;
  }
  return !hasReviewedArtistInfo(artist) || hasOnlyGeneratedLinks(artist);
}

function hasReviewedArtistInfo(artist) {
  const genres = cleanList(artist.genres || artist.tags).filter((item) => item.toLowerCase() !== "unknown");
  const locality = artist.locality && artist.locality.toLowerCase() !== "unknown";
  const verifiedLinks = (artist.links || []).filter((link) => link?.url && link.confidence === "verified");

  return Boolean(
    (artist.confidence && artist.confidence !== "review")
    || genres.length
    || locality
    || artist.imageUrl
    || artist.imageSource
    || artist.manuallyReviewed
    || artist.manuallyReviewedAt
    || artist.summary
    || artist.disambiguation
    || hasManualNote(artist.reviewNotes)
    || hasManualNote(artist.note)
    || (artist.evidence || []).length
    || (artist.supportPriority || []).length
    || verifiedLinks.length
  );
}

function hasImageInfo(artist) {
  return Boolean(artist.imageUrl || artist.imageSource);
}

function hasManualNote(note) {
  const value = String(note || "").trim();
  if (!value) return false;
  if (keepImportNotes) return true;
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\bImported from (?:The List|KALX)\.\s*/g, "")
    .trim();
  return Boolean(normalized) && !/^Extracted from event-style artist listing\b/.test(normalized);
}

function hasOnlyGeneratedLinks(artist) {
  const links = (artist.links || []).filter((link) => link?.url);
  return links.length > 0 && links.every(isGeneratedLink);
}

function isGeneratedLink(link) {
  const type = String(link.type || "").toLowerCase();
  const host = hostFor(link.url);
  return type === "search"
    || type === "musicbrainz"
    || type === "wikidata"
    || type === "maps"
    || type === "discogs"
    || type === "discogsartist"
    || type === "discogsalias"
    || type === "discogslegalname"
    || type === "applemusic"
    || type === "deezer"
    || type === "tidal"
    || host === "duckduckgo.com"
    || host === "musicbrainz.org"
    || host === "wikidata.org"
    || host === "maps.google.com"
    || host === "google.com"
    || host === "discogs.com"
    || host === "music.apple.com"
    || host === "deezer.com"
    || host === "tidal.com"
    || host === "jon.luini.com"
    || host === "kalx.berkeley.edu"
    || host === "badslava.com";
}

function hostFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function publicArtistStore(store) {
  return {
    generatedAt: store.generatedAt || new Date().toISOString(),
    artists: Object.fromEntries(Object.entries(store.artists || {})
      .map(([id, artist]) => [id, publicArtistRecord(artist)])
      .sort(([a], [b]) => a.localeCompare(b)))
  };
}

function publicArtistRecord(artist) {
  return {
    id: artist.id,
    name: artist.name,
    displayName: artist.displayName || "",
    aliases: cleanList(artist.aliases),
    genres: cleanList(artist.genres || artist.tags).filter((item) => item !== "unknown"),
    locality: artist.locality && artist.locality !== "unknown" ? artist.locality : "",
    imageUrl: artist.imageUrl || "",
    imageSource: artist.imageSource || "",
    summary: artist.summary || "",
    links: publicLinks(artist.links || []),
    supportPriority: cleanList(artist.supportPriority)
  };
}

function publicLinks(links) {
  return links
    .filter((link) => {
      if (!link?.url || link.confidence === "rejected" || link.display === false) return false;
      if (link.type === "search" || link.confidence === "research") return false;
      return true;
    })
    .map((link) => ({
      type: link.type || "official",
      label: link.label || "",
      url: link.url,
      confidence: link.confidence || "candidate",
      displayPriority: link.displayPriority || ""
    }));
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

function dateArgument(value) {
  if (value === "today") return todayString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error(`Invalid --before value "${value}". Use today or YYYY-MM-DD.`);
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function cleanList(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
