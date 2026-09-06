import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const SUGGESTIONS_PATH = new URL("../data/review-suggestions.js", import.meta.url);

function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "and")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeName(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "and")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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

async function writeWindowData(path, globalName, data) {
  await writeFile(path, `window.${globalName} = ${JSON.stringify(data, null, 2)};\n`, "utf8");
}

function artistNameIndex(artists = {}) {
  const index = new Map();
  for (const artist of Object.values(artists)) {
    for (const value of [
      artist.id,
      artist.name,
      artist.displayName,
      ...(artist.aliases || [])
    ]) {
      const normalized = normalizeName(value);
      if (normalized) index.set(normalized, artist);
    }
  }
  return index;
}

function sourceTagForArtist(artist) {
  const linkSource = (artist.links || []).find((link) => link.source)?.source;
  if (linkSource) return linkSource;
  const sourceUrl = artist.source?.appearances?.find((appearance) => appearance.sourceUrl)?.sourceUrl || "";
  if (sourceUrl.includes("kalx.berkeley.edu")) return "kalx";
  if (sourceUrl.includes("jon.luini.com")) return "the-list";
  return "suggestion";
}

function searchLinkFor(name, source) {
  return {
    type: "search",
    label: "Search",
    url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" band music`)}`,
    confidence: "research",
    source
  };
}

function uniqueAppearances(appearances = []) {
  const seen = new Set();
  return appearances.filter((appearance) => {
    const key = [
      appearance.eventId,
      appearance.date,
      appearance.venue,
      appearance.sourceUrl
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reviewNoteFor(sourceArtist, suggestion) {
  const notes = [
    `Extracted from event-style artist listing "${sourceArtist.name}".`,
    `Suggested performer name: ${suggestion.suggestedValue}.`
  ];
  if ((suggestion.contextNotes || []).length) {
    notes.push(`Context note: ${suggestion.contextNotes.join("; ")}.`);
  }
  notes.push("Review before publishing.");
  return notes.join(" ");
}

function createArtistRecord(sourceArtist, suggestion, now) {
  const name = suggestion.suggestedValue;
  const source = sourceTagForArtist(sourceArtist);
  return {
    id: slugify(name),
    name,
    displayName: "",
    aliases: [],
    genres: ["unknown"],
    locality: "unknown",
    confidence: "review",
    summary: "",
    disambiguation: "",
    reviewNotes: reviewNoteFor(sourceArtist, suggestion),
    supportPriority: [],
    links: [searchLinkFor(name, source)],
    evidence: [],
    source: {
      firstSeenAt: sourceArtist.source?.firstSeenAt || now,
      lastImportedAt: now,
      appearances: uniqueAppearances(sourceArtist.source?.appearances || [])
    }
  };
}

function displayNameSuggestions(suggestions = {}) {
  return Object.entries(suggestions.artists || {}).flatMap(([sourceArtistId, rows]) => {
    return rows
      .filter((row) => row.kind === "artist-display-name" && row.suggestedValue)
      .map((row) => ({ sourceArtistId, suggestion: row }));
  });
}

const artistsStore = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", {
  generatedAt: "",
  artists: {}
});
const suggestions = await readWindowData(SUGGESTIONS_PATH, "SHOW_EXPLORER_REVIEW_SUGGESTIONS", {
  artists: {}
});

const now = new Date().toISOString();
const artists = { ...(artistsStore.artists || {}) };
const index = artistNameIndex(artists);
const created = [];
const skipped = [];

for (const { sourceArtistId, suggestion } of displayNameSuggestions(suggestions)) {
  const sourceArtist = artists[sourceArtistId];
  if (!sourceArtist) {
    skipped.push({ name: suggestion.suggestedValue, reason: "source artist missing" });
    continue;
  }

  const normalized = normalizeName(suggestion.suggestedValue);
  const id = slugify(suggestion.suggestedValue);
  if (!normalized || artists[id] || index.has(normalized)) {
    skipped.push({ name: suggestion.suggestedValue, reason: "artist already exists" });
    continue;
  }

  const record = createArtistRecord(sourceArtist, suggestion, now);
  artists[record.id] = record;
  index.set(normalized, record);
  index.set(normalizeName(record.id), record);
  created.push({ id: record.id, name: record.name, sourceArtistId });
}

const payload = {
  generatedAt: now,
  artists: Object.fromEntries(Object.entries(artists).sort(([a], [b]) => a.localeCompare(b)))
};

await writeWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", payload);

console.log(JSON.stringify({
  created: created.length,
  skipped: skipped.length,
  createdArtists: created
}, null, 2));
