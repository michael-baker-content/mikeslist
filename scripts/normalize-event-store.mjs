import { readFile, writeFile } from "node:fs/promises";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const VENUES_PATH = new URL("../data/venues.js", import.meta.url);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const mergeDuplicates = args.has("--merge-duplicates");
const duplicateThreshold = Number(argValue("duplicate-threshold") || "0.6");
const fromDate = argValue("from") || "";
const toDate = argValue("to") || "";

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

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;|&#038;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value = "") {
  return decodeHtml(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function slugify(text) {
  return normalizeText(text).replace(/\s+/g, "-").replace(/^-|-$/g, "");
}

function cleanJoinedText(value = "") {
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return text;
  return uniqueList(parts).join(" / ");
}

function uniqueList(items = []) {
  const seen = new Set();
  return items.map(cleanJoinedText).filter((item) => {
    const key = normalizeText(item);
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeArtists(artists = []) {
  const merged = new Map();
  for (const artist of artists) {
    const key = normalizeText(artist.displayName || artist.name);
    if (!key) continue;
    const previous = merged.get(key);
    const cleanArtist = {
      ...artist,
      name: cleanJoinedText(artist.name),
      displayName: cleanJoinedText(artist.displayName || "")
    };
    merged.set(key, previous ? {
      ...previous,
      displayName: previous.displayName || cleanArtist.displayName || "",
      tags: uniqueList([...(previous.tags || []), ...(cleanArtist.tags || [])]),
      locality: previous.locality || cleanArtist.locality || "",
      confidence: higherConfidence(previous.confidence, cleanArtist.confidence),
      note: uniqueDetails(previous.note, cleanArtist.note),
      links: mergeLinks(previous.links || [], cleanArtist.links || [])
    } : cleanArtist);
  }
  return [...merged.values()];
}

function uniqueDetails(current = "", incoming = "") {
  const currentClean = cleanJoinedText(current);
  const incomingClean = cleanJoinedText(incoming);
  if (!currentClean) return incomingClean || "";
  if (!incomingClean || normalizeText(currentClean).includes(normalizeText(incomingClean))) return currentClean;
  if (normalizeText(incomingClean).includes(normalizeText(currentClean))) return incomingClean;
  return cleanJoinedText(`${currentClean} / ${incomingClean}`);
}

function mergeLinks(existing = [], incoming = []) {
  const links = new Map();
  [...existing, ...incoming].filter((link) => link?.url).forEach((link) => {
    const previous = links.get(link.url);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) links.set(link.url, { ...previous, ...link });
  });
  return [...links.values()];
}

function higherConfidence(current = "review", incoming = "review") {
  return confidenceRank(incoming) > confidenceRank(current) ? incoming : current;
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const venueStore = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
let changed = 0;

for (const event of events) {
  const before = JSON.stringify({
    title: event.title,
    displayName: event.displayName,
    details: event.details,
    mikesPick: event.mikesPick,
    infoUrl: event.infoUrl,
    imageUrl: event.imageUrl,
    venueId: event.venueId,
    artists: event.artists
  });

  event.title = cleanJoinedText(event.title || "");
  event.displayName = cleanJoinedText(event.displayName || "");
  event.details = cleanJoinedText(event.details || "");
  event.mikesPick = Boolean(event.mikesPick);
  event.infoUrl = String(event.infoUrl || "").trim();
  event.imageUrl = String(event.imageUrl || "").trim();
  event.eventTypes = uniqueList(event.eventTypes || []);
  event.themes = uniqueList(event.themes || []);
  event.artists = mergeArtists(event.artists || []);
  const resolvedVenue = resolvedVenueForEvent(event);
  if (resolvedVenue?.id && event.venueId !== resolvedVenue.id) event.venueId = resolvedVenue.id;

  const after = JSON.stringify({
    title: event.title,
    displayName: event.displayName,
    details: event.details,
    mikesPick: event.mikesPick,
    infoUrl: event.infoUrl,
    imageUrl: event.imageUrl,
    venueId: event.venueId,
    artists: event.artists
  });
  if (before !== after) changed += 1;
}

const duplicateMergeResult = mergeDuplicates ? mergeLikelyDuplicates(events) : { merged: 0, removedIds: [], groups: [] };

if (!dryRun) {
  await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(events, null, 2)};\n`, "utf8");
}

console.log(JSON.stringify({
  dryRun,
  normalizedRecords: changed,
  duplicateThreshold,
  fromDate,
  toDate,
  mergedDuplicates: duplicateMergeResult.merged,
  remainingEvents: events.length,
  duplicateGroups: duplicateMergeResult.groups.map((group) => ({
    target: eventTitle(group.target),
    date: group.target.date || "",
    venue: group.target.venue || "",
    merged: group.sources.map((event) => eventTitle(event))
  }))
}, null, 2));

function mergeLikelyDuplicates(list) {
  const groups = duplicateSuggestionGroups(list);
  const removedIds = new Set();
  let merged = 0;

  for (const group of groups) {
    const candidates = group.events.filter((event) => !removedIds.has(event.id));
    if (candidates.length < 2) continue;
    const [target, ...sources] = candidates.sort(compareCanonicalPreference);
    for (const source of sources) {
      mergeEventData(target, source);
      removedIds.add(source.id);
      merged += 1;
    }
    group.target = target;
    group.sources = sources;
  }

  if (removedIds.size) {
    const kept = list.filter((event) => !removedIds.has(event.id));
    list.splice(0, list.length, ...kept);
  }

  return {
    merged,
    removedIds: [...removedIds],
    groups: groups.filter((group) => group.sources?.length)
  };
}

function duplicateSuggestionGroups(list) {
  const buckets = new Map();
  for (const event of list.filter(matchesDuplicateDateWindow)) {
    const key = duplicateBucketKey(event);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  }

  return [...buckets.values()]
    .map((bucket) => likelyDuplicateGroup(bucket))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (a.events[0].date || "").localeCompare(b.events[0].date || ""));
}

function matchesDuplicateDateWindow(event) {
  if (fromDate && event.date < fromDate) return false;
  if (toDate && event.date > toDate) return false;
  return true;
}

function duplicateBucketKey(event) {
  const date = event.date || "";
  const venue = canonicalVenueKey(event);
  const type = showTypeForEvent(event);
  if (!date || !venue) return "";
  return `${date}|${venue}|${type}`;
}

function canonicalVenueKey(event) {
  const venue = resolvedVenueForEvent(event);
  if (venue) return venue.id || normalizeText(venue.displayName || venue.name || "");
  return normalizeText(event.venue || "");
}

function resolvedVenueForEvent(event) {
  return bestVenueMatch([
    venueByName(event.venue || ""),
    venueById(slugify(event.venue || "")),
    venueById(event.venueId)
  ]);
}

function venueById(id = "") {
  return id ? venueStore.venues?.[id] || null : null;
}

function venueByName(name = "") {
  const key = normalizeText(name);
  if (!key) return null;
  return Object.values(venueStore.venues || {}).find((venue) => {
    return [
      venue.name,
      venue.displayName,
      ...(venue.aliases || [])
    ].some((value) => normalizeText(value) === key);
  }) || null;
}

function resolveMergedVenue(venue) {
  if (!venue) return null;
  return venue.mergedInto && venueStore.venues?.[venue.mergedInto]
    ? venueStore.venues[venue.mergedInto]
    : venue;
}

function bestVenueMatch(matches = []) {
  return matches
    .map(resolveMergedVenue)
    .filter(Boolean)
    .sort((a, b) => venueMatchRank(b) - venueMatchRank(a))[0] || null;
}

function venueMatchRank(venue) {
  return confidenceRank(venue.confidence) * 10
    + Number(venue.status === "active") * 3
    + Number(Boolean(venue.displayName)) * 2
    + Number(Boolean(venue.address || venue.geo)) * 2;
}

function likelyDuplicateGroup(bucket) {
  if (bucket.length < 2) return null;
  const eventsWithTokens = bucket.map((event) => ({ event, tokens: eventTokens(event) }));
  const related = [];
  let bestScore = 0;

  for (let index = 0; index < eventsWithTokens.length; index += 1) {
    const current = eventsWithTokens[index];
    const matches = eventsWithTokens.filter((candidate, candidateIndex) => {
      if (candidateIndex === index) return false;
      const score = tokenOverlapScore(current.tokens, candidate.tokens);
      bestScore = Math.max(bestScore, score);
      return score >= duplicateThreshold;
    });
    if (matches.length) related.push(current.event, ...matches.map((match) => match.event));
  }

  const uniqueEvents = uniqueEventsById(related);
  if (uniqueEvents.length < 2) return null;
  return {
    score: bestScore,
    events: uniqueEvents.sort(compareCanonicalPreference)
  };
}

function eventTokens(event) {
  return new Set(normalizeText([
    eventTitle(event),
    event.details,
    ...(event.artists || []).map(artistDisplayName),
    ...(event.eventTypes || []),
    ...(event.themes || [])
  ].join(" ")).split(/\s+/).filter((token) => token.length > 2));
}

function tokenOverlapScore(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let overlap = 0;
  small.forEach((token) => {
    if (large.has(token)) overlap += 1;
  });
  return overlap / small.size;
}

function uniqueEventsById(items = []) {
  const seen = new Set();
  return items.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function compareCanonicalPreference(a, b) {
  return canonicalScore(b) - canonicalScore(a)
    || sourceNamesForEvent(a).join(", ").localeCompare(sourceNamesForEvent(b).join(", "))
    || eventTitle(a).localeCompare(eventTitle(b));
}

function canonicalScore(event) {
  return Number(Boolean(event.displayName)) * 8
    + Number((event.sources || []).length > 1) * 6
    + Number((event.artists || []).length) * 4
    + Number((event.eventTypes || []).length) * 2
    + Number((event.themes || []).length)
    + sourceNamesForEvent(event).length;
}

function eventTitle(event) {
  return cleanJoinedText(event.displayName)
    || cleanJoinedText(event.title)
    || cleanJoinedText((event.artists || []).map(artistDisplayName).join(", "))
    || cleanJoinedText(event.details)
    || "Untitled event";
}

function artistDisplayName(artist) {
  return cleanJoinedText(artist.displayName || artist.name || "");
}

function mergeEventData(target, source) {
  target.showType = showTypeForEvent(target);
  target.displayName = preferredShowText(target.displayName, source.displayName);
  target.title = preferredShowText(target.title, source.title);
  target.details = uniqueDetails(target.details, source.details);
  target.eventDescription = uniqueDetails(target.eventDescription, source.eventDescription);
  target.mikesPick = Boolean(target.mikesPick || source.mikesPick);
  target.eventTypes = uniqueList([...(target.eventTypes || []), ...(source.eventTypes || [])]);
  target.themes = uniqueList([...(target.themes || []), ...(source.themes || [])]);
  target.artists = mergeArtists([...(target.artists || []), ...(source.artists || [])]);
  target.sources = mergeSources(target.sources || [], [
    ...(source.sources || []),
    source.source,
    target.source
  ].filter(Boolean));
  target.source ||= target.sources[0] || source.source;
  if (!target.sourceUrl && source.sourceUrl) target.sourceUrl = source.sourceUrl;
  target.infoUrl ||= source.infoUrl || "";
  target.imageUrl ||= source.imageUrl || "";
  target.imageSource ||= source.imageSource || "";
  target.city ||= source.city || "";
  target.region ||= source.region || "";
  target.time ||= source.time || "";
  target.price ||= source.price || "";
}

function mergeSources(existing, incoming) {
  const sources = new Map();
  for (const source of [...existing, ...incoming].filter(Boolean)) {
    if (!source.url) continue;
    const normalized = {
      ...source,
      name: sourceNameForUrl(source.url, source.name)
    };
    sources.set(`${normalized.name}|${normalized.url}`, normalized);
  }
  return [...sources.values()];
}

function sourceNamesForEvent(event) {
  const sources = [...(event.sources || []), event.source].filter(Boolean);
  return [...new Set(sources.map((source) => sourceNameForUrl(source.url, source.name)).filter(Boolean))];
}

function sourceNameForUrl(url, fallback = "Source") {
  const normalized = String(url || "").toLowerCase();
  if (normalized.includes("kalx.berkeley.edu")) return "KALX";
  if (normalized.includes("badslava.com")) return "BadSlava";
  if (normalized.includes("jon.luini.com") || normalized.includes("thelist")) return "The List";
  return fallback && fallback !== "Source" ? fallback : "Source";
}

function preferredShowText(current = "", incoming = "") {
  const currentClean = cleanJoinedText(current);
  const incomingClean = cleanJoinedText(incoming);
  if (!currentClean) return incomingClean;
  if (!incomingClean) return currentClean;
  if (normalizeText(currentClean).includes(normalizeText(incomingClean))) return currentClean;
  if (normalizeText(incomingClean).includes(normalizeText(currentClean))) return incomingClean;
  return currentClean;
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = [...args].find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}
