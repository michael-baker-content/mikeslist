import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(fileURLToPath(new URL("../", import.meta.url)));
const ARTISTS_PATH = join(ROOT, "data", "artists.js");
const VENUES_PATH = join(ROOT, "data", "venues.js");
const EVENTS_PATH = join(ROOT, "data", "imported-events.js");
const PORT = Number(process.env.PORT || 4173);
const SESSION_COOKIE = "show_explorer_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_ACCESS_KEY = process.env.SHOW_EXPLORER_ADMIN_KEY || "";
const sessions = new Map();
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
  await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
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
  await writeFile(VENUES_PATH, `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  send(response, 200, JSON.stringify({ ok: true, savedAt: payload.generatedAt }), "application/json; charset=utf-8");
}

async function handleSaveEvents(request, response) {
  const body = await readBody(request);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(response, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json; charset=utf-8");
    return;
  }

  if (!Array.isArray(payload)) {
    send(response, 400, JSON.stringify({ ok: false, error: "Expected event array payload" }), "application/json; charset=utf-8");
    return;
  }

  await writeFile(EVENTS_PATH, `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  await runScript("scripts/build-artist-store.mjs");
  await runScript("scripts/build-venue-store.mjs");
  send(response, 200, JSON.stringify({ ok: true, savedAt: new Date().toISOString(), count: payload.length }), "application/json; charset=utf-8");
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

  send(response, 200, JSON.stringify({ ok: true, generatedAt: store.generatedAt, artist }), "application/json; charset=utf-8");
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
      await handleSaveArtists(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/venues") {
      if (!requireAdmin(request, response)) return;
      await handleSaveVenues(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      if (!requireAdmin(request, response)) return;
      await handleSaveEvents(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-artist") {
      if (!requireAdmin(request, response)) return;
      await handleEnrichArtist(request, response);
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
    console.error(error);
    send(response, 500, "Server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Bay Area Show Explorer dev server running at http://127.0.0.1:${PORT}/`);
});
