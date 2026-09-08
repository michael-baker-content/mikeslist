import { writeTextFile } from "./file-io.mjs";
import {
  DEFAULT_DB_PATH,
  argValue,
  json,
  openDatabase,
  parseJson,
  showTypeForEvent
} from "./sqlite-store.mjs";

const dbPath = argValue("db", DEFAULT_DB_PATH);
const dryRun = process.argv.includes("--dry-run");
const db = openDatabase(dbPath);

const events = exportShows(db);
const artists = exportArtists(db);
const venues = exportVenues(db);
const publicArtists = publicArtistPayload(artists);

if (!dryRun) {
  await writeTextFile(new URL("../data/imported-events.js", import.meta.url), `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(events, null, 2)};\n`, "utf8");
  await writeTextFile(new URL("../data/artists.js", import.meta.url), `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(artists, null, 2)};\n`, "utf8");
  await writeTextFile(new URL("../data/public-artists.js", import.meta.url), `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(publicArtists)};\n`, "utf8");
  await writeTextFile(new URL("../data/venues.js", import.meta.url), `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(venues, null, 2)};\n`, "utf8");
}

db.close();

console.log(JSON.stringify({
  database: dbPath,
  dryRun,
  exported: {
    events: events.length,
    artists: Object.keys(artists.artists).length,
    venues: Object.keys(venues.venues).length,
    publicArtists: Object.keys(publicArtists.artists).length
  }
}, null, 2));

function exportShows(db) {
  const rows = db.prepare("SELECT * FROM shows ORDER BY event_date, id").all();
  const slots = groupedRows(db.prepare("SELECT * FROM show_artist_slots ORDER BY show_id, billing_order").all(), "show_id");
  const sources = groupedRows(db.prepare("SELECT * FROM show_sources ORDER BY show_id, source_name").all(), "show_id");
  return rows.map((row) => {
    const event = {
      ...parseJson(row.raw_json, {}),
      id: row.id,
      status: row.status,
      showType: row.show_type,
      date: row.event_date,
      venueId: row.venue_id || "",
      venue: row.venue_name_snapshot || "",
      title: row.title || "",
      displayName: row.display_name || "",
      details: row.details || "",
      eventDescription: row.event_description || "",
      infoUrl: row.info_url || "",
      imageUrl: row.image_url || "",
      imageSource: row.image_source || "",
      mikesPick: Boolean(row.mikes_pick),
      manuallyReviewed: Boolean(row.manually_reviewed),
      manuallyReviewedAt: row.manually_reviewed_at || ""
    };
    event.artists = (slots.get(row.id) || []).map((slot) => ({
      ...parseJson(slot.raw_json, {}),
      name: slot.name_snapshot,
      role: slot.role || "unknown",
      status: slot.status || "scheduled"
    }));
    event.sources = (sources.get(row.id) || []).map((source) => ({
      name: source.source_name,
      url: source.source_url || ""
    }));
    return event;
  });
}

function exportArtists(db) {
  const rows = db.prepare("SELECT * FROM artists ORDER BY id").all();
  const aliases = groupedRows(db.prepare("SELECT * FROM artist_aliases ORDER BY artist_id, alias").all(), "artist_id");
  const genres = groupedRows(db.prepare("SELECT * FROM artist_genres ORDER BY artist_id, genre").all(), "artist_id");
  const links = groupedRows(db.prepare("SELECT * FROM artist_links ORDER BY artist_id, type, label").all(), "artist_id");
  return {
    generatedAt: new Date().toISOString(),
    artists: Object.fromEntries(rows.map((row) => [row.id, {
      ...parseJson(row.raw_json, {}),
      id: row.id,
      name: row.name,
      displayName: row.display_name || "",
      aliases: (aliases.get(row.id) || []).map((alias) => alias.alias),
      genres: (genres.get(row.id) || []).map((genre) => genre.genre),
      locality: row.locality || "",
      imageUrl: row.image_url || "",
      imageSource: row.image_source || "",
      spotifyImageUrl: row.spotify_image_url || "",
      confidence: row.confidence || "",
      summary: row.summary || "",
      disambiguation: row.disambiguation || "",
      reviewNotes: row.review_notes || "",
      manuallyReviewed: Boolean(row.manually_reviewed),
      manuallyReviewedAt: row.manually_reviewed_at || "",
      links: (links.get(row.id) || []).map((link) => ({
        type: link.type || "",
        label: link.label || "",
        url: link.url,
        confidence: link.confidence || "",
        source: link.source || "",
        displayPriority: link.display_priority || ""
      }))
    }]))
  };
}

function exportVenues(db) {
  const rows = db.prepare("SELECT * FROM venues ORDER BY id").all();
  const aliases = groupedRows(db.prepare("SELECT * FROM venue_aliases ORDER BY venue_id, alias").all(), "venue_id");
  const links = groupedRows(db.prepare("SELECT * FROM venue_links ORDER BY venue_id, type, label").all(), "venue_id");
  return {
    generatedAt: new Date().toISOString(),
    venues: Object.fromEntries(rows.map((row) => [row.id, {
      ...parseJson(row.raw_json, {}),
      id: row.id,
      name: row.name,
      displayName: row.display_name || "",
      aliases: (aliases.get(row.id) || []).map((alias) => alias.alias),
      mergedInto: row.merged_into || "",
      confidence: row.confidence || "",
      status: row.status || "",
      venueType: row.venue_type || "",
      city: row.city || "",
      region: row.region || "",
      address: row.address || "",
      imageUrl: row.image_url || "",
      imageSource: row.image_source || "",
      geo: row.latitude == null || row.longitude == null ? undefined : { lat: row.latitude, lng: row.longitude },
      agePolicy: row.age_policy || "",
      capacity: row.capacity ?? "",
      reviewNotes: row.review_notes || "",
      manuallyReviewed: Boolean(row.manually_reviewed),
      manuallyReviewedAt: row.manually_reviewed_at || "",
      links: (links.get(row.id) || []).map((link) => ({
        type: link.type || "",
        label: link.label || "",
        url: link.url,
        confidence: link.confidence || "",
        source: link.source || ""
      }))
    }]))
  };
}

function publicArtistPayload(artistPayload) {
  return {
    generatedAt: new Date().toISOString(),
    artists: Object.fromEntries(Object.entries(artistPayload.artists).map(([id, artist]) => [id, {
      id,
      name: artist.name || "",
      displayName: artist.displayName || "",
      aliases: artist.aliases || [],
      genres: artist.genres || artist.tags || [],
      locality: artist.locality || "",
      imageUrl: artist.imageUrl || "",
      imageSource: artist.imageSource || "",
      spotifyImageUrl: artist.spotifyLookupDisabled ? "" : artist.spotifyImageUrl || "",
      summary: artist.summary || "",
      links: (artist.links || []).filter((link) => shouldPublishArtistLink(link)),
      supportPriority: artist.supportPriority || []
    }]))
  };
}

function shouldPublishArtistLink(link) {
  if (!link?.url) return false;
  if (link.type === "search") return false;
  if (link.confidence === "rejected") return false;
  return true;
}

function groupedRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const groupKey = row[key];
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  return groups;
}
