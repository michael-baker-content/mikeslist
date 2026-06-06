import fs from "node:fs";
import vm from "node:vm";

const DATA_FILES = {
  artists: ["data/artists.js", "SHOW_EXPLORER_ARTISTS"],
  events: ["data/imported-events.js", "SHOW_EXPLORER_EVENTS"],
  venues: ["data/venues.js", "SHOW_EXPLORER_VENUES"]
};

const EVENT_TITLE_PATTERNS = [
  /\b(open house|listening party|drag show|storytelling|book event|poetry|reading|comedy|chess|trivia|karaoke)\b/i,
  /\b(written and performed by|a night of|party with|dance party)\b/i
];

const NON_MUSIC_EVENT_TYPES = new Set([
  "book",
  "chess",
  "comedy",
  "film",
  "poetry",
  "storytelling",
  "trivia"
]);

function loadWindowData(path, globalName) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path, "utf8"), sandbox, { filename: path });
  return sandbox.window[globalName];
}

function writeWindowData(path, globalName, data) {
  fs.writeFileSync(path, `window.${globalName} = ${JSON.stringify(data, null, 2)};\n`);
}

function normalizeId(text = "") {
  return text
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "and")
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/\b(music hall|theater|theatre|club|lounge|bar|cafe|café|restaurant|venue)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function slugifyArtist(text = "") {
  return text
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "and")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeArtistName(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "and")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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
      const normalized = normalizeArtistName(value);
      if (normalized) index.set(normalized, artist);
    }
  }
  return index;
}

function cleanText(text = "") {
  return String(text)
    .replace(/&amp;|&#038;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingTime(text = "") {
  return cleanText(text).replace(/^\d{1,2}(?::\d{2})?\s*(?:am|pm)\b\s*[-:–—]?\s*/i, "").trim();
}

function contextNotesForProgramTail(text = "") {
  const value = cleanText(text);
  const notes = [];
  const parenTribute = value.match(/\(([^)]*\btribute\b[^)]*)\)\s*$/i);
  if (parenTribute) notes.push(cleanText(parenTribute[1]));
  const dashTribute = value.match(/\s*[-–—]\s*((?:tribute|tribute to)\s+.+)$/i);
  if (dashTribute) notes.push(cleanText(dashTribute[1]));
  return [...new Set(notes.map((note) => note.replace(/^tribute\b/i, "Tribute").trim()))];
}

function stripProgramTail(text = "") {
  return cleanText(text)
    .replace(/\s*\([^)]*(?:music of|birthday|tribute|program|show|night)[^)]*\)\s*$/i, "")
    .replace(/\s*:\s+.+$/, "")
    .replace(/\s*[-–—]\s*(?:on|a night of|an evening of|music of|tribute|tribute to)\s+.+$/i, "")
    .replace(/\s+(?:plays|performs)\s+the\s+music\s+of\s+.+$/i, "")
    .replace(/\s+conducts\s+.+$/i, "")
    .trim();
}

function hasProgramContextBeforeWith(text = "") {
  return /\b(party|sessions?|showcase|festival|fest|benefit|presents?|presented by|open mic|tribute|night)\b/i.test(text);
}

function extractPresenterName(text = "") {
  const match = cleanText(text).match(/^(.+?)\s+presents?\s*:/i);
  return match ? stripProgramTail(stripLeadingTime(match[1])) : "";
}

function extractPrefixedArtistName(text = "") {
  const match = cleanText(text).match(/^(?:new date|rescheduled|postponed|cancelled|canceled)\s*:\s*(.+)$/i);
  return match ? stripProgramTail(stripLeadingTime(match[1])) : "";
}

function extractDjName(text = "") {
  const match = cleanText(text).match(/\bw\/\s*(dj\s+[^()]+)(?:\s*\(([^)]+)\))?/i);
  if (!match) return "";
  return cleanText([match[1], match[2]].filter(Boolean).join(" "));
}

function extractFeaturedName(text = "") {
  const value = cleanText(text);
  const featuringMatch = value.match(/\b(?:featuring|feat\.?)\s+(.+)$/i);
  if (featuringMatch) return stripProgramTail(stripLeadingTime(featuringMatch[1]));
  const withMatch = value.match(/^(.+?)\s+with\s+(.+)$/i);
  if (!withMatch || !hasProgramContextBeforeWith(withMatch[1])) return "";
  return stripProgramTail(stripLeadingTime(withMatch[2]));
}

function suggestedArtistDisplayName(artist) {
  const name = cleanText(artist.name || artist.displayName || "");
  const priorityCandidate = [
    extractPrefixedArtistName(name),
    extractPresenterName(name),
    extractDjName(name)
  ].find(Boolean);
  const candidates = [
    priorityCandidate,
    stripProgramTail(stripLeadingTime(name)),
    extractFeaturedName(name)
  ].filter(Boolean);

  const best = priorityCandidate && priorityCandidate.toLowerCase() !== name.toLowerCase()
    ? priorityCandidate
    : candidates
    .filter((candidate) => candidate.length >= 3 && candidate.toLowerCase() !== name.toLowerCase())
    .sort((a, b) => a.length - b.length)[0];

  if (!best) return null;
  const reasons = [];
  const contextNotes = contextNotesForProgramTail(name);
  if (stripLeadingTime(name) !== name) reasons.push("Removed leading set time.");
  if (extractPrefixedArtistName(name)) reasons.push("Removed scheduling prefix.");
  if (extractPresenterName(name)) reasons.push("Kept presenter name before Presents.");
  if (extractDjName(name)) reasons.push("Extracted DJ name from recurring event text.");
  if (extractFeaturedName(name)) reasons.push("Extracted performer name after featuring/with.");
  if (stripProgramTail(stripLeadingTime(name)) !== stripLeadingTime(name)) reasons.push("Removed program subtitle or parenthetical context.");
  return {
    kind: "artist-display-name",
    field: "displayName",
    suggestedValue: best,
    contextNotes,
    confidence: reasons.length > 1 ? "medium" : "low",
    reasons
  };
}

function withArtistRecordStatus(suggestion, artistIndex) {
  if (!suggestion || suggestion.kind !== "artist-display-name") return suggestion;
  const fallbackId = slugifyArtist(suggestion.suggestedValue || "");
  const match = artistIndex.get(normalizeArtistName(suggestion.suggestedValue));
  return {
    ...suggestion,
    artistRecordStatus: match ? "exists" : "missing",
    artistRecordId: match?.id || fallbackId
  };
}

function isArtistShow(event) {
  if (event.showType === "artist" || event.showType === "event") return event.showType === "artist";
  return (event.artists || []).length > 0;
}

function suggestedEventType(event) {
  if (!isArtistShow(event) || !(event.artists || []).length) return null;
  const artistText = (event.artists || []).map((artist) => artist.displayName || artist.name).join(" / ");
  const hasNonMusicType = (event.eventTypes || []).some((type) => NON_MUSIC_EVENT_TYPES.has(type));
  const hasEventTitlePattern = EVENT_TITLE_PATTERNS.some((pattern) => pattern.test(artistText));
  if (!hasNonMusicType && !hasEventTitlePattern) return null;

  return {
    kind: "show-type",
    field: "showType",
    suggestedValue: "event",
    title: cleanText(event.title || event.displayName || artistText),
    confidence: hasNonMusicType ? "medium" : "low",
    reasons: [
      hasNonMusicType ? "Event has a non-music event type." : "Artist text looks like an event/program title.",
      "Move the text to the show title and keep artists empty if confirmed."
    ]
  };
}

function suggestedSourceDedupe(event) {
  const sources = [...(event.sources || [])].filter(Boolean);
  if (sources.length < 2) return null;
  const seen = new Set();
  const unique = [];
  for (const source of sources) {
    const key = `${source.name || ""}|${source.url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  if (unique.length === sources.length) return null;
  return {
    kind: "source-dedupe",
    field: "sources",
    suggestedValue: unique,
    confidence: "high",
    reasons: ["Removed duplicate source entries with the same name and URL."]
  };
}

function suggestedVenueMerges(venues) {
  const buckets = new Map();
  for (const venue of Object.values(venues)) {
    if (venue.mergedInto) continue;
    const key = normalizeId(venue.displayName || venue.name || venue.id);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(venue);
  }

  const suggestions = {};
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const canonical = [...bucket].sort((a, b) => {
      const scoreA = Number(a.confidence === "verified") + Number((a.links || []).length > 0) + Number(Boolean(a.geo?.latitude));
      const scoreB = Number(b.confidence === "verified") + Number((b.links || []).length > 0) + Number(Boolean(b.geo?.latitude));
      return scoreB - scoreA || (a.displayName || a.name).localeCompare(b.displayName || b.name);
    })[0];
    for (const venue of bucket) {
      if (venue.id === canonical.id) continue;
      suggestions[venue.id] = suggestions[venue.id] || [];
      suggestions[venue.id].push({
        kind: "venue-merge",
        field: "mergedInto",
        suggestedValue: canonical.id,
        confidence: "low",
        reasons: [`Venue normalizes to the same name as ${canonical.displayName || canonical.name}.`]
      });
    }
  }
  return suggestions;
}

function addSuggestion(target, id, suggestion) {
  if (!suggestion) return;
  target[id] = target[id] || [];
  target[id].push(suggestion);
}

function main() {
  const artistsStore = loadWindowData(...DATA_FILES.artists);
  const events = loadWindowData(...DATA_FILES.events);
  const venuesStore = loadWindowData(...DATA_FILES.venues);
  const artistIndex = artistNameIndex(artistsStore.artists || {});

  const suggestions = {
    generatedAt: new Date().toISOString(),
    summary: {},
    artists: {},
    events: {},
    venues: {}
  };

  for (const artist of Object.values(artistsStore.artists || {})) {
    if (artist.displayName) continue;
    addSuggestion(suggestions.artists, artist.id, withArtistRecordStatus(suggestedArtistDisplayName(artist), artistIndex));
  }

  for (const event of events) {
    addSuggestion(suggestions.events, event.id, suggestedEventType(event));
    addSuggestion(suggestions.events, event.id, suggestedSourceDedupe(event));
  }

  suggestions.venues = suggestedVenueMerges(venuesStore.venues || {});
  suggestions.summary = {
    artistRecords: Object.keys(suggestions.artists).length,
    eventRecords: Object.keys(suggestions.events).length,
    venueRecords: Object.keys(suggestions.venues).length,
    totalSuggestions: [
      ...Object.values(suggestions.artists),
      ...Object.values(suggestions.events),
      ...Object.values(suggestions.venues)
    ].reduce((total, rows) => total + rows.length, 0)
  };

  writeWindowData("data/review-suggestions.js", "SHOW_EXPLORER_REVIEW_SUGGESTIONS", suggestions);
  console.log(JSON.stringify(suggestions.summary, null, 2));
}

main();
