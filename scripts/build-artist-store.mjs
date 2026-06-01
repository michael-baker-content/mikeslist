import { readFile, writeFile } from "node:fs/promises";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
    const typed = normalizeLink(link);
    const next = {
      type: typed.type,
      label: typed.label,
      url: typed.url,
      confidence: typed.confidence,
      source: typed.source
    };
    const previous = links.get(link.url);
    if (previous?.confidence === "rejected" && next.source === "imported") {
      continue;
    }
    if (!previous || confidenceRank(next.confidence) > confidenceRank(previous.confidence)) {
      links.set(link.url, next);
    }
  }
  return [...links.values()];
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function normalizeLink(link) {
  const url = link.url || "";
  const type = link.type || inferLinkType(url);
  const confidence = type === "search" && link.confidence === "candidate" ? "research" : link.confidence || (type === "search" ? "research" : "candidate");
  return {
    type,
    label: link.label || labelForType(type),
    url,
    confidence,
    source: link.source || "imported"
  };
}

function inferLinkType(url) {
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
  if (lower.includes("wikipedia.org")) return "wikipedia";
  if (lower.includes("music.apple.com")) return "appleMusic";
  if (lower.includes("music.amazon.com")) return "amazonMusic";
  if (lower.includes("ticketmaster.com")) return "ticketmaster";
  if (lower.includes("qobuz.com")) return "qobuz";
  if (lower.includes("deezer.com")) return "deezer";
  if (lower.includes("tidal.com")) return "tidal";
  if (lower.includes("wikidata.org")) return "wikidata";
  if (lower.includes("duckduckgo.com") || lower.includes("google.com/search")) return "search";
  return "official";
}

function labelForType(type) {
  const labels = {
    bandcamp: "Bandcamp",
    official: "Official",
    linktree: "Linktree",
    instagram: "Instagram",
    facebook: "Facebook",
    twitter: "X/Twitter",
    tiktok: "TikTok",
    musicbrainz: "MusicBrainz",
    youtube: "YouTube",
    youtubeMusic: "YouTube Music",
    soundcloud: "SoundCloud",
    discogs: "Discogs",
    discogsArtist: "Discogs Artist",
    discogsAlias: "Discogs Alias",
    discogsLegalName: "Discogs Legal Name",
    wikipedia: "Wikipedia",
    appleMusic: "Apple Music",
    amazonMusic: "Amazon Music",
    ticketmaster: "Ticketmaster",
    qobuz: "Qobuz",
    deezer: "Deezer",
    tidal: "Tidal",
    wikidata: "Wikidata",
    spotify: "Spotify",
    search: "Search"
  };
  return labels[type] || "Link";
}

function eventSummary(event) {
  return {
    eventId: event.id,
    date: event.date,
    venue: event.venue,
    details: event.details,
    sourceUrl: event.sourceUrl
  };
}

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const existing = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", {
  generatedAt: "",
  artists: {}
});

const artists = {};

for (const event of events) {
  for (const artist of event.artists || []) {
    const id = slugify(artist.name);
    const previous = existing.artists?.[id] || {};
    const current = artists[id] || {
      id,
      name: previous.name || artist.name,
      aliases: previous.aliases || [],
      genres: previous.genres || previous.tags || artist.tags || [],
      locality: previous.locality || artist.locality || "unknown",
      confidence: previous.confidence || artist.confidence || "review",
      summary: previous.summary || "",
      disambiguation: previous.disambiguation || "",
      reviewNotes: previous.reviewNotes || previous.note || artist.note || "",
      supportPriority: supportPriorityForLinks(previous.links || []),
      links: previous.links || [],
      evidence: previous.evidence || [],
      source: {
        firstSeenAt: previous.source?.firstSeenAt || new Date().toISOString(),
        lastImportedAt: "",
        appearances: []
      }
    };

    current.links = mergeLinks(current.links, artist.links || []);
    current.source.lastImportedAt = new Date().toISOString();
    current.source.appearances.push(eventSummary(event));
    artists[id] = current;
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  artists: Object.fromEntries(Object.entries({
    ...(existing.artists || {}),
    ...artists
  }).sort(([a], [b]) => a.localeCompare(b)))
};

await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");

console.log(`Built ${Object.keys(payload.artists).length} artist records at ${ARTISTS_PATH.pathname}`);

function supportPriorityForLinks(links) {
  const verifiedTypes = [...new Set(links
    .filter((link) => link.confidence === "verified")
    .map((link) => link.type)
    .filter(Boolean))];
  return verifiedTypes.sort((a, b) => {
    return priorityBucket(a) - priorityBucket(b) || labelForType(a).localeCompare(labelForType(b));
  });
}

function priorityBucket(type) {
  if (type === "official") return 0;
  if (type === "linktree") return 1;
  return 2;
}
