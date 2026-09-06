import { readFile } from "node:fs/promises";
import { writeTextFile } from "./file-io.mjs";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const VENUES_PATH = new URL("../data/venues.js", import.meta.url);

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
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function venueIdFor(event) {
  const anchor = (event.venueHref || "").match(/club\.html#([^/?#]+)/i)?.[1];
  return anchor ? slugify(anchor) : slugify(event.venue || "unknown-venue");
}

function eventSummary(event) {
  return {
    eventId: event.id,
    date: event.date,
    title: event.title || (event.artists || []).map((artist) => artist.name).join(" / "),
    details: event.details,
    sourceUrl: event.sourceUrl
  };
}

function importedLinks(event) {
  const links = [];
  if (event.venueHref) {
    const sourceName = sourceNameForEvent(event);
    links.push({
      type: sourceName === "KALX" ? "kalx" : "theList",
      label: sourceName,
      url: event.venueHref,
      confidence: "verified",
      source: sourceName.toLowerCase()
    });
  }
  links.push({
    type: "search",
    label: "Search",
    url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${event.venue}" venue Bay Area music`)}`,
    confidence: "research",
    source: "imported"
  });
  return links;
}

function sourceNameForEvent(event) {
  return event.source?.name || event.sources?.[0]?.name || "The List";
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function normalizedUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^www\./i, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function mergeLinks(existingLinks = [], incomingLinks = []) {
  const rejectedUrls = new Set(existingLinks
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizedUrl(link.url || "")));
  const links = new Map();
  for (const link of [...existingLinks, ...incomingLinks]) {
    if (!link?.url) continue;
    const key = normalizedUrl(link.url);
    if (rejectedUrls.has(key) && link.confidence !== "rejected") continue;
    const previous = links.get(key);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) {
      links.set(key, link);
    }
  }
  return [...links.values()];
}

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const existing = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", {
  generatedAt: "",
  venues: {}
});

const venues = {};

for (const event of events) {
  const id = venueIdFor(event);
  const previous = existing.venues?.[id] || {};
  const current = venues[id] || {
    id,
    name: previous.name || event.venue,
    displayName: previous.displayName || previous.name || event.venue,
    aliases: previous.aliases || [],
    confidence: previous.confidence || "review",
    mergedInto: previous.mergedInto || "",
    status: previous.status || "unknown",
    venueType: previous.venueType || "unknown",
    city: previous.city || event.city || "",
    region: previous.region || "",
    address: previous.address || event.address || "",
    imageUrl: previous.imageUrl || "",
    imageSource: previous.imageSource || "",
    phone: previous.phone || "",
    recurringEvents: previous.recurringEvents || [],
    geo: previous.geo || null,
    agePolicy: previous.agePolicy || "unknown",
    capacity: previous.capacity || "",
    summary: previous.summary || "",
    accessibilityNotes: previous.accessibilityNotes || "",
    reviewNotes: previous.reviewNotes || "",
    links: previous.links || [],
    evidence: previous.evidence || [],
    source: {
      firstSeenAt: previous.source?.firstSeenAt || new Date().toISOString(),
      lastImportedAt: "",
      appearances: []
    }
  };

  current.links = mergeLinks(current.links, importedLinks(event));
  current.source.lastImportedAt = new Date().toISOString();
  current.source.appearances.push(eventSummary(event));
  venues[id] = current;
}

const payload = {
  generatedAt: new Date().toISOString(),
  venues: Object.fromEntries(Object.entries({
    ...(existing.venues || {}),
    ...venues
  }).sort(([a], [b]) => a.localeCompare(b)))
};

await writeTextFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(payload, null, 2)};\n`, "utf8");

console.log(`Built ${Object.keys(payload.venues).length} venue records at ${VENUES_PATH.pathname}`);
