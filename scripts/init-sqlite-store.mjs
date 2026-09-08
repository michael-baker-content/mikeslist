import { mkdir } from "node:fs/promises";
import {
  DEFAULT_DB_PATH,
  applySchema,
  argValue,
  eventTitle,
  fingerprint,
  json,
  nowIso,
  openDatabase,
  readWindowData,
  showTypeForEvent,
  slugify,
  sourceNameForEvent
} from "./sqlite-store.mjs";

const dbPath = argValue("db", DEFAULT_DB_PATH);
const reset = process.argv.includes("--reset");
const generatedAt = nowIso();

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const VENUES_PATH = new URL("../data/venues.js", import.meta.url);

await mkdir(new URL("../data", import.meta.url), { recursive: true });

const db = openDatabase(dbPath);
if (reset) dropKnownTables(db);
await applySchema(db);

const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
const artistStore = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
const venueStore = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });

let stats;
db.exec("BEGIN");
try {
  const artistCount = importArtists(db, artistStore.artists || {}, generatedAt);
  const venueCount = importVenues(db, venueStore.venues || {}, generatedAt);
  const showCount = importShows(db, events, generatedAt);

  db.prepare(`
    INSERT INTO metadata (key, value)
    VALUES ('last_js_import_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(generatedAt);

  stats = { artists: artistCount, venues: venueCount, shows: showCount };
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

db.close();

console.log(JSON.stringify({
  database: dbPath,
  reset,
  imported: stats
}, null, 2));

function dropKnownTables(db) {
  db.exec(`
    DROP TABLE IF EXISTS suppressed_imports;
    DROP TABLE IF EXISTS decisions;
    DROP TABLE IF EXISTS show_artist_slots;
    DROP TABLE IF EXISTS venue_links;
    DROP TABLE IF EXISTS venue_aliases;
    DROP TABLE IF EXISTS venues;
    DROP TABLE IF EXISTS artist_genres;
    DROP TABLE IF EXISTS artist_links;
    DROP TABLE IF EXISTS artist_aliases;
    DROP TABLE IF EXISTS artists;
    DROP TABLE IF EXISTS show_sources;
    DROP TABLE IF EXISTS shows;
    DROP TABLE IF EXISTS raw_imports;
    DROP TABLE IF EXISTS metadata;
  `);
}

function importArtists(db, artists, timestamp) {
  const insertArtist = db.prepare(`
    INSERT INTO artists (
      id, name, display_name, confidence, locality, image_url, image_source,
      spotify_image_url, summary, disambiguation, review_notes,
      manually_reviewed, manually_reviewed_at, raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      confidence = excluded.confidence,
      locality = excluded.locality,
      image_url = excluded.image_url,
      image_source = excluded.image_source,
      spotify_image_url = excluded.spotify_image_url,
      summary = excluded.summary,
      disambiguation = excluded.disambiguation,
      review_notes = excluded.review_notes,
      manually_reviewed = excluded.manually_reviewed,
      manually_reviewed_at = excluded.manually_reviewed_at,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  const insertAlias = db.prepare("INSERT OR IGNORE INTO artist_aliases (artist_id, alias, source) VALUES (?, ?, ?)");
  const insertGenre = db.prepare("INSERT OR IGNORE INTO artist_genres (artist_id, genre) VALUES (?, ?)");
  const insertLink = db.prepare(`
    INSERT OR REPLACE INTO artist_links (artist_id, type, label, url, confidence, source, display_priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const [id, artist] of Object.entries(artists)) {
    insertArtist.run(
      id,
      artist.name || id,
      artist.displayName || "",
      artist.confidence || "",
      artist.locality || "",
      artist.imageUrl || "",
      artist.imageSource || "",
      artist.spotifyImageUrl || "",
      artist.summary || "",
      artist.disambiguation || "",
      artist.reviewNotes || artist.note || "",
      artist.manuallyReviewed ? 1 : 0,
      artist.manuallyReviewedAt || "",
      json(artist),
      timestamp,
      timestamp
    );
    for (const alias of artist.aliases || []) insertAlias.run(id, alias, "js-import");
    for (const genre of artist.genres || artist.tags || []) if (genre) insertGenre.run(id, genre);
    for (const link of artist.links || []) {
      if (!link?.url) continue;
      insertLink.run(id, link.type || "", link.label || "", link.url, link.confidence || "", link.source || "", link.displayPriority || "");
    }
    count += 1;
  }
  return count;
}

function importVenues(db, venues, timestamp) {
  const insertVenue = db.prepare(`
    INSERT INTO venues (
      id, name, display_name, merged_into, confidence, status, venue_type,
      city, region, address, image_url, image_source, latitude, longitude,
      age_policy, capacity, review_notes, manually_reviewed, manually_reviewed_at,
      raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      merged_into = excluded.merged_into,
      confidence = excluded.confidence,
      status = excluded.status,
      venue_type = excluded.venue_type,
      city = excluded.city,
      region = excluded.region,
      address = excluded.address,
      image_url = excluded.image_url,
      image_source = excluded.image_source,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      age_policy = excluded.age_policy,
      capacity = excluded.capacity,
      review_notes = excluded.review_notes,
      manually_reviewed = excluded.manually_reviewed,
      manually_reviewed_at = excluded.manually_reviewed_at,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  const insertAlias = db.prepare("INSERT OR IGNORE INTO venue_aliases (venue_id, alias, source) VALUES (?, ?, ?)");
  const insertLink = db.prepare(`
    INSERT OR REPLACE INTO venue_links (venue_id, type, label, url, confidence, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const [id, venue] of Object.entries(venues)) {
    const coordinates = venue.geo || venue.coordinates || {};
    insertVenue.run(
      id,
      venue.name || id,
      venue.displayName || "",
      venue.mergedInto || "",
      venue.confidence || "",
      venue.status || "",
      venue.venueType || "",
      venue.city || "",
      venue.region || "",
      venue.address || "",
      venue.imageUrl || "",
      venue.imageSource || "",
      Number.isFinite(coordinates.lat) ? coordinates.lat : null,
      Number.isFinite(coordinates.lng) ? coordinates.lng : null,
      venue.agePolicy || "",
      Number.isFinite(venue.capacity) ? venue.capacity : null,
      venue.reviewNotes || venue.note || "",
      venue.manuallyReviewed ? 1 : 0,
      venue.manuallyReviewedAt || "",
      json(venue),
      timestamp,
      timestamp
    );
    for (const alias of venue.aliases || []) insertAlias.run(id, alias, "js-import");
    for (const link of venue.links || []) {
      if (!link?.url) continue;
      insertLink.run(id, link.type || "", link.label || "", link.url, link.confidence || "", link.source || "");
    }
    count += 1;
  }
  return count;
}

function importShows(db, events, timestamp) {
  const insertRaw = db.prepare(`
    INSERT INTO raw_imports (
      id, source_name, source_url, source_event_id, event_date, venue_name,
      title, details, content_fingerprint, first_seen_at, last_seen_at, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_event_id = excluded.source_event_id,
      event_date = excluded.event_date,
      venue_name = excluded.venue_name,
      title = excluded.title,
      details = excluded.details,
      content_fingerprint = excluded.content_fingerprint,
      last_seen_at = excluded.last_seen_at,
      raw_json = excluded.raw_json
  `);
  const insertShow = db.prepare(`
    INSERT INTO shows (
      id, status, show_type, event_date, venue_id, venue_name_snapshot,
      title, display_name, details, event_description, info_url,
      image_url, image_source, mikes_pick, manually_reviewed,
      manually_reviewed_at, raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      show_type = excluded.show_type,
      event_date = excluded.event_date,
      venue_id = excluded.venue_id,
      venue_name_snapshot = excluded.venue_name_snapshot,
      title = excluded.title,
      display_name = excluded.display_name,
      details = excluded.details,
      event_description = excluded.event_description,
      info_url = excluded.info_url,
      image_url = excluded.image_url,
      image_source = excluded.image_source,
      mikes_pick = excluded.mikes_pick,
      manually_reviewed = excluded.manually_reviewed,
      manually_reviewed_at = excluded.manually_reviewed_at,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO show_sources (show_id, source_name, source_url, raw_import_id)
    VALUES (?, ?, ?, ?)
  `);
  const insertSlot = db.prepare(`
    INSERT OR REPLACE INTO show_artist_slots (show_id, artist_id, billing_order, name_snapshot, role, status, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertOverride = db.prepare(`
    INSERT INTO show_overrides (show_id, event_date, venue_key, artist_key, mikes_pick, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(show_id) DO UPDATE SET
      event_date = excluded.event_date,
      venue_key = excluded.venue_key,
      artist_key = excluded.artist_key,
      mikes_pick = excluded.mikes_pick,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const event of events) {
    if (!event?.id || !event.date) continue;
    const sourceName = sourceNameForEvent(event);
    const sourceUrl = event.sourceUrl || event.source?.url || (event.sources || [])[0]?.url || "";
    const rawImportId = `${sourceName}:${event.id}`;
    insertRaw.run(
      rawImportId,
      sourceName,
      sourceUrl,
      event.id,
      event.date || "",
      event.venue || "",
      eventTitle(event),
      event.details || "",
      fingerprint(event),
      timestamp,
      timestamp,
      json(event)
    );
    insertShow.run(
      event.id,
      event.status || "scheduled",
      showTypeForEvent(event),
      event.date,
      event.venueId || slugify(event.venue || ""),
      event.venue || "",
      event.title || "",
      event.displayName || "",
      event.details || "",
      event.eventDescription || "",
      event.infoUrl || event.sourceUrl || "",
      event.imageUrl || "",
      event.imageSource || "",
      event.mikesPick ? 1 : 0,
      event.manuallyReviewed ? 1 : 0,
      event.manuallyReviewedAt || "",
      json(event),
      timestamp,
      timestamp
    );
    for (const source of event.sources || [event.source].filter(Boolean)) {
      if (!source) continue;
      insertSource.run(event.id, source.name || sourceName, source.url || sourceUrl, rawImportId);
    }
    (event.artists || []).forEach((artist, index) => {
      const name = artist.displayName || artist.name || "";
      if (!name) return;
      insertSlot.run(event.id, slugify(artist.name || name), index, name, artist.role || "unknown", artist.status || "scheduled", json(artist));
    });
    if (event.mikesPick) {
      upsertOverride.run(
        event.id,
        event.date,
        slugify(event.venueId || event.venue || ""),
        slugify(primaryArtistName(event) || event.title || event.displayName || event.details || ""),
        1,
        json({ mikesPick: true, source: "js-import" }),
        timestamp
      );
    }
    count += 1;
  }
  return count;
}

function primaryArtistName(event) {
  return (event.artists || [])
    .map((artist) => artist.displayName || artist.name)
    .find(Boolean) || "";
}
