import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { backupFile, writeTextFile } from "./file-io.mjs";
import { DEFAULT_DB_PATH, applySchema, nowIso, openDatabase, suppressionFieldsForEvent } from "./sqlite-store.mjs";

const ROOT = normalize(fileURLToPath(new URL("../", import.meta.url)));
const ARTISTS_PATH = join(ROOT, "data", "artists.js");
const VENUES_PATH = join(ROOT, "data", "venues.js");
const EVENTS_PATH = join(ROOT, "data", "imported-events.js");
const DB_PATH = join(ROOT, DEFAULT_DB_PATH);
const ENV_PATH = join(ROOT, ".env");
const PORT = Number(process.env.PORT || 4173);
const SESSION_COOKIE = "show_explorer_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_ACCESS_KEY = process.env.SHOW_EXPLORER_ADMIN_KEY || "";
const sessions = new Map();
let saveQueue = Promise.resolve();
let envFileCache;
let spotifyTokenCache = null;
let spotifyCooldownUntil = 0;
// Intentionally per-process; see docs/spotify-enrichment-notes.md before making this persistent.
const spotifySearchCache = new Map();
const spotifyArtistCache = new Map();
const protectedPages = new Set([
  "/admin.html",
  "/review.html",
  "/venue-review.html",
  "/event-review.html",
  "/suggestions.html"
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  response.end();
}

function safePath(urlPath) {
  const requested = normalize(join(ROOT, decodeURIComponent(urlPath)));
  if (!requested.startsWith(ROOT)) return "";
  return requested;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseCookies(header = "") {
  const cookies = new Map();
  header.split(";").forEach((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    if (!name) return;
    cookies.set(name, decodeURIComponent(rest.join("=")));
  });
  return cookies;
}

function currentSession(request) {
  pruneExpiredSessions();
  const token = parseCookies(request.headers.cookie || "").get(SESSION_COOKIE);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}

function canAccessAdmin(request) {
  const session = currentSession(request);
  return Boolean(session && session.status === "admin");
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sessionPayload(request) {
  const session = currentSession(request);
  return {
    authenticated: Boolean(session),
    status: session?.status || "public",
    admin: session?.status === "admin"
  };
}

async function handleLogin(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(response, 400, { ok: false, error: "Invalid JSON" });
    return;
  }

  if (!ADMIN_ACCESS_KEY) {
    sendJson(response, 503, { ok: false, error: "Admin login is not configured" });
    return;
  }

  if (!safeEqual(payload?.accessKey || "", ADMIN_ACCESS_KEY)) {
    sendJson(response, 401, { ok: false, error: "Invalid access key" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  sessions.set(token, {
    status: "admin",
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  sendJson(response, 200, { ok: true, status: "admin" }, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  });
}

function handleLogout(request, response) {
  const token = parseCookies(request.headers.cookie || "").get(SESSION_COOKIE);
  if (token) sessions.delete(token);
  sendJson(response, 200, { ok: true, status: "public" }, {
    "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  });
}

function requireAdmin(request, response) {
  if (canAccessAdmin(request)) return true;
  sendJson(response, 403, { ok: false, error: "Admin access required" });
  return false;
}

async function readArtistStore() {
  const text = await readFile(ARTISTS_PATH, "utf8");
  const match = text.match(/window\.SHOW_EXPLORER_ARTISTS\s*=\s*([\s\S]*);\s*$/);
  return match ? JSON.parse(match[1]) : { artists: {} };
}

async function readVenueStore() {
  const text = await readFile(VENUES_PATH, "utf8");
  const match = text.match(/window\.SHOW_EXPLORER_VENUES\s*=\s*([\s\S]*);\s*$/);
  return match ? JSON.parse(match[1]) : { venues: {} };
}

async function readEventStore() {
  const text = await readFile(EVENTS_PATH, "utf8");
  const match = text.match(/window\.SHOW_EXPLORER_EVENTS\s*=\s*([\s\S]*);\s*$/);
  return match ? JSON.parse(match[1]) : [];
}

async function readEnvFile() {
  if (envFileCache) return envFileCache;
  try {
    const text = await readFile(ENV_PATH, "utf8");
    envFileCache = Object.fromEntries(text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      }));
    return envFileCache;
  } catch (error) {
    if (error.code === "ENOENT") {
      envFileCache = {};
      return envFileCache;
    }
    throw error;
  }
}

async function envValue(name) {
  return process.env[name] || (await readEnvFile())[name] || "";
}

async function spotifyAccessToken() {
  assertSpotifyCooldown();
  if (spotifyTokenCache?.token && spotifyTokenCache.expiresAt > Date.now() + 60_000) {
    return spotifyTokenCache.token;
  }

  const clientId = await envValue("SPOTIFY_CLIENT_ID");
  const clientSecret = await envValue("SPOTIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    const error = new Error("Spotify credentials are not configured");
    error.status = 503;
    error.source = ".env";
    throw error;
  }

  let response;
  try {
    response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" })
    });
  } catch (error) {
    error.status = 502;
    error.source = "spotify-token";
    noteSpotifyCooldown(error);
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(spotifyErrorMessage(payload, `Spotify token request failed: ${response.status}`));
    error.status = response.status;
    error.spotifyReason = spotifyErrorReason(payload);
    error.retryAfter = response.headers.get("retry-after") || "";
    error.source = "spotify-token";
    noteSpotifyCooldown(error);
    throw error;
  }

  spotifyTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 3600) - 60) * 1000
  };
  return spotifyTokenCache.token;
}

async function searchSpotifyArtist(name) {
  const key = spotifySearchKey(name);
  if (spotifySearchCache.has(key)) return spotifySearchCache.get(key);
  const token = await spotifyAccessToken();
  const params = new URLSearchParams({
    q: name,
    type: "artist",
    limit: "1"
  });
  const payload = await spotifyFetchJson(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  }, "spotify-search");
  const artist = payload.artists?.items?.[0] || null;
  spotifySearchCache.set(key, artist);
  return artist;
}

async function getSpotifyArtist(id) {
  const key = String(id || "").trim();
  if (spotifyArtistCache.has(key)) return spotifyArtistCache.get(key);
  const token = await spotifyAccessToken();
  const artist = await spotifyFetchJson(`https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  }, "spotify-artist");
  spotifyArtistCache.set(key, artist);
  return artist;
}

async function spotifyFetchJson(url, options, source) {
  assertSpotifyCooldown();
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    error.status = 502;
    error.source = source;
    noteSpotifyCooldown(error);
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;

  const error = new Error(spotifyErrorMessage(payload, `Spotify request failed: ${response.status}`));
  error.status = response.status;
  error.spotifyReason = spotifyErrorReason(payload);
  error.retryAfter = response.headers.get("retry-after") || "";
  error.source = source;
  noteSpotifyCooldown(error);
  throw error;
}

function spotifyArtistIdFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.replace(/^www\./i, "").endsWith("spotify.com")) return "";
    return parsed.pathname.match(/\/artist\/([^/?#]+)/i)?.[1] || "";
  } catch {
    return "";
  }
}

function spotifySearchKey(name = "") {
  return String(name || "").trim().toLowerCase();
}

function spotifyErrorMessage(payload, fallback) {
  return payload.error_description
    || payload.error?.message
    || (typeof payload.error === "string" ? payload.error : "")
    || fallback;
}

function spotifyErrorReason(payload) {
  return payload.error?.reason || payload.reason || "";
}

function spotifyErrorPayload(error) {
  const status = Number(error.status || 502);
  const reason = error.spotifyReason || "";
  const retryAfter = error.retryAfter || retryAfterFromCooldown();
  const prefix = status === 429
    ? reason === "QUOTA_EXCEEDED" ? "Spotify quota exceeded" : "Spotify rate limit"
    : status === 401 || status === 403 ? "Spotify credentials rejected"
    : status >= 500 ? "Spotify service error"
    : "Spotify lookup failed";
  return {
    ok: false,
    error: retryAfter ? `${prefix}. Try again in ${retryAfter}s.` : `${prefix}.`,
    details: {
      status,
      message: error.message || String(error),
      reason,
      retryAfter,
      source: error.source || "local"
    }
  };
}

function assertSpotifyCooldown() {
  const remainingSeconds = Math.ceil((spotifyCooldownUntil - Date.now()) / 1000);
  if (remainingSeconds <= 0) return;
  const error = new Error(`Spotify lookup is cooling down for ${remainingSeconds}s`);
  error.status = 429;
  error.retryAfter = String(remainingSeconds);
  error.source = "local-cooldown";
  throw error;
}

function noteSpotifyCooldown(error) {
  const status = Number(error.status || 0);
  if (status !== 429 && status < 500) return;
  const seconds = error.spotifyReason === "QUOTA_EXCEEDED"
    ? 24 * 60 * 60
    : Number(error.retryAfter || 0) || (status === 429 ? 10 * 60 : 15);
  spotifyCooldownUntil = Math.max(spotifyCooldownUntil, Date.now() + seconds * 1000);
}

function retryAfterFromCooldown() {
  const seconds = Math.ceil((spotifyCooldownUntil - Date.now()) / 1000);
  return seconds > 0 ? String(seconds) : "";
}

function spotifyLinkForArtist(artist) {
  return (artist.links || []).find((link) => {
    if (link.confidence === "rejected" || link.display === false) return false;
    return Boolean(spotifyArtistIdFromUrl(link.url || ""));
  }) || null;
}

function spotifyCandidatePayload(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id || "",
    name: candidate.name || "",
    url: candidate.external_urls?.spotify || "",
    imageUrl: candidate.images?.[0]?.url || "",
    genres: candidate.genres || [],
    popularity: candidate.popularity ?? null
  };
}

function applySpotifyMatch(artist, match, source) {
  artist.links ||= [];
  if (!spotifyLinkForArtist(artist) && match.url) {
    artist.links.push({
      type: "spotify",
      label: "Spotify",
      url: match.url,
      confidence: "candidate",
      display: true,
      displayPriority: "secondary",
      source: "spotify-api"
    });
  }
  if (match.imageUrl) artist.spotifyImageUrl = match.imageUrl;
  artist.spotifyMatch = {
    id: match.id || "",
    name: match.name || "",
    url: match.url || "",
    imageUrl: match.imageUrl || "",
    genres: match.genres || [],
    popularity: match.popularity ?? null,
    matchedAt: new Date().toISOString(),
    source
  };
}

function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${script} exited with ${code}`));
    });
  });
}

async function runSaveTask(task) {
  const previous = saveQueue;
  let release;
  saveQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => null);
  try {
    return await task();
  } finally {
    release();
  }
}

function logServerError(error) {
  const message = error?.message || String(error);
  if (message.includes("UNKNOWN: unknown error, open")) {
    console.error(`Temporary file write failed: ${message.split("\n")[0]}`);
    return;
  }
  console.error(error);
}

async function handleSaveArtists(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!payload || typeof payload !== "object" || !payload.artists || typeof payload.artists !== "object") {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected artist store payload" }), "application/json; charset=utf-8");
    return;
  }

  payload.generatedAt = new Date().toISOString();
  await backupFile(ARTISTS_PATH);
  await writeTextFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  await runScript("scripts/build-public-artist-store.mjs");
  await runScript("scripts/sync-sqlite-canonical.mjs", ["--artists"]);
  send(response, 200, JSON.stringify({ ok: true, savedAt: payload.generatedAt }), "application/json; charset=utf-8");
}

async function handleSaveVenues(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!payload || typeof payload !== "object" || !payload.venues || typeof payload.venues !== "object") {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected venue store payload" }), "application/json; charset=utf-8");
    return;
  }

  payload.generatedAt = new Date().toISOString();
  await backupFile(VENUES_PATH);
  await writeTextFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  await runScript("scripts/sync-sqlite-canonical.mjs", ["--venues"]);
  send(response, 200, JSON.stringify({ ok: true, savedAt: payload.generatedAt }), "application/json; charset=utf-8");
}

async function handleSaveEvents(request, response) {
  const body = await readBody(request);
  let bodyPayload;
  try {
    bodyPayload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  const payload = Array.isArray(bodyPayload) ? bodyPayload : bodyPayload?.events;
  const decisions = Array.isArray(bodyPayload?.decisions) ? bodyPayload.decisions : [];

  if (!Array.isArray(payload)) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected event array payload" }), "application/json; charset=utf-8");
    return;
  }

  await recordShowDecisions(decisions);
  await backupFile(EVENTS_PATH);
  await writeTextFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  await runScript("scripts/build-artist-store.mjs");
  await runScript("scripts/build-public-artist-store.mjs");
  await runScript("scripts/build-venue-store.mjs");
  await runScript("scripts/sync-sqlite-canonical.mjs");
  send(response, 200, JSON.stringify({ ok: true, savedAt: new Date().toISOString(), count: payload.length }), "application/json; charset=utf-8");
}

async function handleEventDecisions(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  const decisions = Array.isArray(payload) ? payload : payload?.decisions;
  if (!Array.isArray(decisions)) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected decisions array payload" }), "application/json; charset=utf-8");
    return;
  }

  const recorded = await recordShowDecisions(decisions);
  send(response, 200, JSON.stringify({ ok: true, recorded, savedAt: new Date().toISOString() }), "application/json; charset=utf-8");
}

async function recordShowDecisions(decisions = []) {
  const normalized = decisions
    .map(normalizeShowDecision)
    .filter(Boolean);
  if (!normalized.length) return 0;

  const db = openDatabase(DB_PATH);
  await applySchema(db);
  let recorded = 0;
  db.exec("BEGIN");
  try {
    const insertDecision = db.prepare(`
      INSERT INTO decisions (entity_type, entity_id, action, target_entity_id, note, data_json, created_at)
      VALUES ('show', ?, ?, ?, ?, ?, ?)
    `);
    const insertSuppression = db.prepare(`
      INSERT OR IGNORE INTO suppressed_imports (
        entity_type, source_name, source_url, source_event_id, event_date, venue_key,
        artist_key, reason, created_at
      )
      VALUES ('show', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertOverride = db.prepare(`
      INSERT INTO show_overrides (
        show_id, event_date, venue_key, artist_key, mikes_pick, data_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(show_id) DO UPDATE SET
        event_date = excluded.event_date,
        venue_key = excluded.venue_key,
        artist_key = excluded.artist_key,
        mikes_pick = excluded.mikes_pick,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `);

    for (const decision of normalized) {
      insertDecision.run(
        decision.entityId,
        decision.action,
        decision.targetEntityId || "",
        decision.note || "",
        JSON.stringify(decision.data || {}),
        decision.createdAt
      );
      recorded += 1;

      if (decision.action === "merge" || decision.action === "delete") {
        insertSuppression.run(
          decision.sourceName,
          decision.sourceUrl,
          decision.sourceEventId,
          decision.eventDate,
          decision.venueKey,
          decision.artistKey,
          decision.action,
          decision.createdAt
        );
      }
      if (decision.action === "update") {
        upsertOverride.run(
          decision.sourceEventId,
          decision.eventDate,
          decision.venueKey,
          decision.artistKey,
          decision.data?.mikesPick === true ? 1 : decision.data?.mikesPick === false ? 0 : null,
          JSON.stringify(decision.data || {}),
          decision.createdAt
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  return recorded;
}

function normalizeShowDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  const action = String(decision.action || "").trim();
  if (!["merge", "delete", "update"].includes(action)) return null;
  const event = decision.event && typeof decision.event === "object" ? decision.event : null;
  const fields = event ? suppressionFieldsForEvent(event) : {};
  const entityId = String(decision.entityId || event?.id || fields.sourceEventId || "").trim();
  if (!entityId) return null;
  return {
    action,
    entityId,
    targetEntityId: String(decision.targetEntityId || "").trim(),
    note: String(decision.note || "").trim(),
    data: decision.data || event || {},
    createdAt: nowIso(),
    sourceName: String(decision.sourceName || fields.sourceName || "").trim(),
    sourceUrl: String(decision.sourceUrl || fields.sourceUrl || "").trim(),
    sourceEventId: String(decision.sourceEventId || fields.sourceEventId || entityId).trim(),
    eventDate: String(decision.eventDate || fields.eventDate || "").trim(),
    venueKey: String(decision.venueKey || fields.venueKey || "").trim(),
    artistKey: String(decision.artistKey || fields.artistKey || "").trim()
  };
}

async function handleEnrichArtist(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!payload?.id || !payload?.name) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected artist id and name" }), "application/json; charset=utf-8");
    return;
  }

  await runScript("scripts/enrich-wikidata.mjs", [`--artist=${payload.name}`]);
  await runScript("scripts/enrich-musicbrainz.mjs", ["--limit=1", `--artist=${payload.name}`]).catch(() => null);
  await runScript("scripts/enrich-page-metadata.mjs", [`--artist=${payload.name}`]).catch(() => null);
  await runScript("scripts/enrich-discogs-links.mjs", [`--artist=${payload.name}`]).catch(() => null);
  await runScript("scripts/normalize-artist-store.mjs");

  const store = await readArtistStore();
  const artist = store.artists?.[payload.id];
  if (!artist) {
    send(response, 404, JSON.stringify({ ok: false, error: "Artist not found after enrichment" }), "application/json; charset=utf-8");
    return;
  }

  if (!artist.spotifyLookupDisabled && !spotifyLinkForArtist(artist)) {
    try {
      const match = spotifyCandidatePayload(await searchSpotifyArtist(artist.displayName || artist.name || payload.name));
      if (match?.url) {
        applySpotifyMatch(artist, match, "spotify-api");
        store.generatedAt = new Date().toISOString();
        await writeTextFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");
        await runScript("scripts/build-public-artist-store.mjs");
      }
    } catch {
      // Spotify matching is optional enrichment; keep the existing artist enrichment result.
    }
  }

  send(response, 200, JSON.stringify({ ok: true, generatedAt: store.generatedAt, persisted: true, artist }), "application/json; charset=utf-8");
}

async function handleEnrichSpotifyArtist(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!payload?.id || !payload?.name) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected artist id and name" }), "application/json; charset=utf-8");
    return;
  }

  const store = await readArtistStore();
  const artist = store.artists?.[payload.id];
  if (!artist) {
    send(response, 404, JSON.stringify({ ok: false, error: "Artist not found" }), "application/json; charset=utf-8");
    return;
  }

  if (artist.spotifyLookupDisabled) {
    send(response, 409, JSON.stringify({ ok: false, error: "Spotify auto match is disabled for this artist" }), "application/json; charset=utf-8");
    return;
  }

  try {
    const existingSpotifyLink = spotifyLinkForArtist(artist);
    const existingSpotifyArtistId = spotifyArtistIdFromUrl(existingSpotifyLink?.url || "");
    const candidate = existingSpotifyArtistId
      ? await getSpotifyArtist(existingSpotifyArtistId)
      : await searchSpotifyArtist(payload.name);
    const match = spotifyCandidatePayload(candidate);
    if (!match?.url) {
      send(response, 404, JSON.stringify({ ok: false, error: "No Spotify artist result found" }), "application/json; charset=utf-8");
      return;
    }

    applySpotifyMatch(artist, match, existingSpotifyArtistId ? "manual-link" : "spotify-api");
    store.generatedAt = new Date().toISOString();

    await writeTextFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");
    await runScript("scripts/build-public-artist-store.mjs");

    send(response, 200, JSON.stringify({ ok: true, generatedAt: store.generatedAt, persisted: true, artist }), "application/json; charset=utf-8");
  } catch (error) {
    const payload = spotifyErrorPayload(error);
    const headers = payload.details.retryAfter ? { "Retry-After": payload.details.retryAfter } : {};
    sendJson(response, payload.details.status, payload, headers);
  }
}

async function handleEnrichVenue(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!payload?.id || !payload?.name) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected venue id and name" }), "application/json; charset=utf-8");
    return;
  }

  await runScript("scripts/enrich-venues-wikidata.mjs", [`--venue=${payload.name}`]).catch(() => null);
  await runScript("scripts/enrich-venues-google-places.mjs", [`--venue=${payload.name}`]).catch(() => null);
  await runScript("scripts/enrich-venue-page-metadata.mjs", [`--venue=${payload.name}`]).catch(() => null);

  const store = await readVenueStore();
  const venue = store.venues?.[payload.id];
  if (!venue) {
    send(response, 404, JSON.stringify({ ok: false, error: "Venue not found after enrichment" }), "application/json; charset=utf-8");
    return;
  }

  send(response, 200, JSON.stringify({ ok: true, generatedAt: store.generatedAt, venue }), "application/json; charset=utf-8");
}

async function handleEnrichLikelyVenues(_request, response) {
  const limit = "200";
  const results = [];

  results.push(await runScript("scripts/enrich-venues-wikidata.mjs", ["--confidence=likely", `--limit=${limit}`]).catch((error) => ({ stdout: "", stderr: error.message })));
  results.push(await runScript("scripts/enrich-venues-google-places.mjs", ["--confidence=likely", `--limit=${limit}`]).catch((error) => ({ stdout: "", stderr: error.message })));
  results.push(await runScript("scripts/enrich-venue-page-metadata.mjs", ["--confidence=likely", `--limit=${limit}`]).catch((error) => ({ stdout: "", stderr: error.message })));

  const store = await readVenueStore();
  send(response, 200, JSON.stringify({
    ok: true,
    generatedAt: store.generatedAt,
    venues: store.venues,
    messages: results.flatMap((result) => [result.stdout, result.stderr]).filter(Boolean).join("\n").trim()
  }), "application/json; charset=utf-8");
}

async function handlePruneRejectedVenueArtists(_request, response) {
  const result = await runScript("scripts/prune-artists-at-rejected-venues.mjs");
  const payload = JSON.parse(result.stdout || "{}");
  send(response, 200, JSON.stringify({ ok: true, removed: payload.removed || 0 }), "application/json; charset=utf-8");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/session") {
      sendJson(response, 200, sessionPayload(request));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      await handleLogin(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      handleLogout(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/artists") {
      if (!requireAdmin(request, response)) return;
      await runSaveTask(() => handleSaveArtists(request, response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/venues") {
      if (!requireAdmin(request, response)) return;
      await runSaveTask(() => handleSaveVenues(request, response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      if (!requireAdmin(request, response)) return;
      await runSaveTask(() => handleSaveEvents(request, response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/events/decisions") {
      if (!requireAdmin(request, response)) return;
      await runSaveTask(() => handleEventDecisions(request, response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-artist") {
      if (!requireAdmin(request, response)) return;
      await handleEnrichArtist(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-spotify-artist") {
      if (!requireAdmin(request, response)) return;
      await handleEnrichSpotifyArtist(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-venue") {
      if (!requireAdmin(request, response)) return;
      await handleEnrichVenue(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-likely-venues") {
      if (!requireAdmin(request, response)) return;
      await handleEnrichLikelyVenues(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/prune-rejected-venue-artists") {
      if (!requireAdmin(request, response)) return;
      await handlePruneRejectedVenueArtists(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method not allowed");
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    if (protectedPages.has(pathname) && !canAccessAdmin(request)) {
      redirect(response, `/login.html?next=${encodeURIComponent(pathname)}`);
      return;
    }

    const path = safePath(pathname);
    if (!path) {
      send(response, 403, "Forbidden");
      return;
    }

    const body = await readFile(path);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      send(response, 404, "Not found");
      return;
    }
    logServerError(error);
    send(response, 500, "Server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mike's List dev server running at http://127.0.0.1:${PORT}/`);
});
