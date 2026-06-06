import { readFile, writeFile } from "node:fs/promises";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const SOURCE_NAME = "BadSlava";
const STATE = "CA";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
  return [key, valueParts.join("=") || "true"];
}));

const CATEGORY_CONFIG = {
  trivia: {
    path: "trivia-nights.php",
    title: "Trivia Night",
    details: (time) => `Trivia night at ${time}`,
    eventTypes: ["trivia"]
  },
  openMic: {
    path: "open-mics.php",
    title: "Open Mic",
    details: (time) => `Open mic at ${time}`,
    eventTypes: ["openMic"]
  },
  poetry: {
    path: "open-mics.php",
    params: { type: "Poetry" },
    title: "Poetry Open Mic",
    details: (time) => `Poetry open mic at ${time}`,
    eventTypes: ["openMic", "poetry"]
  },
  book: {
    path: "book-clubs.php",
    title: "Book Event",
    details: (time) => `Book event at ${time}`,
    eventTypes: ["book"]
  },
  chess: {
    path: "chess-clubs.php",
    title: "Chess",
    details: (time) => `Chess event at ${time}`,
    eventTypes: ["chess"]
  },
  dance: {
    path: "dance-nights.php",
    title: "Dance",
    details: (time) => `Dance event at ${time}`,
    eventTypes: ["dance"]
  },
  game: {
    path: "game-nights.php",
    title: "Game Night",
    details: (time) => `Game night at ${time}`,
    eventTypes: ["game"]
  },
  karaoke: {
    path: "karaoke-nights.php",
    title: "Karaoke",
    details: (time) => `Karaoke at ${time}`,
    eventTypes: ["karaoke"]
  }
};

const DEFAULT_CATEGORIES = Object.keys(CATEGORY_CONFIG);
const BAY_AREA_CITIES = [
  "Alameda", "Albany", "Antioch", "Aptos", "Belmont", "Benicia", "Berkeley", "Big Sur",
  "Boulder Creek", "Brentwood", "Burlingame", "Calistoga", "Campbell", "Capitola", "Carmel",
  "Carmel-by-the-Sea", "Concord", "Corte Madera", "Cupertino", "Daly City", "Danville",
  "Dublin", "El Cerrito", "Emeryville", "Fairfax", "Fairfield", "Felton", "Fremont",
  "Gilroy", "Half Moon Bay", "Hayward", "Healdsburg", "Hercules", "Lafayette", "Livermore",
  "Los Altos", "Los Gatos", "Martinez", "Menlo Park", "Mill Valley", "Milpitas", "Monterey",
  "Morgan Hill", "Mountain View", "Napa", "Novato", "Oakland", "Pacifica", "Palo Alto",
  "Petaluma", "Pinole", "Pittsburg", "Pleasant Hill", "Pleasanton", "Redwood City",
  "Richmond", "Rohnert Park", "Salinas", "San Anselmo", "San Bruno",
  "San Carlos", "San Francisco", "San Jose", "San Leandro", "San Mateo", "San Rafael",
  "San Ramon", "Santa Clara", "Santa Cruz", "Saratoga", "Sausalito",
  "Scotts Valley", "Sebastopol", "Sonoma", "South San Francisco", "St Helena", "Stockton",
  "Sunnyvale", "Union City", "Vacaville", "Vallejo", "Walnut Creek", "Watsonville",
  "Woodside", "Yountville"
];

const state = args.get("state") || STATE;
const categories = categoryNames();
const allowedCities = cityNames();
const fromDate = importFromDate();
const toDate = importToDate();

const existing = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const badSlavaEvents = [];

for (const category of categories) {
  const config = CATEGORY_CONFIG[category];
  const sourceUrl = categoryUrl(config, state);
  try {
    const html = await fetchText(sourceUrl);
    badSlavaEvents.push(...parseCategoryPage(html, sourceUrl, category, config, allowedCities));
  } catch (error) {
    if (args.has("strict")) throw error;
    console.warn(`Skipped ${category} (${sourceUrl}): ${error.message}`);
  }
}

const incoming = badSlavaEvents.filter(dateInImportRange);
const merged = mergeEvents(existing, incoming)
  .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || eventTitle(a).localeCompare(eventTitle(b)));

await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(merged, null, 2)};\n`, "utf8");
console.log(`Merged ${incoming.length} BadSlava events from ${fromDate || "the beginning"} through ${toDate || "the future"} across ${categories.length} categories into ${EVENTS_PATH.pathname}`);

function parseCategoryPage(html, sourceUrl, category, config, allowedCities) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const events = [];
  let currentDate = "";

  for (const row of rows) {
    const dateMatch = row.match(/<th\b[^>]*colspan=['"]?2['"]?[^>]*>\s*([A-Za-z]+)\s+(\d{2})\/(\d{2})\/(\d{2})\s*<\/th>/i);
    if (dateMatch) {
      currentDate = `20${dateMatch[4]}-${dateMatch[2]}-${dateMatch[3]}`;
      continue;
    }

    if (!currentDate) continue;
    const listingMatch = row.match(/<td\b[^>]*>\s*([^<]+?)\s*<\/td>\s*<td\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<b>([\s\S]*?)<\/b>\s*<br\s*\/?>([\s\S]*?)<\/a>\s*<\/td>/i);
    if (!listingMatch) continue;

    const time = clean(listingMatch[1]);
    const detailUrl = new URL(listingMatch[2], sourceUrl).href;
    const venue = clean(listingMatch[3]);
    const address = clean(stripTags(listingMatch[4]));
    const city = cityFromAddress(address, allowedCities);
    if (!time || !venue || !city) continue;

    events.push({
      id: slugify(`${currentDate}-${venue}-${category}-${time}`),
      date: currentDate,
      title: config.title,
      showType: "event",
      venueId: slugify(venue),
      venue,
      venueHref: detailUrl,
      city,
      region: STATE,
      address,
      details: config.details(time),
      sourceUrl: detailUrl,
      source: {
        name: SOURCE_NAME,
        url: detailUrl
      },
      eventTypes: config.eventTypes,
      themes: [],
      artists: []
    });
  }

  return events;
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
      duplicate.address ||= event.address;
      duplicate.city ||= event.city;
      duplicate.region ||= event.region;
      duplicate.eventTypes = [...new Set([...(duplicate.eventTypes || []), ...(event.eventTypes || [])])];
      duplicate.themes = [...new Set([...(duplicate.themes || []), ...(event.themes || [])])];
      duplicate.artists = mergeArtists(duplicate.artists || [], event.artists || []);
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
  return `${event.date}|${slugify(event.venue)}|${slugify(event.title || event.details)}|${eventTime(event)}`;
}

function eventTitle(event) {
  return event.title || (event.artists || []).map((artist) => artist.name).join(", ") || event.details || "";
}

function eventTime(event) {
  return String(event.details || "").match(/\b\d{1,2}:\d{2}\s*(am|pm)\b/i)?.[0]?.toLowerCase() || "";
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`Could not fetch BadSlava page: ${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
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

function importToDate() {
  const to = args.get("to") || args.get("through");
  if (!to) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to;
  throw new Error(`Invalid --to value "${to}". Use YYYY-MM-DD.`);
}

function dateInImportRange(event) {
  if (fromDate && event.date < fromDate) return false;
  if (toDate && event.date > toDate) return false;
  return true;
}

function categoryNames() {
  const selected = (args.get("category") || args.get("categories") || DEFAULT_CATEGORIES.join(","))
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);
  const unknown = selected.filter((category) => !CATEGORY_CONFIG[category]);
  if (unknown.length) throw new Error(`Unknown BadSlava category: ${unknown.join(", ")}`);
  return selected;
}

function cityNames() {
  return (args.get("city") || args.get("cities") || BAY_AREA_CITIES.join(","))
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean);
}

function cityFromAddress(address, allowedCities) {
  const normalizedAddress = normalizeCityText(address);
  return allowedCities
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((city) => new RegExp(`\\b${escapeRegExp(normalizeCityText(city))}\\s+${STATE}\\b`, "i").test(normalizedAddress)) || "";
}

function categoryUrl(config, state) {
  const query = new URLSearchParams({ state, ...(config.params || {}) });
  return `http://badslava.com/${config.path}?${query}`;
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

function stripTags(html) {
  return String(html || "").replace(/<[^>]+>/g, " ");
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

function normalizeCityText(text) {
  return String(text || "").normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
