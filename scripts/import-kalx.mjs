import { readFile, writeFile } from "node:fs/promises";
import { classifyEventText, mergeClassifications } from "./event-classifier.mjs";

const CALENDAR_URL = "https://www.kalx.berkeley.edu/events/weekly-entertainment-calendar/";
const KALX_BASE_URL = "https://www.kalx.berkeley.edu/";
const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
  return [key, valueParts.join("=") || "true"];
}));

const weeks = Number(args.get("kalx-weeks") || args.get("weeks") || 2);
const fromDate = importFromDate();
const listUrlsOnly = args.has("list-urls");

const monthNames = new Map([
  ["january", "01"], ["february", "02"], ["march", "03"], ["april", "04"],
  ["may", "05"], ["june", "06"], ["july", "07"], ["august", "08"],
  ["september", "09"], ["october", "10"], ["november", "11"], ["december", "12"]
]);

const existing = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
if (listUrlsOnly) {
  const urls = await kalxImportUrls();
  console.log(JSON.stringify({ fromDate, weeks, urls }, null, 2));
  process.exit(0);
}
const kalxEvents = await importKalxEvents();
const merged = mergeEvents(existing, kalxEvents)
  .filter((event) => !fromDate || event.date >= fromDate)
  .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || eventTitle(a).localeCompare(eventTitle(b)));

await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(merged, null, 2)};\n`, "utf8");
console.log(`Merged ${kalxEvents.length} KALX events into ${EVENTS_PATH.pathname}`);

async function importKalxEvents() {
  const weekLinks = await kalxImportUrls();
  const events = [];
  for (const urls of groupWeekLinks(weekLinks)) {
    for (const [index, url] of urls.entries()) {
      const html = await fetchText(url, { allowMissing: true, quietMissing: index < urls.length - 1 });
      if (!html) continue;
      events.push(...parseWeek(html, url));
      break;
    }
  }
  return events;
}

async function kalxImportUrls() {
  const generatedLinks = kalxWeekUrls(fromDate || todayString(), weeks);
  let indexHtml = "";
  try {
    indexHtml = await fetchText(CALENDAR_URL);
  } catch (error) {
    console.warn(`Could not fetch KALX calendar index: ${error.message}`);
  }
  const discoveredLinks = discoverKalxWeekLinks(indexHtml);
  const weekLinks = limitWeekLinks(uniqueUrls([...generatedLinks, ...discoveredLinks])
    .filter((url) => !fromDate || weekOverlapsImportRange(url, fromDate))
    .sort((a, b) => (weekStartFromKalxUrl(a) || a).localeCompare(weekStartFromKalxUrl(b) || b)), weeks);

  return weekLinks;
}

function discoverKalxWeekLinks(html) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/event\/events-[a-z]+-\d{1,2}(?:-[a-z]+-?\d{1,2}|-\d{1,2})-20\d{2}\/?)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], CALENDAR_URL).href);
}

function kalxWeekUrls(startDate, count) {
  const start = mondayFor(startDate);
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    const weekEnd = addDays(weekStart, 6);
    return kalxWeekSlugCandidates(weekStart, weekEnd)
      .map((slug) => new URL(`event/${slug}/`, KALX_BASE_URL).href);
  }).flat();
}

function kalxWeekSlugCandidates(start, end) {
  const primary = kalxWeekSlug(start, end);
  const startMonth = monthSlug(start);
  const endMonth = monthSlug(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  if (startMonth === endMonth && start.getUTCFullYear() === year) return [primary];
  return uniqueUrls([
    primary,
    `events-${startMonth}-${startDay}-${endMonth}${endDay}-${year}`
  ]);
}

function kalxWeekSlug(start, end) {
  const startMonth = monthSlug(start);
  const endMonth = monthSlug(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  if (startMonth === endMonth && start.getUTCFullYear() === year) {
    return `events-${startMonth}-${startDay}-${endDay}-${year}`;
  }
  return `events-${startMonth}-${startDay}-${endMonth}-${endDay}-${year}`;
}

function weekStartFromKalxUrl(url) {
  const match = url.match(/\/event\/events-([a-z]+)-(\d{1,2})(?:-([a-z]+)-?(\d{1,2})|-(\d{1,2}))-(20\d{2})\/?$/i);
  if (!match) return "";
  const month = monthNames.get(match[1].toLowerCase());
  return month ? `${match[6]}-${month}-${match[2].padStart(2, "0")}` : "";
}

function weekOverlapsImportRange(url, from) {
  const range = weekRangeFromKalxUrl(url);
  if (!range) return true;
  return range.end >= from;
}

function weekRangeFromKalxUrl(url) {
  const match = url.match(/\/event\/events-([a-z]+)-(\d{1,2})(?:-([a-z]+)-?(\d{1,2})|-(\d{1,2}))-(20\d{2})\/?$/i);
  if (!match) return null;
  const startMonth = monthNames.get(match[1].toLowerCase());
  const endMonth = monthNames.get((match[3] || match[1]).toLowerCase());
  if (!startMonth || !endMonth) return null;
  const year = match[6];
  const start = `${year}-${startMonth}-${match[2].padStart(2, "0")}`;
  const endDay = match[4] || match[5];
  const end = `${year}-${endMonth}-${endDay.padStart(2, "0")}`;
  return { start, end };
}

function mondayFor(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthSlug(date) {
  return [...monthNames.entries()].find(([, number]) => Number(number) === date.getUTCMonth() + 1)?.[0] || "";
}

function uniqueUrls(urls) {
  return [...new Set(urls)];
}

function limitWeekLinks(urls, count) {
  const weekStarts = new Set();
  return urls.filter((url) => {
    const key = weekStartFromKalxUrl(url) || url;
    if (!weekStarts.has(key) && weekStarts.size >= count) return false;
    weekStarts.add(key);
    return true;
  });
}

function groupWeekLinks(urls) {
  const groups = new Map();
  for (const url of urls) {
    const key = weekStartFromKalxUrl(url) || url;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(url);
  }
  return [...groups.values()];
}

function parseWeek(html, sourceUrl) {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/h2>|<\/h3>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map(clean)
    .filter(Boolean);

  const events = [];
  let currentDate = "";
  let currentRegion = "";

  for (const line of lines) {
    const date = parseKalxDate(line);
    if (date) {
      currentDate = date;
      currentRegion = "";
      continue;
    }
    if (/^(East Bay|San Francisco|North Bay|South Bay|Peninsula)$/i.test(line)) {
      currentRegion = line;
      continue;
    }
    if (!currentDate || !line.includes(":")) continue;

    const [venuePart, ...listingParts] = line.split(":");
    const venue = clean(venuePart);
    const listing = clean(listingParts.join(":"));
    if (!venue || !listing || /^(posted on|copyright|search)$/i.test(venue)) continue;

    events.push(eventFromKalxListing(currentDate, currentRegion, venue, listing, sourceUrl));
  }

  return events;
}

function eventFromKalxListing(date, region, venue, listing, sourceUrl) {
  const rawNames = splitArtistNames(listing);
  const listingClassification = classifyEventText(listing);
  const artistNames = rawNames.filter((name) => !classifyEventText(name).isNonArtistListing);
  const eventMeta = mergeClassifications(listingClassification, ...rawNames.map(classifyEventText));
  const title = artistNames.length ? "" : listing;

  return {
    id: slugify(`${date}-${venue}-${listing}`),
    date,
    title,
    showType: artistNames.length ? "artist" : "event",
    venueId: slugify(venue),
    venue,
    venueHref: "",
    city: "",
    region,
    details: listing,
    sourceUrl,
    source: {
      name: "KALX",
      url: sourceUrl
    },
    eventTypes: eventMeta.eventTypes,
    themes: eventMeta.themes,
    artists: artistNames.map((name) => placeholderArtist(name))
  };
}

function splitArtistNames(listing) {
  return listing
    .split(/\s*,\s*|\s+\bw\/\s+/i)
    .map((name) => clean(name.replace(/^DJs?\s+/i, "")))
    .filter(Boolean);
}

function placeholderArtist(name) {
  return {
    name,
    tags: ["unknown"],
    locality: "unknown",
    confidence: "review",
    note: "Imported from KALX.",
    links: [{
      label: "Search",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" band music`)}`,
      type: "search",
      confidence: "research",
      source: "kalx"
    }]
  };
}

function mergeEvents(existing, incoming) {
  const byId = new Map(existing.map((event) => [event.id, normalizeEventSources(event)]));
  for (const event of incoming) {
    const duplicate = [...byId.values()].find((item) => eventKey(item) === eventKey(event));
    if (duplicate) {
      duplicate.sources = mergeSources(duplicate.sources, [event.source]);
      duplicate.source = duplicate.sources[0];
      duplicate.sourceUrl ||= event.sourceUrl;
      duplicate.eventTypes = isKalxOnly(duplicate) ? event.eventTypes : [...new Set([...(duplicate.eventTypes || []), ...(event.eventTypes || [])])];
      duplicate.themes = isKalxOnly(duplicate) ? event.themes : [...new Set([...(duplicate.themes || []), ...(event.themes || [])])];
      duplicate.artists = isKalxOnly(duplicate) ? event.artists : mergeArtists(duplicate.artists || [], event.artists || []);
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
    sources.set(`${source.name}|${source.url}`, source);
  }
  return [...sources.values()];
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

function isKalxOnly(event) {
  const sources = event.sources || [event.source].filter(Boolean);
  return sources.length === 1 && sources[0]?.name === "KALX";
}

function parseKalxDate(line) {
  const match = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})$/i);
  if (!match) return "";
  const month = monthNames.get(match[2].toLowerCase());
  return month ? `${match[4]}-${month}-${match[3].padStart(2, "0")}` : "";
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "BayAreaShowExplorer/0.1 (local non-commercial prototype)" }
  });
  if (options.allowMissing && response.status === 404) {
    if (options.quietMissing) return "";
    console.warn(`Skipping unpublished KALX page: ${url}`);
    return "";
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
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

function importFromDate() {
  if (args.has("all")) return "";
  const from = args.get("from");
  if (from === "today" || !from || from === "updated") return todayString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return from;
  throw new Error(`Invalid --from value "${from}". Use today or YYYY-MM-DD.`);
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clean(text) {
  return decodeHtml(text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&#8217;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;|&#8211;/gi, "-");
}
