import { readFile, writeFile } from "node:fs/promises";

const VENUES_PATH = new URL("../data/venues.js", import.meta.url);
const ENV_PATH = new URL("../.env", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const limit = Number(args.get("limit") || 10);
const onlyVenue = args.get("venue") || "";
const confidenceFilter = args.get("confidence") || "";

const BAY_AREA_CITIES = new Set([
  "San Francisco", "Oakland", "Berkeley", "San Jose", "Santa Cruz", "Saratoga",
  "Mill Valley", "Petaluma", "San Rafael", "Palo Alto", "Menlo Park",
  "Mountain View", "Walnut Creek", "Concord", "Fremont", "Alameda",
  "Richmond", "San Mateo", "Redwood City", "Daly City", "Santa Clara", "Pacifica",
  "Pleasanton", "Livermore", "Hayward", "El Cerrito"
]);

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  "places.types"
].join(",");

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

async function readEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    return Object.fromEntries(text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key.trim(), rest.join("=").trim().replace(/^["']|["']$/g, "")];
      }));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function normalizeName(name = "") {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeUrl(url = "") {
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

function hostFor(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function mergeLinks(existingLinks = [], incomingLinks = []) {
  const rejectedUrls = new Set(existingLinks
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizeUrl(link.url || "")));
  const links = new Map();
  for (const link of [...existingLinks, ...incomingLinks]) {
    if (!link?.url) continue;
    if (isLowerConfidenceDuplicateOfficialHomepage(link, [...links.values()])) continue;
    const key = linkKey(link);
    if (rejectedUrls.has(key) && link.confidence !== "rejected") continue;
    const previous = links.get(key);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) {
      links.set(key, link);
    }
  }
  return [...links.values()];
}

function linkKey(link) {
  if (link.type === "maps") return "maps";
  return normalizeUrl(link.url || "");
}

function isLowerConfidenceDuplicateOfficialHomepage(link, existingLinks) {
  if (link.type !== "official") return false;
  const homeKey = officialDomainKey(link.url || "");
  if (!homeKey || !isHomepage(link.url || "")) return false;
  return existingLinks.some((existing) => {
    return existing.type === "official" &&
      officialDomainKey(existing.url || "") === homeKey &&
      isHomepage(existing.url || "") &&
      confidenceRank(existing.confidence) >= confidenceRank(link.confidence);
  });
}

function officialDomainKey(url = "") {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

function isHomepage(url = "") {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return !path || path === "/";
  } catch {
    return false;
  }
}

function addEvidence(venue, url, note) {
  venue.evidence ||= [];
  if (venue.evidence.some((item) => item.url === url && item.note === note)) return;
  venue.evidence.push({ url, note });
}

function verifiedOfficialHosts(venue) {
  return new Set((venue.links || [])
    .filter((link) => link.confidence === "verified" && link.type === "official")
    .map((link) => hostFor(link.url))
    .filter(Boolean));
}

function rejectedOfficialHosts(venue) {
  return new Set((venue.links || [])
    .filter((link) => link.confidence === "rejected" && link.type === "official")
    .map((link) => hostFor(link.url))
    .filter(Boolean));
}

function rejectedPlaceSignals(venue) {
  const rejectedUrls = new Set((venue.links || [])
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizeUrl(link.url || "")));
  return rejectedUrls;
}

async function searchPlaces(apiKey, venue) {
  const queries = googlePlaceQueries(venue);
  const places = [];
  const seen = new Set();

  for (const query of queries) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 5,
        languageCode: "en",
        regionCode: "US"
      })
    });

    if (!response.ok) {
      throw new Error(`Google Places failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    for (const place of result.places || []) {
      const key = place.id || place.googleMapsUri || `${place.displayName?.text}|${place.formattedAddress}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(place);
    }
  }

  return { places };
}

function googlePlaceQueries(venue) {
  const name = venue.displayName || venue.name;
  const city = venue.city || cityFromVenueText(venue) || "San Francisco";
  const queries = [];
  if (streetNumberFromVenue(venue)) {
    queries.push(`${name} ${city} CA`);
  }
  queries.push([
    name,
    venue.city || venue.region || "San Francisco Bay Area",
    venue.venueType && venue.venueType !== "unknown" ? venue.venueType : "venue"
  ].filter(Boolean).join(" "));
  return [...new Set(queries)];
}

function cityFromVenueText(venue) {
  const text = `${venue.displayName || ""} ${venue.name || ""} ${venue.summary || ""}`;
  return [...BAY_AREA_CITIES].find((city) => text.includes(city)) || "";
}

function placeCity(place) {
  const components = place.addressComponents || [];
  const locality = components.find((item) => (item.types || []).includes("locality"))?.longText;
  const postalTown = components.find((item) => (item.types || []).includes("postal_town"))?.longText;
  const address = place.formattedAddress || "";
  return locality || postalTown || [...BAY_AREA_CITIES].find((city) => address.includes(city)) || "";
}

function regionForCity(city = "") {
  if (/^San Francisco$/i.test(city)) return "SF";
  if (/^(Oakland|Berkeley|Fremont|Concord|Walnut Creek|Alameda|Richmond|Pleasanton|Livermore|Hayward|El Cerrito)$/i.test(city)) return "East Bay";
  if (/^(San Jose|Palo Alto|Menlo Park|Mountain View|Saratoga|Santa Clara)$/i.test(city)) return "South Bay";
  if (/^(San Rafael|Mill Valley|Petaluma)$/i.test(city)) return "North Bay";
  if (/^Santa Cruz$/i.test(city)) return "Santa Cruz/Monterey";
  if (/^(San Mateo|Redwood City|Daly City|Pacifica)$/i.test(city)) return "Peninsula";
  return "";
}

function venueTypeFromPlace(place) {
  const types = new Set(place.types || []);
  if (types.has("movie_theater")) return "theater";
  if (types.has("night_club")) return "club";
  if (types.has("bar")) return "bar";
  if (types.has("art_gallery")) return "gallery";
  if (types.has("stadium")) return "arena";
  if (types.has("performing_arts_theater")) return "theater";
  return "";
}

function statusFromPlace(place) {
  const status = place.businessStatus || "";
  if (status === "OPERATIONAL") return "active";
  if (status === "CLOSED_TEMPORARILY") return "inactive";
  if (status === "CLOSED_PERMANENTLY") return "closed";
  return "";
}

function scorePlace(venue, place) {
  const wanted = normalizeName(venue.displayName || venue.name);
  const found = normalizeName(place.displayName?.text || "");
  const wantedTokens = meaningfulNameTokens(wanted);
  const foundTokens = new Set(found.split(" "));
  const requiredStreetNumber = streetNumberFromVenue(venue);
  const officialHosts = verifiedOfficialHosts(venue);
  const websiteHost = hostFor(place.websiteUri);
  const hasOfficialHostMatch = websiteHost && officialHosts.has(websiteHost);
  let score = 0;

  if (requiredStreetNumber && !hasOfficialHostMatch && !placeMatchesStreetNumber(place, requiredStreetNumber)) {
    return 0;
  }

  if (wanted && found === wanted) score += 6;
  if (!hasOfficialHostMatch && wantedTokens.length && !wantedTokens.some((token) => foundTokens.has(token))) {
    return 0;
  }
  score += wantedTokens.filter((token) => foundTokens.has(token)).length * 2;

  const city = placeCity(place);
  if (city && (city === venue.city || BAY_AREA_CITIES.has(city))) score += 4;
  if ((place.formattedAddress || "").includes("CA")) score += 2;

  if (websiteHost && officialHosts.has(websiteHost)) score += 6;

  if (venueTypeFromPlace(place)) score += 1;
  return score;
}

function meaningfulNameTokens(name = "") {
  const generic = new Set(["bar", "club", "theater", "theatre", "tavern", "venue", "music", "hall", "center", "centre", "arts", "room", "lounge", "live"]);
  return name.split(" ").filter((token) => token.length > 2 && !generic.has(token));
}

function bestPlace(venue, places = []) {
  const rejected = rejectedPlaceSignals(venue);
  const rejectedHosts = rejectedOfficialHosts(venue);
  return places
    .filter((place) => !rejected.has(normalizeUrl(place.googleMapsUri || "")))
    .filter((place) => !rejectedHosts.has(hostFor(place.websiteUri)))
    .map((place) => ({ place, score: scorePlace(venue, place) }))
    .filter((candidate) => candidate.score >= 8)
    .sort((a, b) => b.score - a.score)[0]?.place || null;
}

function streetNumberFromVenue(venue) {
  const text = `${venue.displayName || ""} ${venue.name || ""}`;
  return text.match(/\b(\d{2,6})\b/)?.[1] || "";
}

function placeMatchesStreetNumber(place, streetNumber) {
  const displayName = place.displayName?.text || "";
  const address = place.formattedAddress || "";
  return new RegExp(`\\b${streetNumber}\\b`).test(displayName) || new RegExp(`^\\s*${streetNumber}\\b`).test(address);
}

function linksFromPlace(place) {
  const links = [];
  if (place.googleMapsUri) {
    links.push({
      type: "maps",
      label: "Maps",
      url: place.googleMapsUri,
      confidence: "likely",
      source: "google-places"
    });
  }
  if (place.websiteUri) {
    const websiteType = placeWebsiteLinkType(place.websiteUri);
    links.push({
      type: websiteType,
      label: labelForType(websiteType),
      url: place.websiteUri,
      confidence: "candidate",
      source: "google-places"
    });
  }
  return links;
}

function placeWebsiteLinkType(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "livenation.com" || host.endsWith(".livenation.com")) return "liveNation";
    return "official";
  } catch {
    return "official";
  }
}

function labelForType(type = "") {
  return {
    liveNation: "Live Nation",
    official: "Official"
  }[type] || "Link";
}

function applyPlace(venue, place) {
  let changed = 0;
  const mapsUrl = place.googleMapsUri || "";
  const displayName = place.displayName?.text || "";
  const city = placeCity(place);
  const region = regionForCity(city);
  const status = statusFromPlace(place);
  const venueType = venueTypeFromPlace(place);

  if (shouldSetDisplayName(venue, displayName)) {
    venue.displayName = displayName;
    addEvidence(venue, mapsUrl, "Display name derived from Google Places.");
    changed += 1;
  }

  if ((!venue.address || !isUsableAddress(venue.address)) && place.formattedAddress) {
    venue.address = place.formattedAddress;
    addEvidence(venue, mapsUrl, "Address derived from Google Places.");
    changed += 1;
  }

  if (!venue.city && city) {
    venue.city = city;
    addEvidence(venue, mapsUrl, "City derived from Google Places.");
    changed += 1;
  }

  if (!venue.region && region) {
    venue.region = region;
    addEvidence(venue, mapsUrl, "Region inferred from Google Places city.");
    changed += 1;
  }

  if ((!venue.status || venue.status === "unknown") && status) {
    venue.status = status;
    addEvidence(venue, mapsUrl, "Venue status derived from Google Places business status.");
    changed += 1;
  }

  if ((!venue.venueType || venue.venueType === "unknown") && venueType) {
    venue.venueType = venueType;
    addEvidence(venue, mapsUrl, "Venue type derived from Google Places place types.");
    changed += 1;
  }

  if (!venue.geo && place.location?.latitude && place.location?.longitude) {
    venue.geo = {
      latitude: place.location.latitude,
      longitude: place.location.longitude
    };
    addEvidence(venue, mapsUrl, "Coordinates derived from Google Places.");
    changed += 1;
  }

  const before = venue.links?.length || 0;
  venue.links = mergeLinks(venue.links || [], linksFromPlace(place));
  changed += (venue.links.length - before);

  return changed;
}

function shouldSetDisplayName(venue, displayName) {
  if (!displayName) return false;
  const current = venue.displayName || "";
  if (!current) return true;
  if (normalizeName(current) === normalizeName(displayName)) return false;
  const candidateScore = displayNameScore(venue, displayName);
  const currentScore = displayNameScore(venue, current);
  if (candidateScore < currentScore) return false;
  if (candidateScore === currentScore && displayName.length <= current.length) return false;
  return true;
}

function displayNameScore(venue, value = "") {
  const tokens = normalizeName(value).split(" ").filter((token) => token.length > 2);
  const knownTokens = new Set(normalizeName(venue.name || "").split(" ").filter((token) => token.length > 2));
  return tokens.length + tokens.filter((token) => knownTokens.has(token)).length;
}

function isUsableAddress(address = "") {
  if (!address || address.length > 140) return false;
  return /^\s*\d{2,6}\s+.{2,80}\b(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?)\b/i.test(address);
}

const env = await readEnv(ENV_PATH);
const apiKey = env.GOOGLE_PLACES_API_KEY || "";
if (!apiKey) {
  console.log("Google Places enrichment skipped: GOOGLE_PLACES_API_KEY is not set in .env.");
  process.exit(0);
}

const store = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
const candidates = Object.values(store.venues || {})
  .filter((venue) => venue.confidence !== "rejected")
  .filter((venue) => !onlyVenue || normalizeName(venue.name) === normalizeName(onlyVenue) || normalizeName(venue.displayName || "") === normalizeName(onlyVenue))
  .filter((venue) => !confidenceFilter || venue.confidence === confidenceFilter)
  .slice(0, limit);

let enriched = 0;
let changed = 0;

for (const venue of candidates) {
  try {
    const result = await searchPlaces(apiKey, venue);
    const place = bestPlace(venue, result.places || []);
    if (!place) continue;
    const updates = applyPlace(venue, place);
    if (updates) {
      enriched += 1;
      changed += updates;
    }
  } catch (error) {
    console.warn(`Skipped ${venue.name}: ${error.message}`);
  }
}

store.generatedAt = new Date().toISOString();
await writeFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(store, null, 2)};\n`, "utf8");
console.log(`Google Places enriched ${enriched} venue${enriched === 1 ? "" : "s"} with ${changed} field/link update${changed === 1 ? "" : "s"}.`);
