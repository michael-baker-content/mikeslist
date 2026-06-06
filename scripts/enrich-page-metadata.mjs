import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const onlyArtist = args.get("artist") || "";

const genreTerms = [
  "americana",
  "alternative country",
  "alt-country",
  "country",
  "country rock",
  "folk rock",
  "indie rock",
  "power pop",
  "rock",
  "roots rock",
  "singer-songwriter",
  "twang"
];

const localityPatterns = [
  /\b(?:from|based in|hailing from)\s+([A-Z][A-Za-z .'-]+,\s*(?:CA|California|Georgia|New York|Texas|Oregon|Washington|Illinois|Tennessee|USA|United States))/i,
  /\b(San Francisco|Oakland|Berkeley|Los Angeles|Atlanta|Nashville|New York|Chicago|Portland|Seattle|Austin),?\s*(?:CA|California|Georgia|Tennessee|New York|Illinois|Oregon|Washington|Texas)?\b/i
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

function artistSearchName(artist) {
  return artist.displayName || artist.name || "";
}

function matchesArtistFilter(artist, filter) {
  if (!filter) return true;
  const wanted = normalizeName(filter);
  return [
    artist.name,
    artist.displayName,
    ...(artist.aliases || [])
  ].some((value) => normalizeName(value || "") === wanted);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
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

function decodeHtml(text = "") {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function bestDescription(html) {
  return metaContent(html, "og:description") || metaContent(html, "description") || pageTitle(html);
}

function outboundLinks(html, baseUrl, rejectedUrls) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = canonicalCandidateUrl(new URL(decodeHtml(match[1]), baseUrl).href);
      const type = inferLinkType(url);
      if (!type || type === "official" || type === "search") continue;
      if (!shouldKeepCandidate(type, url)) continue;
      if (rejectedUrls.has(normalizeUrl(url))) continue;
      links.push({
        type,
        label: labelForType(type),
        url,
        confidence: "candidate",
        source: "verified-page",
        sourcePage: baseUrl
      });
    } catch {
      continue;
    }
  }
  return dedupeLinks(links);
}

function canonicalCandidateUrl(url = "") {
  const parsed = new URL(url);
  parsed.hash = "";

  if (parsed.hostname.startsWith("www.")) {
    parsed.hostname = parsed.hostname.slice(4);
  }

  if (parsed.hostname.includes("open.spotify.com")) {
    parsed.search = "";
  }

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

  if (parsed.hostname === "twitter.com") {
    parsed.hostname = "x.com";
  }

  if (parsed.hostname === "x.com") {
    const username = parsed.pathname.split("/").filter(Boolean)[0];
    if (username) parsed.pathname = `/${username}`;
    parsed.search = "";
  }

  if (parsed.hostname === "tiktok.com") {
    const username = parsed.pathname.split("/").filter(Boolean)[0];
    if (username?.startsWith("@")) parsed.pathname = `/${username}`;
    parsed.search = "";
  }

  return parsed.href;
}

function shouldKeepCandidate(type, url = "") {
  const parsed = new URL(url);

  if (isWikipediaUrl(url)) return false;
  if (parsed.hostname === "wikimedia.org" || parsed.hostname.endsWith(".wikimedia.org")) return false;

  if (type === "bandcamp") {
    if (parsed.hostname === "bandcamp.com" || parsed.hostname === "www.bandcamp.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length === 0 || parts[0] === "music";
  }

  if (type === "spotify") {
    return /^\/artist\/[^/]+\/?$/i.test(parsed.pathname);
  }

  if (type === "appleMusic") {
    return /\/artist\//i.test(parsed.pathname);
  }

  return true;
}

function inferLinkType(url = "") {
  const lower = url.toLowerCase();
  if (lower.includes("bandcamp.com")) return "bandcamp";
  if (lower.includes("linktr.ee")) return "linktree";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com")) return "facebook";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "twitter";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("musicbrainz.org")) return "musicbrainz";
  if (lower.includes("spotify.com")) return "spotify";
  if (lower.includes("music.youtube.com")) return "youtubeMusic";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("soundcloud.com")) return "soundcloud";
  if (lower.includes("discogs.com")) return "discogsArtist";
  if (isWikipediaUrl(url)) return "wikipedia";
  if (lower.includes("music.apple.com")) return "appleMusic";
  if (lower.includes("music.amazon.com")) return "amazonMusic";
  if (lower.includes("ticketmaster.com")) return "ticketmaster";
  if (lower.includes("qobuz.com")) return "qobuz";
  if (lower.includes("deezer.com")) return "deezer";
  if (lower.includes("tidal.com")) return "tidal";
  if (isWikidataUrl(url)) return "wikidata";
  return "";
}

function isWikipediaUrl(url = "") {
  try {
    const host = new URL(url).hostname;
    return host === "wikipedia.org" || host.endsWith(".wikipedia.org");
  } catch {
    return false;
  }
}

function isWikidataUrl(url = "") {
  try {
    const host = new URL(url).hostname;
    return host === "wikidata.org" || host.endsWith(".wikidata.org");
  } catch {
    return false;
  }
}

function labelForType(type = "") {
  const labels = {
    appleMusic: "Apple Music",
    amazonMusic: "Amazon Music",
    bandcamp: "Bandcamp",
    deezer: "Deezer",
    discogsArtist: "Discogs Artist",
    facebook: "Facebook",
    instagram: "Instagram",
    linktree: "Linktree",
    musicbrainz: "MusicBrainz",
    qobuz: "Qobuz",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    tidal: "Tidal",
    tiktok: "TikTok",
    twitter: "X/Twitter",
    wikidata: "Wikidata",
    wikipedia: "Wikipedia",
    youtube: "YouTube",
    youtubeMusic: "YouTube Music"
  };
  return labels[type] || "Link";
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
  return url.replace(/\/$/, "").toLowerCase();
}

function mergeCandidateLinks(existingLinks = [], incomingLinks = []) {
  const rejected = new Set(existingLinks.filter((link) => link.confidence === "rejected").map((link) => normalizeUrl(link.url)));
  const existing = new Map(existingLinks.map((link) => [normalizeUrl(link.url), link]));
  let added = 0;

  for (const link of incomingLinks) {
    const key = normalizeUrl(link.url);
    if (rejected.has(key)) continue;
    const previous = existing.get(key);
    if (previous) {
      if (previous.confidence === "rejected") continue;
      continue;
    }
    existingLinks.push(link);
    existing.set(key, link);
    added += 1;
  }

  return added;
}

function summaryFromDescription(artist, description) {
  const clean = description.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 20) return "";
  if (!clean.toLowerCase().includes(artistSearchName(artist).toLowerCase().split(" ")[0])) return "";
  if (clean.length <= 220) return clean;
  const trimmed = clean.slice(0, 217).replace(/\s+\S*$/, "").trim();
  return `${trimmed}...`;
}

function localityFromText(text) {
  for (const pattern of localityPatterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  return "";
}

function genresFromText(text) {
  const lower = text.toLowerCase();
  return genreTerms.filter((genre) => lower.includes(genre));
}

function trustedMetadataLinks(artist) {
  const preferred = new Set(["official", "bandcamp", "facebook", "instagram", "tiktok", "youtube", "youtubeMusic", "spotify", "appleMusic", "linktree", "wikipedia"]);
  return (artist.links || [])
    .filter((link) => link.confidence === "verified" && preferred.has(link.type) && /^https?:\/\//i.test(link.url))
    .slice(0, 10);
}

function shouldHarvestOutboundLinks(link) {
  if (isWikipediaUrl(link.url)) return false;
  return ["official", "bandcamp", "facebook", "instagram", "tiktok", "linktree"].includes(link.type);
}

function mergeGenres(existingGenres = [], incomingGenres = []) {
  const base = incomingGenres.length ? existingGenres.filter((genre) => genre !== "unknown") : existingGenres;
  return [...new Set([...base, ...incomingGenres])];
}

function addEvidence(artist, url, note) {
  artist.evidence ||= [];
  if (artist.evidence.some((item) => item.url === url && item.note === note)) return;
  artist.evidence.push({ url, note });
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const artists = Object.values(store.artists || {})
  .filter((artist) => matchesArtistFilter(artist, onlyArtist));

let changed = 0;

for (const artist of artists) {
  const rejectedUrls = new Set((artist.links || [])
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizeUrl(link.url)));

  for (const link of trustedMetadataLinks(artist)) {
    let html = "";
    try {
      html = await fetchText(link.url);
    } catch (error) {
      console.warn(`Skipped ${artist.name} ${link.url}: ${error.message}`);
      continue;
    }

    const description = bestDescription(html);
    const text = `${description} ${pageTitle(html)} ${stripTags(html).slice(0, 5000)}`;
    const newLinks = shouldHarvestOutboundLinks(link) ? outboundLinks(html, link.url, rejectedUrls) : [];
    const summary = summaryFromDescription(artist, description);
    const locality = localityFromText(text);
    const genres = genresFromText(text);

    if (!artist.summary && summary) {
      artist.summary = summary;
      addEvidence(artist, link.url, "Summary derived from verified page metadata.");
      changed += 1;
    }

    if ((!artist.locality || artist.locality === "unknown") && locality) {
      artist.locality = locality;
      addEvidence(artist, link.url, "Locality inferred from verified page text.");
      changed += 1;
    }

    if ((!artist.genres?.length || artist.genres.includes("unknown")) && genres.length) {
      artist.genres = mergeGenres(artist.genres || [], genres);
      addEvidence(artist, link.url, "Genres inferred from verified page text.");
      changed += 1;
    }

    const addedLinks = mergeCandidateLinks(artist.links, newLinks);
    if (addedLinks) {
      addEvidence(artist, link.url, `Added ${addedLinks} outbound link candidate${addedLinks === 1 ? "" : "s"} from a verified page.`);
      changed += addedLinks;
    }
  }
}

store.generatedAt = new Date().toISOString();
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");
console.log(`Page metadata enrichment made ${changed} field updates.`);
