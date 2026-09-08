import { readFile } from "node:fs/promises";
import {
  DEFAULT_DB_PATH,
  applySchema,
  argValue,
  eventTitle,
  fingerprint,
  json,
  nowIso,
  openDatabase,
  sourceNameForSource
} from "./sqlite-store.mjs";

const EVENTS_PATH = new URL("../data/imported-events.js", import.meta.url);
const dbPath = argValue("db", DEFAULT_DB_PATH);
const dryRun = process.argv.includes("--dry-run");
const timestamp = nowIso();

const events = await readEvents();
const rawImports = events.flatMap(rawImportRowsForEvent);
const db = openDatabase(dbPath);
await applySchema(db);

let inserted = 0;
let updated = 0;
let changed = 0;

if (!dryRun) db.exec("BEGIN");
try {
  const existing = db.prepare("SELECT content_fingerprint FROM raw_imports WHERE id = ?");
  const upsert = db.prepare(`
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

  for (const row of rawImports) {
    const previous = existing.get(row.id);
    if (!previous) inserted += 1;
    else {
      updated += 1;
      if (previous.content_fingerprint !== row.contentFingerprint) changed += 1;
    }
    if (dryRun) continue;
    upsert.run(
      row.id,
      row.sourceName,
      row.sourceUrl,
      row.sourceEventId,
      row.eventDate,
      row.venueName,
      row.title,
      row.details,
      row.contentFingerprint,
      timestamp,
      timestamp,
      json(row.raw)
    );
  }

  if (!dryRun) {
    db.prepare(`
      INSERT INTO metadata (key, value)
      VALUES ('last_import_ledger_sync_at', ?)
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
  events: events.length,
  rawImports: rawImports.length,
  inserted,
  updated,
  changed
}, null, 2));

async function readEvents() {
  const text = await readFile(EVENTS_PATH, "utf8");
  const match = text.match(/window\.SHOW_EXPLORER_EVENTS\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error("Could not read data/imported-events.js");
  return JSON.parse(match[1]);
}

function rawImportRowsForEvent(event) {
  const sources = normalizedSources(event);
  return sources.map((source) => {
    const sourceName = sourceNameForSource(source);
    const sourceUrl = source.url || event.sourceUrl || "";
    return {
      id: `${sourceName}:${event.id}:${fingerprint(sourceUrl).slice(0, 12)}`,
      sourceName,
      sourceUrl,
      sourceEventId: event.id,
      eventDate: event.date || "",
      venueName: event.venue || "",
      title: eventTitle(event),
      details: event.details || "",
      contentFingerprint: fingerprint({
        sourceName,
        sourceUrl,
        date: event.date || "",
        venue: event.venue || "",
        title: eventTitle(event),
        details: event.details || "",
        artists: (event.artists || []).map((artist) => artist.displayName || artist.name).filter(Boolean)
      }),
      raw: event
    };
  });
}

function normalizedSources(event) {
  const sources = [...(event.sources || []), event.source].filter(Boolean);
  if (!sources.length && event.sourceUrl) sources.push({ name: "Source", url: event.sourceUrl });
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${sourceNameForSource(source)}|${source.url || event.sourceUrl || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
