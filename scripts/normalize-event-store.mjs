import { readFile, writeFile } from "node:fs/promises";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);

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

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;|&#038;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value = "") {
  return decodeHtml(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanJoinedText(value = "") {
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return text;
  return uniqueList(parts).join(" / ");
}

function uniqueList(items = []) {
  const seen = new Set();
  return items.map(cleanJoinedText).filter((item) => {
    const key = normalizeText(item);
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeArtists(artists = []) {
  const merged = new Map();
  for (const artist of artists) {
    const key = normalizeText(artist.displayName || artist.name);
    if (!key) continue;
    const previous = merged.get(key);
    const cleanArtist = {
      ...artist,
      name: cleanJoinedText(artist.name),
      displayName: cleanJoinedText(artist.displayName || "")
    };
    merged.set(key, previous ? {
      ...previous,
      displayName: previous.displayName || cleanArtist.displayName || "",
      tags: uniqueList([...(previous.tags || []), ...(cleanArtist.tags || [])]),
      locality: previous.locality || cleanArtist.locality || "",
      confidence: higherConfidence(previous.confidence, cleanArtist.confidence),
      note: uniqueDetails(previous.note, cleanArtist.note),
      links: mergeLinks(previous.links || [], cleanArtist.links || [])
    } : cleanArtist);
  }
  return [...merged.values()];
}

function uniqueDetails(current = "", incoming = "") {
  const currentClean = cleanJoinedText(current);
  const incomingClean = cleanJoinedText(incoming);
  if (!currentClean) return incomingClean || "";
  if (!incomingClean || normalizeText(currentClean).includes(normalizeText(incomingClean))) return currentClean;
  if (normalizeText(incomingClean).includes(normalizeText(currentClean))) return incomingClean;
  return cleanJoinedText(`${currentClean} / ${incomingClean}`);
}

function mergeLinks(existing = [], incoming = []) {
  const links = new Map();
  [...existing, ...incoming].filter((link) => link?.url).forEach((link) => {
    const previous = links.get(link.url);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) links.set(link.url, { ...previous, ...link });
  });
  return [...links.values()];
}

function higherConfidence(current = "review", incoming = "review") {
  return confidenceRank(incoming) > confidenceRank(current) ? incoming : current;
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
let changed = 0;

for (const event of events) {
  const before = JSON.stringify({
    title: event.title,
    displayName: event.displayName,
    details: event.details,
    mikesPick: event.mikesPick,
    infoUrl: event.infoUrl,
    imageUrl: event.imageUrl,
    artists: event.artists
  });

  event.title = cleanJoinedText(event.title || "");
  event.displayName = cleanJoinedText(event.displayName || "");
  event.details = cleanJoinedText(event.details || "");
  event.mikesPick = Boolean(event.mikesPick);
  event.infoUrl = String(event.infoUrl || "").trim();
  event.imageUrl = String(event.imageUrl || "").trim();
  event.eventTypes = uniqueList(event.eventTypes || []);
  event.themes = uniqueList(event.themes || []);
  event.artists = mergeArtists(event.artists || []);

  const after = JSON.stringify({
    title: event.title,
    displayName: event.displayName,
    details: event.details,
    mikesPick: event.mikesPick,
    infoUrl: event.infoUrl,
    imageUrl: event.imageUrl,
    artists: event.artists
  });
  if (before !== after) changed += 1;
}

await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(events, null, 2)};\n`, "utf8");
console.log(`Normalized ${changed} show records.`);
