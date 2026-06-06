import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const PUBLIC_ARTISTS_PATH = new URL("../data/public-artists.js", import.meta.url);

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

function publicArtistRecord(artist) {
  return {
    id: artist.id,
    name: artist.name,
    displayName: artist.displayName || "",
    aliases: cleanList(artist.aliases),
    genres: cleanList(artist.genres || artist.tags).filter((item) => item !== "unknown"),
    locality: artist.locality && artist.locality !== "unknown" ? artist.locality : "",
    imageUrl: artist.imageUrl || "",
    summary: artist.summary || "",
    links: publicLinks(artist.links || []),
    supportPriority: cleanList(artist.supportPriority)
  };
}

function cleanList(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function publicLinks(links) {
  return links
    .filter((link) => {
      if (!link?.url || link.confidence === "rejected" || link.display === false) return false;
      if (link.type === "search" || link.confidence === "research") return false;
      return true;
    })
    .map((link) => ({
      type: link.type || "official",
      label: link.label || "",
      url: link.url,
      confidence: link.confidence || "candidate",
      displayPriority: link.displayPriority || ""
    }));
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { generatedAt: "", artists: {} });
const publicArtists = Object.fromEntries(
  Object.entries(store.artists || {})
    .map(([id, artist]) => [id, publicArtistRecord(artist)])
    .sort(([a], [b]) => a.localeCompare(b))
);

const payload = {
  generatedAt: store.generatedAt || new Date().toISOString(),
  artists: publicArtists
};

await writeFile(PUBLIC_ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(payload)};\n`, "utf8");

console.log(`Built ${Object.keys(publicArtists).length} public artist records at ${PUBLIC_ARTISTS_PATH.pathname}`);
