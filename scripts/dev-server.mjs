import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(fileURLToPath(new URL("../", import.meta.url)));
const ARTISTS_PATH = join(ROOT, "data", "artists.js");
const VENUES_PATH = join(ROOT, "data", "venues.js");
const PORT = Number(process.env.PORT || 4173);

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

    if (request.method === "POST" && url.pathname === "/api/artists") {
      await handleSaveArtists(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/venues") {
      await handleSaveVenues(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-artist") {
      await handleEnrichArtist(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-venue") {
      await handleEnrichVenue(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/enrich-likely-venues") {
      await handleEnrichLikelyVenues(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/prune-rejected-venue-artists") {
      await handlePruneRejectedVenueArtists(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method not allowed");
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
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
