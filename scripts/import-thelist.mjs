import { readFile, writeFile } from "node:fs/promises";
import { classifyEventText, mergeClassifications } from "./event-classifier.mjs";

const SOURCE_URL = "https://jon.luini.com/thelist/date.html";
const OUTPUT_PATH = new URL("../data/imported-events.js", import.meta.url);
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
  return [key, valueParts.join("=") || "true"];
}));

const monthNames = new Map([
  ["jan", "01"], ["january", "01"],
  ["feb", "02"], ["february", "02"],
  ["mar", "03"], ["march", "03"],
  ["apr", "04"], ["april", "04"],
  ["may", "05"],
  ["jun", "06"], ["june", "06"],
  ["jul", "07"], ["july", "07"],
  ["aug", "08"], ["august", "08"],
  ["sep", "09"], ["september", "09"],
  ["oct", "10"], ["october", "10"],
  ["nov", "11"], ["november", "11"],
  ["dec", "12"], ["december", "12"]
]);

function clean(text) {
  return decodeHtml(text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(html) {
  return clean(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "));
}

function cellLines(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function extractMonth(rowHtml) {
  const match = rowHtml.match(/<th\b[^>]*>[\s\S]*?([a-z]+)\s+(\d{4})[\s\S]*?<\/th>/i);
  if (!match) return null;
  const month = monthNames.get(match[1].toLowerCase());
  return month ? { month, year: match[2] } : null;
}

function extractUpdatedDate(html) {
  const match = html.match(/<h3>\s*([a-z]{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return "";
  const month = monthNames.get(match[1].toLowerCase());
  if (!month) return "";
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function importFromDate(updatedDate) {
  if (args.has("all")) return "";
  const from = args.get("from");
  if (from === "updated") return updatedDate;
  if (from === "today" || !from) return todayString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return from;
  throw new Error(`Invalid --from value "${from}". Use today, updated, or YYYY-MM-DD.`);
}

function extractDate(cellHtml, currentMonth, currentYear) {
  if (!currentMonth || !currentYear) return null;
  const lines = cellLines(cellHtml);
  const day = lines.find((line) => /^\d{1,2}$/.test(line));
  if (!day) return null;
  return `${currentYear}-${currentMonth}-${day.padStart(2, "0")}`;
}

function extractVenue(cellHtml) {
  const anchor = cellHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (anchor) {
    return {
      venue: stripTags(anchor[2]),
      venueHref: new URL(anchor[1], SOURCE_URL).href
    };
  }

  return {
    venue: stripTags(cellHtml),
    venueHref: ""
  };
}

function extractArtistLinks(cellHtml) {
  const links = [];
  for (const match of cellHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(match[2]);
    const href = new URL(match[1], SOURCE_URL).href;
    if (label && !href.includes("club.html#")) {
      links.push({ label: "Website", url: href, artistName: label });
    }
  }
  return links;
}

function placeholderArtist(name, artistLinks = []) {
  const matchingLinks = artistLinks
    .filter((link) => link.artistName.toLowerCase() === name.toLowerCase())
    .map(({ label, url }) => ({ label, url }));

  return {
    name,
    tags: ["unknown"],
    locality: "unknown",
    confidence: matchingLinks.length ? "likely" : "review",
    note: "Imported from The List.",
    links: [
      ...matchingLinks,
      {
        label: "Search",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" band music`)}`,
        type: "search",
        confidence: "research",
        source: "the-list"
      }
    ]
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function venueIdFor(venueHref, venue) {
  const anchor = (venueHref || "").match(/club\.html#([^/?#]+)/i)?.[1];
  return anchor ? slugify(anchor) : slugify(venue || "unknown-venue");
}

function normalizeEventDateAndArtists(date, artistNames) {
  const firstArtist = artistNames[0] || "";
  const yearPrefix = firstArtist.match(/^(20\d{2})\s+(.+)$/);
  if (!yearPrefix) return { date, artistNames };

  return {
    date: `${yearPrefix[1]}-${date.slice(5)}`,
    artistNames: [yearPrefix[2], ...artistNames.slice(1)]
  };
}

function parseEvents(html) {
  const events = [];
  let currentMonth = "";
  let currentYear = "";
  let currentDate = "";

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const month = extractMonth(rowHtml);
    if (month) {
      currentMonth = month.month;
      currentYear = month.year;
      continue;
    }

    const cells = extractCells(rowHtml);
    if (cells.length < 3) continue;

    const dateFromCell = extractDate(cells[0], currentMonth, currentYear);
    if (dateFromCell) currentDate = dateFromCell;

    const artistCellIndex = dateFromCell ? 1 : 0;
    const venueCellIndex = artistCellIndex + 1;
    const detailCellIndex = artistCellIndex + 2;
    if (!currentDate || !cells[detailCellIndex]) continue;

    const artistNames = cellLines(cells[artistCellIndex]);
    if (!artistNames.length) continue;

    const normalized = normalizeEventDateAndArtists(currentDate, artistNames);
    const artistLinks = extractArtistLinks(cells[artistCellIndex]);
    const { venue, venueHref } = extractVenue(cells[venueCellIndex]);
    const details = stripTags(cells[detailCellIndex]);
    if (!venue || !details) continue;

    const listingClassifications = normalized.artistNames.map(classifyEventText);
    const performerNames = normalized.artistNames.filter((name, index) => !listingClassifications[index].isNonArtistListing);
    const eventMeta = mergeClassifications(classifyEventText(details), ...listingClassifications);
    const title = performerNames.length ? "" : normalized.artistNames.join(", ");

    events.push({
      id: slugify(`${normalized.date}-${venue}-${normalized.artistNames[0]}`),
      date: normalized.date,
      title,
      showType: performerNames.length ? "artist" : "event",
      venueId: venueIdFor(venueHref, venue),
      venue,
      venueHref,
      city: "",
      details,
      sourceUrl: SOURCE_URL,
      source: {
        name: "The List",
        url: SOURCE_URL
      },
      eventTypes: eventMeta.eventTypes,
      themes: eventMeta.themes,
      artists: performerNames.map((name) => placeholderArtist(name, artistLinks))
    });
  }

  return events;
}

const response = await fetch(SOURCE_URL, {
  headers: {
    "User-Agent": "BayAreaShowExplorer/0.1 (local prototype)"
  }
});

if (!response.ok) {
  throw new Error(`Could not fetch The List: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const updatedDate = extractUpdatedDate(html);
const fromDate = importFromDate(updatedDate);
const existing = await readWindowData(OUTPUT_PATH, "SHOW_EXPLORER_EVENTS", []);
const theListEvents = parseEvents(html).filter((event) => {
  return !fromDate || event.date >= fromDate;
});
const events = mergeEvents(existing, theListEvents).sort((a, b) => {
  return a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue);
});
const payload = `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(events, null, 2)};\n`;
await writeFile(OUTPUT_PATH, payload, "utf8");

const artists = theListEvents.flatMap((event) => event.artists);
const fromLabel = fromDate ? ` from ${fromDate}` : "";
console.log(`Merged ${theListEvents.length} The List events${fromLabel} and ${artists.length} artist slots into ${OUTPUT_PATH.pathname}`);

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

function mergeEvents(existing, incoming) {
  const byId = new Map(existing.map((event) => [event.id, normalizeEventSources(event)]));
  for (const event of incoming) {
    const duplicate = [...byId.values()].find((item) => eventKey(item) === eventKey(event));
    if (duplicate) {
      duplicate.sources = mergeSources(duplicate.sources, [event.source]);
      duplicate.source = duplicate.sources[0];
      duplicate.sourceUrl ||= event.sourceUrl;
      duplicate.venueHref ||= event.venueHref;
      duplicate.city ||= event.city;
      duplicate.eventTypes = mergeList(duplicate.eventTypes, event.eventTypes);
      duplicate.themes = mergeList(duplicate.themes, event.themes);
      duplicate.artists = mergeArtists(duplicate.artists || [], event.artists || []);
      if (duplicate.showType !== "event" && event.showType === "artist") duplicate.showType = "artist";
    } else {
      byId.set(event.id, normalizeEventSources(event));
    }
  }
  return [...byId.values()];
}

function normalizeEventSources(event) {
  return {
    ...event,
    sources: mergeSources(event.sources || [], [event.source || (event.sourceUrl ? { name: "Source", url: event.sourceUrl } : null)])
  };
}

function mergeSources(existing, incoming) {
  const sources = new Map();
  for (const source of [...existing, ...incoming].filter(Boolean)) {
    const name = sourceNameForUrl(source.url, source.name);
    sources.set(`${name}|${source.url}`, { ...source, name });
  }
  return [...sources.values()];
}

function mergeList(existing = [], incoming = []) {
  return [...new Set([...existing, ...incoming])];
}

function mergeArtists(existing, incoming) {
  const artists = new Map(existing.map((artist) => [slugify(artist.name), artist]));
  for (const artist of incoming) {
    if (!artists.has(slugify(artist.name))) artists.set(slugify(artist.name), artist);
  }
  return [...artists.values()];
}

function eventKey(event) {
  return `${event.date}|${slugify(event.venue)}|${slugify(event.details || eventTitle(event))}`;
}

function eventTitle(event) {
  return event.title || (event.artists || []).map((artist) => artist.name).join(", ") || event.details || "";
}

function sourceNames(event) {
  return [...new Set([...(event.sources || []), event.source].filter(Boolean).map((source) => sourceNameForUrl(source.url, source.name)).filter(Boolean))];
}

function sourceNameForUrl(url, fallback = "Source") {
  const normalized = String(url || "").toLowerCase();
  if (normalized.includes("jon.luini.com") || normalized.includes("thelist")) return "The List";
  if (normalized.includes("kalx.berkeley.edu")) return "KALX";
  return fallback && fallback !== "Source" ? fallback : "Source";
}
