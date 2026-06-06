import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const USER_AGENT = "BayAreaShowExplorer/0.1";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const onlyArtist = args.get("artist") || "";
const limit = Number(args.get("limit") || 50);

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

function normalizeName(name = "") {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function artistReviewNames(artist) {
  return [
    artist.name,
    artist.displayName,
    ...(artist.aliases || [])
  ].filter(Boolean);
}

function matchesArtistFilter(artist, filter) {
  if (!filter) return true;
  const wanted = normalizeName(filter);
  return artistReviewNames(artist).some((value) => normalizeName(value) === wanted);
}

function discogsId(url = "") {
  return url.match(/discogs\.com\/artist\/(\d+)/i)?.[1] || "";
}

async function fetchDiscogsArtist(id) {
  const response = await fetch(`https://api.discogs.com/artists/${id}`, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function classifyDiscogsLink(artist, discogs) {
  const artistNames = artistReviewNames(artist).map(normalizeName);
  const discogsName = normalizeName(discogs.name);
  const realName = normalizeName(discogs.realname);

  if (artistNames.includes(discogsName)) return "discogsArtist";
  if (realName && artistNames.includes(realName)) return "discogsLegalName";
  return "discogsAlias";
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const artists = Object.values(store.artists || {})
  .filter((artist) => matchesArtistFilter(artist, onlyArtist));

let checked = 0;
let changed = 0;

for (const artist of artists) {
  for (const link of artist.links || []) {
    if (!["discogs", "discogsArtist", "discogsAlias", "discogsLegalName"].includes(link.type)) continue;
    if (link.confidence === "rejected") continue;
    const id = discogsId(link.url);
    if (!id || checked >= limit) continue;

    checked += 1;
    try {
      const discogs = await fetchDiscogsArtist(id);
      if (!discogs) {
        link.confidence = "rejected";
        link.reviewNote = "Discogs API returned 404 for this artist ID.";
        changed += 1;
        continue;
      }

      const type = classifyDiscogsLink(artist, discogs);
      link.type = type;
      link.label = type === "discogsArtist" ? `Discogs: ${discogs.name}` : `${labelForDiscogsType(type)}: ${discogs.name}`;
      link.discogsName = discogs.name;
      if (discogs.realname) link.discogsRealName = discogs.realname;
      changed += 1;
    } catch (error) {
      console.warn(`Skipped ${artist.name} ${link.url}: ${error.message}`);
    }
  }
}

store.generatedAt = new Date().toISOString();
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");
console.log(`Discogs checked ${checked} links and updated ${changed}.`);

function labelForDiscogsType(type) {
  return {
    discogsArtist: "Discogs",
    discogsAlias: "Discogs Alias",
    discogsLegalName: "Discogs Legal Name"
  }[type] || "Discogs";
}
