import { readFile, writeFile } from "node:fs/promises";

const VENUES_PATH = new URL("../data/venues.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const onlyVenue = args.get("venue") || "";
const confidenceFilter = args.get("confidence") || "";
const limit = Number(args.get("limit") || 0);

const cityPatterns = [
  /\b(San Francisco|Oakland|Berkeley|San Jose|Santa Cruz|Saratoga|Mill Valley|Petaluma|San Rafael|Palo Alto|Menlo Park|Mountain View|Walnut Creek|Concord|Fremont|Pleasanton|Alameda|Richmond|San Mateo|Redwood City|Daly City|Santa Clara|Livermore|Hayward|El Cerrito|Pacifica)\b/i,
  /\b([A-Z][A-Za-z .'-]+),\s*(?:CA|California)\b/
];

const addressPatterns = [
  /\b(\d{2,6}\s+(?!Calendar\b|Events\b|Tickets\b|Showtimes\b)(?:[A-Z][A-Za-z0-9.'-]*\s){1,5}(?:Street|St\.|Avenue|Ave\.|Boulevard|Blvd\.|Road|Rd\.|Drive|Dr\.|Lane|Ln\.|Court|Ct\.|Place|Pl\.)(?:,\s*[A-Z][A-Za-z .'-]+)?(?:,\s*CA)?(?:\s+\d{5})?)\b/i
];

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

function normalizeName(name) {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(text = "") {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function wikipediaSummary(url) {
  const title = wikipediaTitle(url);
  if (!title) return "";
  try {
    const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    return decodeHtml(summary.extract || "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function wikipediaTitle(url = "") {
  try {
    const parsed = new URL(url);
    if (!/wikipedia\.org$/i.test(parsed.hostname)) return "";
    const match = parsed.pathname.match(/\/wiki\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function metaContent(html, key) {
  const property = html.match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"));
  if (property) return decodeHtml(property[1]).trim();
  const reversed = html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["'][^>]*>`, "i"));
  return reversed ? decodeHtml(reversed[1]).trim() : "";
}

function pageTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return decodeHtml(title.replace(/\s+/g, " ")).trim();
}

function stripTags(html) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim();
}

function bestDescription(html) {
  return metaContent(html, "og:description") || metaContent(html, "description") || "";
}

function bestTitle(html) {
  return metaContent(html, "og:site_name") || metaContent(html, "og:title") || pageTitle(html);
}

function summaryFromDescription(venue, description) {
  const clean = description.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 20) return "";
  if (/\bFollowers\b.*\bFollowing\b.*\bPosts\b/i.test(clean)) return "";
  if (/^see instagram photos and videos/i.test(clean)) return "";
  const nameToken = nameTokensForSummary(venue)[0];
  if (nameToken && !clean.toLowerCase().includes(nameToken)) return "";
  if (clean.length <= 260) return clean;
  return `${clean.slice(0, 257).replace(/\s+\S*$/, "").trim()}...`;
}

function summaryFromText(venue, text) {
  const nameTokens = nameTokensForSummary(venue);
  const sentences = text
    .replace(/\[[^\]]+\]/g, "")
    .replace(/-->/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 320)
    .filter((sentence) => !isNavigationSummary(sentence));
  const first = sentences.find((sentence) => {
    const lower = sentence.toLowerCase();
    return !nameTokens.length || nameTokens.some((token) => lower.includes(token));
  });
  return first || "";
}

function nameTokensForSummary(venue) {
  const names = [venue.displayName, venue.name, ...(venue.aliases || [])].filter(Boolean);
  return [...new Set(names
    .flatMap((name) => normalizeName(name).split(" "))
    .filter((token) => token.length > 2))];
}

function isWeakSummary(summary = "", source = "") {
  const clean = summary.replace(/\s+/g, " ").trim();
  if (!clean) return true;
  if (isNavigationSummary(clean)) return true;
  if (source && source !== "wikidata") return false;
  if (clean.length > 90) return false;
  return /^(architectural structure|building|venue|arena|sports venue|entertainment venue|music venue|theater|cinema)\b/i.test(clean);
}

function isNavigationSummary(summary = "") {
  return /(-->|top of page|\bHOME\s+\|\s*|HOME\s+SHOWS|NEW HOURS|HAPPY HOUR|PHOTOS\s+CONTACT)/i.test(summary);
}

function shouldSetSummary(venue, link, summary) {
  if (!summary || ["instagram", "facebook", "yelp"].includes(link.type)) return false;
  if (!venue.summary) return true;
  if (!isWeakSummary(venue.summary, venue.summarySource?.source)) return false;
  return ["wikipedia", "official", "localwiki"].includes(link.type) || isLocalWikiUrl(link.url);
}

function cityFromText(text) {
  for (const pattern of cityPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function regionForCity(city = "") {
  if (/^San Francisco$/i.test(city)) return "SF";
  if (/^(Oakland|Berkeley|Fremont|Concord|Walnut Creek|Pleasanton|Alameda|Richmond|Livermore|Hayward|El Cerrito)$/i.test(city)) return "East Bay";
  if (/^(San Jose|Palo Alto|Menlo Park|Mountain View|Saratoga|Santa Clara)$/i.test(city)) return "South Bay";
  if (/^(San Rafael|Mill Valley|Petaluma)$/i.test(city)) return "North Bay";
  if (/^(San Mateo|Redwood City|Daly City|Pacifica)$/i.test(city)) return "Peninsula";
  if (/^Santa Cruz$/i.test(city)) return "Santa Cruz/Monterey";
  return "";
}

function addressFromText(text) {
  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function capacityFromText(text) {
  const clean = text.replace(/&#160;|&nbsp;/gi, " ").replace(/\s+/g, " ");
  const amphitheater = clean.match(/\b(\d{1,3}(?:,\d{3})?)\s+seat\s+amphitheater\b/i);
  if (amphitheater) return `${amphitheater[1]}-seat amphitheater`;
  const capacity = clean.match(/\bcapacity(?:\s+of)?\s+(\d{1,3}(?:,\d{3})?)\b/i);
  if (capacity) return capacity[1];
  return "";
}

function agePolicyFromAppearances(venue) {
  const details = (venue.source?.appearances || []).map((appearance) => appearance.details || "").filter(Boolean);
  if (!details.length) return "";
  const policies = new Set(details.map(agePolicyFromDetails).filter(Boolean));
  if (!policies.size) return "";
  if (policies.size === 1) return [...policies][0];
  return "mixed";
}

function agePolicyFromDetails(details = "") {
  if (/\ba\/a\b|all ages/i.test(details)) return "all-ages";
  if (/\b21\+/i.test(details)) return "21+";
  if (/\b18\+/i.test(details)) return "18+";
  if (/\b16\+/i.test(details)) return "16+";
  return "";
}

function displayNameFromTitle(venue, title) {
  const clean = title.replace(/\s+[-|].*$/, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 80) return "";
  if (/^[A-Z0-9\s]+$/.test(clean) && clean.length > 12) return "";
  if (/facebook|instagram|yelp|official site|home$/i.test(clean)) return "";

  const wantedTokens = normalizeName(venue.name).split(" ").filter((token) => token.length > 2);
  const titleTokens = new Set(normalizeName(clean).split(" "));
  const overlap = wantedTokens.filter((token) => titleTokens.has(token)).length;
  return overlap ? clean : "";
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

function venueTypeFromText(text) {
  if (/\bmovie theater|cinema|screening room|film\b/i.test(text)) return "theater";
  if (/\bnightclub|club\b/i.test(text)) return "club";
  if (/\bbar|pub|tavern\b/i.test(text)) return "bar";
  if (/\bgallery\b/i.test(text)) return "gallery";
  if (/\barena\b/i.test(text)) return "arena";
  if (/\bconcert hall|music hall|live music venue\b/i.test(text)) return "music venue";
  return "";
}

function trustedMetadataLinks(venue) {
  const preferred = new Set(["official", "facebook", "instagram", "yelp", "wikidata", "wikipedia", "localwiki"]);
  return (venue.links || [])
    .filter((link) => link.confidence === "verified" && (preferred.has(link.type) || isLocalWikiUrl(link.url)) && /^https?:\/\//i.test(link.url))
    .sort((a, b) => metadataLinkPriority(a) - metadataLinkPriority(b))
    .slice(0, 8);
}

function metadataLinkPriority(link) {
  if (link.type === "wikipedia") return 1;
  if (link.type === "localwiki" || isLocalWikiUrl(link.url)) return 2;
  if (link.type === "official") return 3;
  if (link.type === "wikidata") return 4;
  return 5;
}

function isLocalWikiUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase() === "localwiki.org";
  } catch {
    return false;
  }
}

function shouldHarvestOutboundLinks(link) {
  return link.type === "official" && !isReferenceSiteUrl(link.url);
}

function isReferenceSiteUrl(url = "") {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return hostname === "wikipedia.org" ||
      hostname.endsWith(".wikipedia.org") ||
      hostname === "wikidata.org" ||
      hostname === "localwiki.org";
  } catch {
    return false;
  }
}

function outboundLinks(html, baseUrl, rejectedUrls, venue) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = canonicalCandidateUrl(new URL(decodeHtml(match[1]), baseUrl).href);
      const type = inferLinkType(url);
      if (!type || type === "official" || type === "search") continue;
      if (!shouldKeepVenueCandidate(type, url)) continue;
      if (rejectedUrls.has(normalizeUrl(url))) continue;
      links.push({
        type,
        label: labelForType(type),
        url,
        confidence: "candidate",
        source: "verified-venue-page",
        sourcePage: baseUrl
      });
    } catch {
      continue;
    }
  }
  return dedupeLinks(filterNoisySocialLinks(links, venue, baseUrl));
}

function shouldKeepVenueCandidate(type, url = "") {
  try {
    const parsed = new URL(url);
    if (isSocialUtilityUrl(parsed)) return false;
    if (isSocialAssetOrPostUrl(parsed)) return false;
    if (type === "ticketmaster" || type === "liveNation") return /\/venue\//i.test(parsed.pathname);
    return true;
  } catch {
    return false;
  }
}

function isSocialUtilityUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === "facebook.com" && /^\/(?:sharer|share|profile\.php|events)\b/.test(path)) return true;
  if (host === "facebook.com" && /^\/\d+(?:_\d+)?\/?$/.test(path)) return true;
  if (host === "x.com" && /^\/(?:intent|share)\b/.test(path)) return true;
  return false;
}

function isSocialAssetOrPostUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (/^scontent-[^.]+\.cdninstagram\.com$/.test(host)) return true;
  if (host === "instagram.com" && /^\/(?:p|explore|reel|stories)\b/.test(path)) return true;
  return false;
}

function filterNoisySocialLinks(links, venue, baseUrl) {
  const social = links.filter((link) => isSocialType(link.type));
  if (social.length <= 8) return links;
  return links.filter((link) => !isSocialType(link.type) || socialHandleMatchesVenue(link.url, venue, baseUrl));
}

function isSocialType(type = "") {
  return ["facebook", "instagram", "twitter"].includes(type);
}

function socialHandleMatchesVenue(url = "", venue, baseUrl = "") {
  const handle = socialHandle(url);
  if (!handle) return false;
  const handleCompact = compactIdentity(handle);
  const terms = venueIdentityTerms(venue, baseUrl);
  return terms.some((term) => {
    if (term.length < 4) return false;
    return handleCompact.includes(term) || term.includes(handleCompact);
  });
}

function socialHandle(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function venueIdentityTerms(venue, baseUrl = "") {
  const values = [
    venue.displayName,
    venue.name,
    ...(venue.aliases || []),
    domainName(baseUrl)
  ].filter(Boolean);
  return [...new Set(values.flatMap((value) => {
    const compact = compactIdentity(value);
    const tokens = normalizeName(value).split(" ").filter((token) => token.length >= 4);
    return [compact, ...tokens];
  }).filter((term) => term.length >= 4))];
}

function domainName(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function compactIdentity(value = "") {
  return normalizeName(value).replace(/\b(the|and|for|music|venue|theatre|theater|bar|club|live|room|tavern|center|centre|arts|sf|san|francisco|oakland|berkeley|santa|cruz|jose|napa|concord)\b/g, "").replace(/\s+/g, "");
}

function canonicalCandidateUrl(url = "") {
  const parsed = new URL(url);
  parsed.hash = "";

  if (parsed.hostname.startsWith("www.")) parsed.hostname = parsed.hostname.slice(4);

  if (parsed.hostname === "instagram.com") {
    const username = parsed.pathname.split("/").filter(Boolean)[0];
    if (username) parsed.pathname = `/${username}/`;
    parsed.search = "";
  }

  if (parsed.hostname === "facebook.com") {
    const slug = parsed.pathname.split("/").filter(Boolean)[0];
    if (slug) parsed.pathname = `/${slug}/`;
    parsed.search = "";
  }

  if (parsed.hostname === "twitter.com") parsed.hostname = "x.com";

  if (parsed.hostname === "x.com") {
    const username = parsed.pathname.split("/").filter(Boolean)[0];
    if (username) parsed.pathname = `/${username}`;
    parsed.search = "";
  }

  return parsed.href;
}

function inferLinkType(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "instagram.com") return "instagram";
    if (host === "facebook.com") return "facebook";
    if (host === "x.com" || host === "twitter.com") return "twitter";
    if (host === "ticketmaster.com" || host.endsWith(".ticketmaster.com")) return "ticketmaster";
    if (host === "livenation.com" || host.endsWith(".livenation.com")) return "liveNation";
    if (host === "yelp.com" || host.endsWith(".yelp.com")) return "yelp";
    if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return "wikipedia";
    if (host === "wikidata.org" || host.endsWith(".wikidata.org")) return "wikidata";
    if (host === "localwiki.org") return "localwiki";
    if (host.startsWith("maps.google.") || (host === "google.com" && parsed.pathname.startsWith("/maps"))) return "maps";
    return "";
  } catch {
    return "";
  }
}

function labelForType(type = "") {
  const labels = {
    facebook: "Facebook",
    instagram: "Instagram",
    liveNation: "Live Nation",
    maps: "Maps",
    ticketmaster: "Ticketmaster",
    twitter: "X/Twitter",
    wikidata: "Wikidata",
    wikipedia: "Wikipedia",
    localwiki: "LocalWiki",
    yelp: "Yelp"
  };
  return labels[type] || "Link";
}

function sourceLabelForLink(link) {
  if (isWikipediaUrl(link.url)) return "Wikipedia";
  if (link.type === "localwiki" || isLocalWikiUrl(link.url)) return "LocalWiki";
  if (link.type === "wikipedia") return "Wikipedia";
  if (link.type === "wikidata") return "Wikidata";
  if (link.type === "official") return "Official";
  if (link.type === "facebook") return "Facebook";
  if (link.type === "instagram") return "Instagram";
  if (link.type === "liveNation") return "Live Nation";
  if (link.type === "yelp") return "Yelp";
  return link.label || labelForType(link.type);
}

function isWikipediaUrl(url = "") {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org");
  } catch {
    return false;
  }
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = normalizeUrl(link.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    if (/^https?:$/i.test(parsed.protocol)) parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.replace(/^www\./i, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

function mergeCandidateLinks(existingLinks = [], incomingLinks = []) {
  const rejected = new Set(existingLinks.filter((link) => link.confidence === "rejected").map((link) => linkKey(link)));
  const existing = new Map(existingLinks.map((link) => [linkKey(link), link]));
  let added = 0;

  for (const link of incomingLinks) {
    const key = linkKey(link);
    if (rejected.has(key)) continue;
    if (isLowerConfidenceDuplicateOfficialHomepage(link, existingLinks)) continue;
    if (existing.has(key)) continue;
    existingLinks.push(link);
    existing.set(key, link);
    added += 1;
  }

  return added;
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

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function addEvidence(venue, url, note) {
  venue.evidence ||= [];
  if (venue.evidence.some((item) => item.url === url && item.note === note)) return;
  venue.evidence.push({ url, note });
}

const store = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
const venues = Object.values(store.venues || {})
  .filter((venue) => !onlyVenue || normalizeName(venue.name) === normalizeName(onlyVenue) || normalizeName(venue.displayName || "") === normalizeName(onlyVenue))
  .filter((venue) => !confidenceFilter || venue.confidence === confidenceFilter)
  .slice(0, limit || undefined);

let changed = 0;

for (const venue of venues) {
  const rejectedUrls = new Set((venue.links || [])
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizeUrl(link.url)));

  for (const link of trustedMetadataLinks(venue)) {
    let html = "";
    try {
      html = await fetchText(link.url);
    } catch (error) {
      console.warn(`Skipped ${venue.name} ${link.url}: ${error.message}`);
      continue;
    }

    const description = bestDescription(html);
    const title = bestTitle(html);
    const text = `${title} ${description} ${stripTags(html).slice(0, 6000)}`;
    const summary = summaryFromDescription(venue, description) || (link.type === "wikipedia" || isWikipediaUrl(link.url) ? (await wikipediaSummary(link.url)) || summaryFromText(venue, stripTags(html).slice(0, 6000)) : "") || (["official", "other", "localwiki"].includes(link.type) || isLocalWikiUrl(link.url) ? summaryFromText(venue, stripTags(html).slice(0, 6000)) : "");
    const city = cityFromText(text);
    const address = addressFromText(text);
    const capacity = capacityFromText(text);
    const agePolicy = agePolicyFromAppearances(venue);
    const venueType = venueTypeFromText(text);
    const newLinks = shouldHarvestOutboundLinks(link) ? outboundLinks(html, link.url, rejectedUrls, venue) : [];

    const displayName = displayNameFromTitle(venue, title);
    if (shouldSetDisplayName(venue, displayName)) {
      venue.displayName = displayName;
      addEvidence(venue, link.url, "Display name derived from verified venue page metadata.");
      changed += 1;
    }

    if (shouldSetSummary(venue, link, summary)) {
      venue.summary = summary;
      venue.summarySource = {
        label: sourceLabelForLink(link),
        url: link.url,
        source: isWikipediaUrl(link.url) ? "wikipedia" : isLocalWikiUrl(link.url) ? "localwiki" : link.type || "metadata"
      };
      addEvidence(venue, link.url, "Summary derived from verified venue page metadata.");
      changed += 1;
    }

    if (!venue.capacity && capacity) {
      venue.capacity = capacity;
      addEvidence(venue, link.url, "Capacity inferred from verified venue page text.");
      changed += 1;
    }

    if ((!venue.agePolicy || venue.agePolicy === "unknown") && agePolicy) {
      venue.agePolicy = agePolicy;
      addEvidence(venue, link.url, "Age policy inferred from imported event listings.");
      changed += 1;
    }

    if (!venue.city && city) {
      venue.city = city;
      addEvidence(venue, link.url, "City inferred from verified venue page text.");
      changed += 1;
    }

    if (!venue.region && (city || venue.city)) {
      const region = regionForCity(city || venue.city);
      if (region) {
        venue.region = region;
        addEvidence(venue, link.url, "Region inferred from venue city.");
        changed += 1;
      }
    }

    if (!venue.address && address) {
      venue.address = address;
      addEvidence(venue, link.url, "Address inferred from verified venue page text.");
      changed += 1;
    }

    if ((!venue.venueType || venue.venueType === "unknown") && venueType) {
      venue.venueType = venueType;
      addEvidence(venue, link.url, "Venue type inferred from verified venue page text.");
      changed += 1;
    }

    const addedLinks = mergeCandidateLinks(venue.links, newLinks);
    if (addedLinks) {
      addEvidence(venue, link.url, `Added ${addedLinks} outbound venue link candidate${addedLinks === 1 ? "" : "s"} from a verified page.`);
      changed += addedLinks;
    }
  }
}

store.generatedAt = new Date().toISOString();
await writeFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(store, null, 2)};\n`, "utf8");
console.log(`Venue page metadata enrichment made ${changed} field updates.`);
