import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1 (local non-commercial prototype)";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const limit = Number(args.get("limit") || 25);
const onlyArtist = args.get("artist") || "";

const ID_LINKS = {
  P2003: { type: "instagram", label: "Instagram", url: (id) => `https://www.instagram.com/${id.replace(/^@/, "")}/` },
  P2013: { type: "facebook", label: "Facebook", url: (id) => `https://www.facebook.com/${id}` },
  P2002: { type: "twitter", label: "X/Twitter", url: (id) => `https://x.com/${id.replace(/^@/, "")}` },
  P7085: { type: "tiktok", label: "TikTok", url: (id) => `https://www.tiktok.com/@${id.replace(/^@/, "")}` },
  P2397: { type: "youtube", label: "YouTube", url: (id) => `https://www.youtube.com/channel/${id}` },
  P3040: { type: "soundcloud", label: "SoundCloud", url: (id) => `https://soundcloud.com/${id}` },
  P1953: { type: "discogsArtist", label: "Discogs Artist", url: (id) => `https://www.discogs.com/artist/${id}` },
  P434: { type: "musicbrainz", label: "MusicBrainz", url: (id) => `https://musicbrainz.org/artist/${id}` },
  P1902: { type: "spotify", label: "Spotify", url: (id) => `https://open.spotify.com/artist/${id}` },
  P2722: { type: "deezer", label: "Deezer", url: (id) => `https://www.deezer.com/us/artist/${id}` },
  P4576: { type: "tidal", label: "Tidal", url: (id) => `https://tidal.com/artist/${id}` }
};

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

async function searchEntity(name) {
  const query = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "en",
    format: "json",
    limit: "5"
  });
  const result = await fetchJson(`https://www.wikidata.org/w/api.php?${query}`);
  return (result.search || []).find((item) => {
    return normalizeName(item.label || "") === normalizeName(name);
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

async function findEntityByExternalId(property, value) {
  const query = `
    SELECT ?item WHERE {
      ?item wdt:${property} "${value.replaceAll("\"", "\\\"")}".
    }
    LIMIT 1
  `;
  const params = new URLSearchParams({
    query,
    format: "json"
  });
  const result = await fetchJson(`https://query.wikidata.org/sparql?${params}`);
  const uri = result.results?.bindings?.[0]?.item?.value || "";
  return uri.match(/Q\d+$/)?.[0] || "";
}

async function findEntityFromExistingLinks(artist) {
  const rejected = rejectedExternalIdsFromLinks(artist.links || []);
  const ids = externalIdsFromLinks(artist.links || []);
  for (const candidate of ids) {
    if (rejected.has(`${candidate.property}:${candidate.value}`)) continue;
    const entityId = await findEntityByExternalId(candidate.property, candidate.value);
    if (rejected.has(`wikidata:${entityId}`)) continue;
    if (entityId) return { id: entityId, via: candidate };
  }
  return null;
}

function externalIdsFromLinks(links) {
  const ids = [];
  for (const link of links) {
    if (link.confidence === "rejected") continue;
    const url = link.url || "";
    const spotify = url.match(/open\.spotify\.com\/artist\/([^/?#]+)/i)?.[1];
    const musicbrainz = url.match(/musicbrainz\.org\/artist\/([0-9a-f-]+)/i)?.[1];
    const discogs = url.match(/discogs\.com\/artist\/(\d+)/i)?.[1];
    if (spotify) ids.push({ property: "P1902", value: spotify, type: "spotify" });
    if (musicbrainz) ids.push({ property: "P434", value: musicbrainz, type: "musicbrainz" });
    if (discogs) ids.push({ property: "P1953", value: discogs, type: "discogs" });
  }
  return ids;
}

function rejectedExternalIdsFromLinks(links) {
  const rejected = new Set();
  for (const link of links) {
    if (link.confidence !== "rejected") continue;
    const url = link.url || "";
    const wikidata = url.match(/wikidata\.org\/wiki\/(Q\d+)/i)?.[1];
    const spotify = url.match(/open\.spotify\.com\/artist\/([^/?#]+)/i)?.[1];
    const musicbrainz = url.match(/musicbrainz\.org\/artist\/([0-9a-f-]+)/i)?.[1];
    const discogs = url.match(/discogs\.com\/artist\/(\d+)/i)?.[1];
    if (wikidata) rejected.add(`wikidata:${wikidata}`);
    if (spotify) rejected.add(`P1902:${spotify}`);
    if (musicbrainz) rejected.add(`P434:${musicbrainz}`);
    if (discogs) rejected.add(`P1953:${discogs}`);
  }
  return rejected;
}

function claimValues(entity, property) {
  return (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .map((value) => {
      if (typeof value === "string") return value;
      if (value?.id) return value.id;
      return "";
    })
    .filter(Boolean);
}

function claimEntityIds(entity, property) {
  return (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function claimEntityValues(entity, property) {
  return (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter(Boolean);
}

async function entityLabel(id) {
  const entity = await getEntity(id);
  return entity?.labels?.en?.value || "";
}

async function placeLabelWithParent(id) {
  const entity = await getEntity(id);
  const label = entity?.labels?.en?.value || "";
  if (!label) return "";

  const stateLabel = await stateOrRegionLabel(entity);
  if (stateLabel && !label.toLowerCase().includes(stateLabel.toLowerCase())) {
    return `${label}, ${stateLabel}`;
  }

  return label;
}

async function localityFromWikidata(entity) {
  const placeIds = [
    ...claimEntityValues(entity, "P740").map((value) => value.id).filter(Boolean),
    ...claimEntityValues(entity, "P495").map((value) => value.id).filter(Boolean)
  ];
  if (!placeIds.length) return "";
  return placeLabelWithParent(placeIds[0]);
}

function shouldUpgradeLocality(current = "", incoming = "") {
  if (!incoming) return false;
  if (!current || current === "unknown") return true;
  const currentLower = current.toLowerCase();
  const incomingLower = incoming.toLowerCase();
  return incomingLower.startsWith(`${currentLower},`) || incomingLower.includes(`${currentLower},`);
}

async function stateOrRegionLabel(placeEntity) {
  const visited = new Set();
  let frontier = claimEntityValues(placeEntity, "P131").map((value) => value.id).filter(Boolean);

  for (let depth = 0; depth < 4 && frontier.length; depth += 1) {
    const next = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const entity = await getEntity(id);
      if (!entity) continue;

      if (isStateOrRegion(entity)) {
        return entity.labels?.en?.value || "";
      }

      next.push(...claimEntityValues(entity, "P131").map((value) => value.id).filter(Boolean));
    }
    frontier = next;
  }

  return "";
}

function isStateOrRegion(entity) {
  const instanceOf = new Set(claimEntityValues(entity, "P31").map((value) => value.id).filter(Boolean));
  const label = entity.labels?.en?.value || "";
  if (instanceOf.has("Q35657") || instanceOf.has("Q107390")) return true;
  if (/^(California|Colorado|Georgia|New York|Texas|Oregon|Washington|Illinois|Tennessee)$/i.test(label)) return true;
  return false;
}

function shouldSkipEntity(entity) {
  const instanceOf = new Set(claimEntityIds(entity, "P31"));
  const description = entity.descriptions?.en?.value?.toLowerCase() || "";
  if (instanceOf.has("Q18127") || description.includes("record label")) return true;
  return false;
}

function urlClaims(entity) {
  return claimValues(entity, "P856").map((url) => ({
    type: "official",
    label: "Official",
    url,
    confidence: "likely",
    source: "wikidata"
  }));
}

function idClaims(entity) {
  const links = [];
  for (const [property, config] of Object.entries(ID_LINKS)) {
    for (const id of claimValues(entity, property)) {
      links.push({
        type: config.type,
        label: config.label,
        url: config.url(id),
        confidence: "likely",
        source: "wikidata"
      });
    }
  }
  return links;
}

function wikipediaLink(entity) {
  const title = entity.sitelinks?.enwiki?.title;
  if (!title) return [];
  return [{
    type: "wikipedia",
    label: "Wikipedia",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
    confidence: "likely",
    source: "wikidata"
  }];
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

function addEvidence(artist, url, note) {
  artist.evidence ||= [];
  if (artist.evidence.some((item) => item.url === url && item.note === note)) return;
  artist.evidence.push({ url, note });
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const candidates = Object.values(store.artists)
  .filter((artist) => matchesArtistFilter(artist, onlyArtist))
  .filter((artist) => onlyArtist || !artist.links?.some((link) => link.type === "wikidata"))
  .slice(0, limit);

let enriched = 0;

for (const artist of candidates) {
  try {
    const rejected = rejectedExternalIdsFromLinks(artist.links || []);
    const externalMatch = await findEntityFromExistingLinks(artist);
    const searchName = artistSearchName(artist);
    const search = externalMatch || await searchEntity(searchName);
    if (!search?.id || rejected.has(`wikidata:${search.id}`)) {
      await sleep(400);
      continue;
    }

    const entity = await getEntity(search.id);
    if (!entity || shouldSkipEntity(entity)) {
      await sleep(400);
      continue;
    }

    const wikidataUrl = `https://www.wikidata.org/wiki/${search.id}`;
    const incomingLinks = [
      {
        type: "wikidata",
        label: "Wikidata",
        url: wikidataUrl,
        confidence: "likely",
        source: "wikidata"
      },
      ...urlClaims(entity),
      ...idClaims(entity),
      ...wikipediaLink(entity)
    ];

    artist.links = mergeLinks(artist.links, incomingLinks);
    rejectSupersededImportedCandidates(artist);
    artist.summary ||= entity.descriptions?.en?.value || "";
    const locality = await localityFromWikidata(entity);
    if (shouldUpgradeLocality(artist.locality, locality)) {
      artist.locality = locality;
      addEvidence(artist, wikidataUrl, "Locality inferred from Wikidata formation/origin fields.");
    }
    artist.confidence = artist.confidence === "review" ? "likely" : artist.confidence;
    const evidenceNote = externalMatch
      ? `Wikidata entity ${search.id} matched an existing ${externalMatch.via.type} artist identifier for "${artist.name}".`
      : `Wikidata entity ${search.id} exactly matched the artist name "${searchName}" and supplied structured external identifiers.`;
    addEvidence(artist, wikidataUrl, evidenceNote);
    enriched += 1;
  } catch (error) {
    console.warn(`Skipped ${artist.name}: ${error.message}`);
  }
  await sleep(400);
}

store.generatedAt = new Date().toISOString();
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");

console.log(`Wikidata enriched ${enriched} of ${candidates.length} checked artists.`);

function rejectSupersededImportedCandidates(artist) {
  const trustedTypes = new Set(
    (artist.links || [])
      .filter((link) => link.confidence === "likely" || link.confidence === "verified")
      .map((link) => link.type)
  );

  for (const link of artist.links || []) {
    if (link.source === "imported" && link.confidence === "candidate" && trustedTypes.has(link.type)) {
      link.confidence = "rejected";
      link.reviewNote = "Superseded by a structured likely/verified link of the same type.";
    }
  }
}
