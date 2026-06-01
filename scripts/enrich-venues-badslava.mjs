import { readFile, writeFile } from "node:fs/promises";

const VENUES_PATH = new URL("../data/venues.js", import.meta.url);
const SOURCE_NAME = "BadSlava";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const limit = Number(args.get("limit") || 25);
const onlyVenue = args.get("venue") || "";
const onlyUrl = args.get("url") || "";
const dryRun = args.has("dry-run");

const BAY_AREA_REGIONS = new Map([
  ["Alameda", "East Bay"],
  ["Albany", "East Bay"],
  ["Berkeley", "East Bay"],
  ["Concord", "East Bay"],
  ["El Cerrito", "East Bay"],
  ["Fremont", "East Bay"],
  ["Hayward", "East Bay"],
  ["Livermore", "East Bay"],
  ["Oakland", "East Bay"],
  ["Pleasanton", "East Bay"],
  ["Richmond", "East Bay"],
  ["San Leandro", "East Bay"],
  ["Walnut Creek", "East Bay"],
  ["San Francisco", "SF"],
  ["Daly City", "Peninsula"],
  ["Menlo Park", "Peninsula"],
  ["Pacifica", "Peninsula"],
  ["Palo Alto", "Peninsula"],
  ["Redwood City", "Peninsula"],
  ["San Bruno", "Peninsula"],
  ["San Mateo", "Peninsula"],
  ["Mountain View", "South Bay"],
  ["San Jose", "South Bay"],
  ["Santa Clara", "South Bay"],
  ["Saratoga", "South Bay"],
  ["Mill Valley", "North Bay"],
  ["Napa", "North Bay"],
  ["Petaluma", "North Bay"],
  ["San Rafael", "North Bay"],
  ["Santa Rosa", "North Bay"],
  ["Sonoma", "North Bay"],
  ["Big Sur", "Santa Cruz/Monterey"],
  ["Carmel", "Santa Cruz/Monterey"],
  ["Monterey", "Santa Cruz/Monterey"],
  ["Santa Cruz", "Santa Cruz/Monterey"]
]);

const store = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
const candidates = candidateVenues(store.venues || {});

let checked = 0;
let enriched = 0;
let changed = 0;

for (const { venue, url } of candidates.slice(0, limit)) {
  checked += 1;
  try {
    const detail = parseBadSlavaDetail(await fetchText(url), url);
    if (!isSameVenue(venue, detail)) {
      console.warn(`Skipped ${venue.name}: BadSlava detail appears to be for ${detail.name || "another venue"}.`);
      continue;
    }
    const updates = applyDetail(venue, detail);
    if (updates) {
      enriched += 1;
      changed += updates;
      console.log(`Enriched ${venue.displayName || venue.name} from BadSlava.`);
    }
  } catch (error) {
    console.warn(`Skipped ${venue.name}: ${error.message}`);
  }
}

if (!dryRun) {
  store.generatedAt = new Date().toISOString();
  await writeFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(store, null, 2)};\n`, "utf8");
}

console.log(JSON.stringify({ checked, enriched, changed, dryRun }, null, 2));

function candidateVenues(venues) {
  const all = Object.values(venues)
    .filter((venue) => !onlyVenue || normalizeName(venue.name) === normalizeName(onlyVenue) || normalizeName(venue.displayName || "") === normalizeName(onlyVenue));

  if (onlyUrl) {
    const target = all.find((venue) => isSameVenueName(venue.name, nameHintFromUrl(onlyUrl)) || isSameVenueName(venue.displayName, nameHintFromUrl(onlyUrl))) || all[0];
    if (!target) throw new Error("--url needs --venue when no matching venue can be inferred.");
    return [{ venue: target, url: onlyUrl }];
  }

  return all.flatMap((venue) => {
    return (venue.links || [])
      .filter((link) => /badslava\.com\/details\.php\?id=/i.test(link.url || ""))
      .map((link) => ({ venue, url: link.url }));
  });
}

function parseBadSlavaDetail(html, sourceUrl) {
  const fields = {};
  for (const row of html.matchAll(/<tr><td><b>([^<:]+):\s*<\/b><br>([\s\S]*?)<\/td><\/tr>/gi)) {
    fields[clean(row[1])] = row[2];
  }

  const name = clean(stripTags(fields["Venue Name"] || ""));
  const address = clean(stripTags(fields["Venue Address"] || ""));
  const website = firstHref(fields["Venue Website"] || "");
  const maps = firstHref(fields["Google Maps"] || fields["Venue Address"] || "");
  const phone = clean(stripTags(fields["Venue Phone"] || ""));
  const eventType = clean(stripTags(fields["Event Type"] || ""));
  const eventDay = clean(stripTags(fields["Event Day"] || ""));
  const eventTime = clean(stripTags(fields["Event Time"] || ""));
  const eventFrequency = clean(stripTags(fields["Event Frequency"] || ""));
  const eventCost = clean(stripTags(fields["Event Cost"] || ""));

  return {
    sourceUrl,
    name,
    address,
    website,
    maps,
    phone,
    eventType,
    eventDay,
    eventTime,
    eventFrequency,
    eventCost,
    city: cityFromAddress(address),
    region: regionFromAddress(address)
  };
}

function applyDetail(venue, detail) {
  let updates = 0;

  if (detail.name && shouldSetDisplayName(venue, detail.name)) {
    venue.displayName = detail.name;
    addEvidence(venue, detail.sourceUrl, "Display name derived from BadSlava venue detail page.");
    updates += 1;
  }

  if ((!venue.address || !isUsableAddress(venue.address)) && detail.address) {
    venue.address = detail.address;
    addEvidence(venue, detail.sourceUrl, "Address derived from BadSlava venue detail page.");
    updates += 1;
  }

  if (!venue.city && detail.city) {
    venue.city = detail.city;
    addEvidence(venue, detail.sourceUrl, "City derived from BadSlava venue address.");
    updates += 1;
  }

  if (!venue.region && detail.region) {
    venue.region = detail.region;
    addEvidence(venue, detail.sourceUrl, "Region inferred from BadSlava venue city.");
    updates += 1;
  }

  if (!venue.phone && detail.phone) {
    venue.phone = detail.phone;
    addEvidence(venue, detail.sourceUrl, "Phone number derived from BadSlava venue detail page.");
    updates += 1;
  }

  const recurringEvent = recurringEventFromDetail(detail);
  if (recurringEvent && addRecurringEvent(venue, recurringEvent)) {
    addEvidence(venue, detail.sourceUrl, "Recurring event details derived from BadSlava venue detail page.");
    updates += 1;
  }

  const beforeLinks = venue.links?.length || 0;
  venue.links = mergeLinks(venue.links || [], linksFromDetail(detail));
  updates += Math.max(0, venue.links.length - beforeLinks);

  const recurringNote = recurringNoteFromDetail(detail);
  if (recurringNote) {
    addEvidence(venue, detail.sourceUrl, recurringNote);
  }

  return updates;
}

function linksFromDetail(detail) {
  return [
    {
      type: "badSlava",
      label: SOURCE_NAME,
      url: detail.sourceUrl,
      confidence: "verified",
      source: "badslava"
    },
    detail.website ? {
      type: "official",
      label: "Official",
      url: detail.website,
      confidence: "candidate",
      source: "badslava"
    } : null,
    detail.maps ? {
      type: "maps",
      label: "Maps",
      url: detail.maps,
      confidence: "candidate",
      source: "badslava"
    } : null
  ].filter(Boolean);
}

function recurringNoteFromDetail(detail) {
  const parts = [
    detail.eventFrequency,
    detail.eventDay,
    detail.eventTime,
    detail.eventType,
    detail.eventCost
  ].filter(Boolean);
  return parts.length ? `BadSlava recurring listing: ${parts.join(" | ")}.` : "";
}

function recurringEventFromDetail(detail) {
  if (!detail.eventType && !detail.eventDay && !detail.eventTime) return null;
  return {
    type: detail.eventType,
    day: detail.eventDay,
    time: detail.eventTime,
    frequency: detail.eventFrequency,
    cost: detail.eventCost,
    source: "badslava",
    sourceUrl: detail.sourceUrl
  };
}

function addRecurringEvent(venue, event) {
  venue.recurringEvents ||= [];
  const key = recurringEventKey(event);
  if (venue.recurringEvents.some((item) => recurringEventKey(item) === key)) return false;
  venue.recurringEvents.push(event);
  return true;
}

function recurringEventKey(event) {
  return [
    event.type,
    event.day,
    event.time,
    event.frequency,
    event.sourceUrl
  ].map((part) => String(part || "").toLowerCase().trim()).join("|");
}

async function fetchText(url) {
  const response = await fetch(url.replace(/^https:\/\//i, "http://"), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) throw new Error(`Could not fetch BadSlava detail: ${response.status} ${response.statusText}`);
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

function mergeLinks(existingLinks = [], incomingLinks = []) {
  const links = new Map();
  for (const link of [...existingLinks, ...incomingLinks]) {
    if (!link?.url) continue;
    const key = normalizedUrl(link.url);
    const previous = links.get(key);
    if (previous?.confidence === "rejected") continue;
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) {
      links.set(key, link);
    }
  }
  return [...links.values()];
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function normalizedUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = parsed.hostname.includes("badslava.com") ? parsed.search : "";
    parsed.hostname = parsed.hostname.replace(/^www\./i, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function shouldSetDisplayName(venue, displayName) {
  if (!displayName) return false;
  const current = venue.displayName || venue.name || "";
  if (!current) return true;
  if (normalizeName(current) === normalizeName(displayName)) return false;
  return displayName.length > current.length && normalizeName(displayName).includes(normalizeName(current));
}

function isSameVenue(venue, detail) {
  if (!detail.name) return true;
  return isSameVenueName(venue.name, detail.name) || isSameVenueName(venue.displayName, detail.name);
}

function isSameVenueName(a = "", b = "") {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function normalizeName(name = "") {
  return String(name).toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function nameHintFromUrl() {
  return "";
}

function addEvidence(venue, url, note) {
  venue.evidence ||= [];
  if (venue.evidence.some((item) => item.url === url && item.note === note)) return;
  venue.evidence.push({ url, note });
}

function cityFromAddress(address = "") {
  return [...BAY_AREA_REGIONS.keys()]
    .sort((a, b) => b.length - a.length)
    .find((city) => new RegExp(`\\b${escapeRegExp(city)}\\s+CA\\b`, "i").test(address)) || "";
}

function regionFromAddress(address = "") {
  const city = cityFromAddress(address);
  return BAY_AREA_REGIONS.get(city) || "";
}

function isUsableAddress(address = "") {
  return /^\s*\d{1,6}\s+.{2,90}\b(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Way)\b/i.test(address);
}

function firstHref(html = "") {
  return html.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "";
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

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
