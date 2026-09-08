import {
  DEFAULT_DB_PATH,
  applySchema,
  argValue,
  eventTitle,
  json,
  nowIso,
  openDatabase,
  readWindowData,
  showTypeForEvent,
  slugify
} from "./sqlite-store.mjs";

const dbPath = argValue("db", DEFAULT_DB_PATH);
const dryRun = process.argv.includes("--dry-run");
const syncAll = !process.argv.some((arg) => ["--artists", "--venues", "--shows"].includes(arg));
const syncArtists = syncAll || process.argv.includes("--artists");
const syncVenues = syncAll || process.argv.includes("--venues");
const syncShows = syncAll || process.argv.includes("--shows");
const timestamp = nowIso();

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);
const VENUES_PATH = new URL("../data/venues.js", import.meta.url);

const db = openDatabase(dbPath);
await applySchema(db);

const counts = {
  artists: 0,
  venues: 0,
  shows: 0
};

if (!dryRun) db.exec("BEGIN");
try {
  if (syncArtists) {
    const artistStore = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
    counts.artists = syncArtistStore(db, artistStore.artists || {});
  }
  if (syncVenues) {
    const venueStore = await readWindowData(VENUES_PATH, "SHOW_EXPLORER_VENUES", { venues: {} });
    counts.venues = syncVenueStore(db, venueStore.venues || {});
  }
  if (syncShows) {
    const events = await readWindowData(EVENTS_PATH, "SHOW_EXPLORER_EVENTS", []);
    counts.shows = syncShowStore(db, events);
  }

  if (!dryRun) {
    db.prepare(`
      INSERT INTO metadata (key, value)
      VALUES ('last_canonical_sync_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(timestamp);
    db.exec("COMMIT");
  }
} catch (error) {
  if (!dryRun) db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({
  database: dbPath,
  dryRun,
  synced: counts
}, null, 2));

function syncArtistStore(db, artists) {
  const entries = Object.entries(artists);
  if (dryRun) return entries.length;

  db.exec("DELETE FROM artist_links; DELETE FROM artist_genres; DELETE FROM artist_aliases; DELETE FROM artists;");
  const insertArtist = db.prepare(`
    INSERT INTO artists (
      id, name, display_name, confidence, locality, image_url, image_source,
      spotify_image_url, summary, disambiguation, review_notes,
      manually_reviewed, manually_reviewed_at, raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAlias = db.prepare("INSERT OR IGNORE INTO artist_aliases (artist_id, alias, source) VALUES (?, ?, ?)");
  const insertGenre = db.prepare("INSERT OR IGNORE INTO artist_genres (artist_id, genre) VALUES (?, ?)");
  const insertLink = db.prepare(`
    INSERT OR REPLACE INTO artist_links (artist_id, type, label, url, confidence, source, display_priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [id, artist] of entries) {
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
    for (const alias of artist.aliases || []) insertAlias.run(id, alias, "js-sync");
    for (const genre of artist.genres || artist.tags || []) if (genre) insertGenre.run(id, genre);
    for (const link of artist.links || []) {
      if (!link?.url) continue;
      insertLink.run(id, link.type || "", link.label || "", link.url, link.confidence || "", link.source || "", link.displayPriority || "");
    }
  }
  return entries.length;
}

function syncVenueStore(db, venues) {
  const entries = Object.entries(venues);
  if (dryRun) return entries.length;

  db.exec("DELETE FROM venue_links; DELETE FROM venue_aliases; DELETE FROM venues;");
  const insertVenue = db.prepare(`
    INSERT INTO venues (
      id, name, display_name, merged_into, confidence, status, venue_type,
      city, region, address, image_url, image_source, latitude, longitude,
      age_policy, capacity, review_notes, manually_reviewed, manually_reviewed_at,
      raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAlias = db.prepare("INSERT OR IGNORE INTO venue_aliases (venue_id, alias, source) VALUES (?, ?, ?)");
  const insertLink = db.prepare(`
    INSERT OR REPLACE INTO venue_links (venue_id, type, label, url, confidence, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const [id, venue] of entries) {
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
    for (const alias of venue.aliases || []) insertAlias.run(id, alias, "js-sync");
    for (const link of venue.links || []) {
      if (!link?.url) continue;
      insertLink.run(id, link.type || "", link.label || "", link.url, link.confidence || "", link.source || "");
    }
  }
  return entries.length;
}

function syncShowStore(db, events) {
  if (dryRun) return events.length;

  db.exec("DELETE FROM show_sources; DELETE FROM show_artist_slots; DELETE FROM shows;");
  const insertShow = db.prepare(`
    INSERT INTO shows (
      id, status, show_type, event_date, venue_id, venue_name_snapshot,
      title, display_name, details, event_description, info_url,
      image_url, image_source, mikes_pick, manually_reviewed,
      manually_reviewed_at, raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  for (const event of events) {
    if (!event?.id || !event.date) continue;
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
    for (const source of normalizedSources(event)) {
      insertSource.run(event.id, source.name || "Source", source.url || "", null);
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
        json({ mikesPick: true, source: "canonical-sync" }),
        timestamp
      );
    }
  }
  return events.length;
}

function primaryArtistName(event) {
  return (event.artists || [])
    .map((artist) => artist.displayName || artist.name)
    .find(Boolean) || "";
}

function normalizedSources(event) {
  const sources = [...(event.sources || []), event.source].filter(Boolean);
  if (!sources.length && event.sourceUrl) sources.push({ name: "Source", url: event.sourceUrl });
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.name || "Source"}|${source.url || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
