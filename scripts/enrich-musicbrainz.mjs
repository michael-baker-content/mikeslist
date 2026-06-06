import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.split("=");
  return [key.replace(/^--/, ""), value || "true"];
}));

const limit = Number(args.get("limit") || 25);
const onlyArtist = args.get("artist") || "";

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

function isGoodMatch(artistName, candidate) {
  const score = Number(candidate.score || 0);
  if (score < 95) return false;
  const wanted = normalizeName(artistName);
  const candidateNames = [
    candidate.name,
    candidate["sort-name"],
    ...(candidate.aliases || []).map((alias) => alias.name)
  ].filter(Boolean).map(normalizeName);
  return candidateNames.includes(wanted);
}

function mergeLinks(existingLinks = [], incomingLinks = []) {
  const links = new Map();
  for (const link of [...existingLinks, ...incomingLinks]) {
    if (!link?.url) continue;
    const previous = links.get(link.url);
    if (previous?.confidence === "rejected") continue;
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) {
      links.set(link.url, link);
    }
  }
  return [...links.values()];
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function mergeGenres(existingGenres = [], incomingTags = []) {
  const incoming = incomingTags.map((tag) => tag?.name).filter(Boolean);
  const genres = new Set(incoming.length ? (existingGenres || []).filter((genre) => genre !== "unknown") : existingGenres || []);
  for (const tag of incomingTags.slice(0, 8)) {
    if (tag?.name) genres.add(tag.name);
  }
  return [...genres];
}

function localityFromMusicBrainz(match) {
  const place = match["begin-area"]?.name || match.area?.name || "";
  if (!place) return "";
  const region = regionFromRelations(match.relations || []);
  if (region && !place.toLowerCase().includes(region.toLowerCase())) return `${place}, ${region}`;
  return place;
}

function regionFromRelations(relations) {
  return relations
    .map((relation) => relation.area?.name)
    .filter(Boolean)
    .find((name) => /^(California|Colorado|Georgia|New York|Texas|Oregon|Washington|Illinois|Tennessee)$/i.test(name)) || "";
}

function shouldUpgradeLocality(current = "", incoming = "") {
  if (!incoming) return false;
  if (!current || current === "unknown") return true;
  const currentLower = current.toLowerCase();
  const incomingLower = incoming.toLowerCase();
  return incomingLower.startsWith(`${currentLower},`) || incomingLower.includes(`${currentLower},`);
}

function addEvidence(artist, url, note) {
  artist.evidence ||= [];
  if (artist.evidence.some((item) => item.url === url && item.note === note)) return;
  artist.evidence.push({ url, note });
}

async function searchMusicBrainz(name) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const query = new URLSearchParams({
    query: `artist:"${name}"`,
    fmt: "json",
    limit: "5"
  });
  try {
    const response = await fetch(`https://musicbrainz.org/ws/2/artist?${query}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`MusicBrainz search failed for ${name}: ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getMusicBrainzArtist(id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const query = new URLSearchParams({
    inc: "aliases+tags+area-rels",
    fmt: "json"
  });
  try {
    const response = await fetch(`https://musicbrainz.org/ws/2/artist/${id}?${query}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`MusicBrainz artist fetch failed for ${id}: ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function existingMusicBrainzId(artist) {
  const rejected = rejectedMusicBrainzIds(artist);
  return (artist.links || [])
    .filter((link) => link.confidence !== "rejected")
    .map((link) => (link.url || "").match(/musicbrainz\.org\/artist\/([0-9a-f-]+)/i)?.[1])
    .filter((id) => !rejected.has(id))
    .find(Boolean);
}

function rejectedMusicBrainzIds(artist) {
  return new Set((artist.links || [])
    .filter((link) => link.confidence === "rejected")
    .map((link) => (link.url || "").match(/musicbrainz\.org\/artist\/([0-9a-f-]+)/i)?.[1])
    .filter(Boolean));
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const candidates = Object.values(store.artists)
  .filter((artist) => matchesArtistFilter(artist, onlyArtist))
  .filter((artist) => {
    return onlyArtist || !artist.links?.some((link) => link.type === "musicbrainz" && link.confidence !== "rejected");
  })
  .slice(0, limit);

let enriched = 0;

for (const artist of candidates) {
  let result;
  const mbid = existingMusicBrainzId(artist);
  const searchName = artistSearchName(artist);
  try {
    result = mbid ? { artists: [await getMusicBrainzArtist(mbid)] } : await searchMusicBrainz(searchName);
  } catch (error) {
    console.warn(`Skipped ${artist.name}: ${error.message}`);
    await sleep(1100);
    continue;
  }
  const match = mbid ? result.artists[0] : (result.artists || []).find((candidate) => isGoodMatch(searchName, candidate));
  if (match && !rejectedMusicBrainzIds(artist).has(match.id)) {
    const url = `https://musicbrainz.org/artist/${match.id}`;
    artist.links = mergeLinks(artist.links, [{
      type: "musicbrainz",
      label: "MusicBrainz",
      url,
      confidence: "likely",
      source: "musicbrainz"
    }]);
    artist.genres = mergeGenres(artist.genres, match.tags || []);
    const locality = localityFromMusicBrainz(match);
    if (shouldUpgradeLocality(artist.locality, locality)) {
      artist.locality = locality;
      addEvidence(artist, url, "Locality inferred from MusicBrainz begin-area/area.");
    }
    artist.disambiguation ||= match.disambiguation || "";
    artist.confidence = artist.confidence === "review" ? "likely" : artist.confidence;
    addEvidence(artist, url, `MusicBrainz returned a high-score artist match for "${searchName}".`);
    enriched += 1;
  }
  await sleep(1100);
}

store.generatedAt = new Date().toISOString();
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");

console.log(`MusicBrainz enriched ${enriched} of ${candidates.length} checked artists.`);
