import { readFile, writeFile } from "node:fs/promises";

const VENUES_PATH = new URL("../data/venues.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const limit = Number(args.get("limit") || 25);
const onlyVenue = args.get("venue") || "";
const confidenceFilter = args.get("confidence") || "";

const ID_LINKS = {
  P856: { type: "official", label: "Official", url: (value) => value },
  P2003: { type: "instagram", label: "Instagram", url: (id) => `https://www.instagram.com/${id.replace(/^@/, "")}/` },
  P2013: { type: "facebook", label: "Facebook", url: (id) => `https://www.facebook.com/${id}` },
  P2002: { type: "twitter", label: "X/Twitter", url: (id) => `https://x.com/${id.replace(/^@/, "")}` }
};

const VENUE_TYPES = new Set([
  "Q24354", "Q24699794", "Q18674739", "Q57660343", "Q153562",
  "Q41253", "Q4830453", "Q34627", "Q641226", "Q742421"
]);

const REGION_NAMES = new Set([
  "San Francisco", "Oakland", "Berkeley", "San Jose", "Santa Cruz", "Petaluma",
  "Mill Valley", "Saratoga", "Menlo Park", "Palo Alto", "Mountain View",
  "San Rafael", "Walnut Creek", "Concord", "Fremont", "California"
]);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(name) {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
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

function addEvidence(venue, url, note) {
  venue.evidence ||= [];
  if (venue.evidence.some((item) => item.url === url && item.note === note)) return;
  venue.evidence.push({ url, note });
}

async function fetchJson(url, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    if (response.status === 429 && attempt < 4) {
      await sleep(attempt * 2500);
      return fetchJson(url, attempt + 1);
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchEntity(name) {
  const query = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "en",
    format: "json",
    limit: "8"
  });
  const result = await fetchJson(`https://www.wikidata.org/w/api.php?${query}`);
  return (result.search || []).filter((item) => normalizeName(item.label || "") === normalizeName(name));
}

async function searchVenueCandidates(name) {
  const names = new Set([name]);
  if (!/^the\s+/i.test(name)) names.add(`The ${name}`);
  names.add(name.replace(/^the\s+/i, ""));

  const results = [];
  for (const candidateName of names) {
    results.push(...await searchEntity(candidateName));
  }
  const seen = new Set();
  return results.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function getEntity(id) {
  const query = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    props: "claims|sitelinks|descriptions|labels",
    languages: "en",
    format: "json"
  });
  const result = await fetchJson(`https://www.wikidata.org/w/api.php?${query}`);
  return result.entities?.[id];
}

function claimValues(entity, property) {
  return (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .map((value) => {
      if (typeof value === "string") return value;
      if (value?.id) return value.id;
      if (typeof value?.latitude === "number" && typeof value?.longitude === "number") {
        return { latitude: value.latitude, longitude: value.longitude };
      }
      if (value?.amount) return value.amount.replace(/^\+/, "");
      return "";
    })
    .filter(Boolean);
}

function isVenueEntity(entity) {
  const instanceOf = new Set(claimValues(entity, "P31").filter((value) => typeof value === "string"));
  const description = entity.descriptions?.en?.value || "";
  if ([...instanceOf].some((id) => VENUE_TYPES.has(id))) return true;
  return /\b(venue|theatre|theater|music hall|nightclub|arena|auditorium|performing arts|concert hall)\b/i.test(description);
}

async function hasBayAreaSignal(entity) {
  const directLabels = [
    ...claimValues(entity, "P131"),
    ...claimValues(entity, "P276"),
    ...claimValues(entity, "P159")
  ].filter((value) => typeof value === "string");

  for (const id of directLabels.slice(0, 8)) {
    const related = await getEntity(id);
    const label = related?.labels?.en?.value || "";
    if (REGION_NAMES.has(label)) return true;
  }

  return false;
}

function wikidataLinks(entity, id) {
  const links = [{
    type: "wikidata",
    label: "Wikidata",
    url: `https://www.wikidata.org/wiki/${id}`,
    confidence: "likely",
    source: "wikidata"
  }];

  for (const [property, config] of Object.entries(ID_LINKS)) {
    for (const value of claimValues(entity, property)) {
      links.push({
        type: config.type,
        label: config.label,
        url: config.url(value),
        confidence: "likely",
        source: "wikidata"
      });
    }
  }

  const title = entity.sitelinks?.enwiki?.title;
  if (title) {
    links.push({
      type: "wikipedia",
      label: "Wikipedia",
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
      confidence: "likely",
      source: "wikidata"
    });
  }

  return links;
}

function hasRejectedWikidataId(venue, id) {
  return (venue.links || []).some((link) => {
    if (link.confidence !== "rejected") return false;
    return (link.url || "").match(/wikidata\.org\/wiki\/(Q\d+)/i)?.[1] === id;
  });
}

function firstClaim(entity, property) {
  return claimValues(entity, property)[0] || "";
}

async function localityFromEntity(entity) {
  const placeId = firstClaim(entity, "P131") || firstClaim(entity, "P276");
  if (!placeId || typeof placeId !== "string") return "";
  const place = await getEntity(placeId);
  return place?.labels?.en?.value || "";
}

function capacityFromEntity(entity) {
  return firstClaim(entity, "P1083") || "";
}

function geoFromEntity(entity) {
  const value = firstClaim(entity, "P625");
  return value?.latitude && value?.longitude ? {
    latitude: value.latitude,
    longitude: value.longitude
  } : null;
}

function usefulWikidataSummary(summary = "") {
  const clean = summary.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 20) return false;
  if (clean.length > 90) return true;
  return !/^(architectural structure|building|venue|arena|sports venue|entertainment venue|music venue|theater|cinema)\b/i.test(clean);
}

const store = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
const candidates = Object.values(store.venues || {})
  .filter((venue) => !onlyVenue || normalizeName(venue.name) === normalizeName(onlyVenue))
  .filter((venue) => !confidenceFilter || venue.confidence === confidenceFilter)
  .filter((venue) => onlyVenue || !venue.links?.some((link) => link.type === "wikidata" && link.confidence !== "rejected"))
  .slice(0, limit);

let enriched = 0;

for (const venue of candidates) {
  try {
    const matches = await searchVenueCandidates(venue.displayName || venue.name);
    for (const match of matches) {
      if (hasRejectedWikidataId(venue, match.id)) continue;
      const entity = await getEntity(match.id);
      if (!entity || !isVenueEntity(entity)) continue;
      if (!(await hasBayAreaSignal(entity))) continue;

      const url = `https://www.wikidata.org/wiki/${match.id}`;
      venue.links = mergeLinks(venue.links, wikidataLinks(entity, match.id));
      const wikidataSummary = entity.descriptions?.en?.value || "";
      if (!venue.summary && usefulWikidataSummary(wikidataSummary)) {
        venue.summary = wikidataSummary;
        venue.summarySource = {
          label: "Wikidata",
          url,
          source: "wikidata"
        };
      }
      venue.city ||= await localityFromEntity(entity);
      venue.capacity ||= capacityFromEntity(entity);
      venue.geo ||= geoFromEntity(entity);
      venue.confidence = venue.confidence === "review" ? "likely" : venue.confidence;
      addEvidence(venue, url, `Wikidata exact-name venue match ${match.id} passed Bay Area location checks.`);
      enriched += 1;
      break;
    }
  } catch (error) {
    console.warn(`Skipped ${venue.name}: ${error.message}`);
  }
  await sleep(900);
}

store.generatedAt = new Date().toISOString();
await writeFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(store, null, 2)};\n`, "utf8");

console.log(`Wikidata enriched ${enriched} of ${candidates.length} checked venues.`);
