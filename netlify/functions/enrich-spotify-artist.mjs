import { json, requireAdmin } from "./_shared/auth.mjs";

let spotifyTokenCache = null;
let spotifyCooldownUntil = 0;
// Intentionally per-function-instance; see docs/spotify-enrichment-notes.md before making this persistent.
const spotifySearchCache = new Map();
const spotifyArtistCache = new Map();

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  if (!requireAdmin(event)) return json(403, { ok: false, error: "Admin access required" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const artist = payload.artist || { id: payload.id, name: payload.name };
  const name = payload.name || artist.displayName || artist.name;
  if (!artist?.id || !name) {
    return json(400, { ok: false, error: "Expected artist id and name" });
  }
  if (artist.spotifyLookupDisabled) {
    return json(409, { ok: false, error: "Spotify auto match is disabled for this artist" });
  }

  try {
    const existingSpotifyLink = spotifyLinkForArtist(artist);
    const existingSpotifyArtistId = spotifyArtistIdFromUrl(existingSpotifyLink?.url || "");
    const candidate = existingSpotifyArtistId
      ? await getSpotifyArtist(existingSpotifyArtistId)
      : await searchSpotifyArtist(name);
    const match = spotifyCandidatePayload(candidate);
    if (!match?.url) return json(404, { ok: false, error: "No Spotify artist result found" });

    applySpotifyMatch(artist, match, existingSpotifyArtistId ? "manual-link" : "spotify-api");
    return json(200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      persisted: false,
      artist
    });
  } catch (error) {
    const payload = spotifyErrorPayload(error);
    const headers = payload.details.retryAfter ? { "Retry-After": payload.details.retryAfter } : {};
    return json(payload.details.status, payload, headers);
  }
}

async function spotifyAccessToken() {
  assertSpotifyCooldown();
  if (spotifyTokenCache?.token && spotifyTokenCache.expiresAt > Date.now() + 60_000) {
    return spotifyTokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    const error = new Error("Spotify credentials are not configured");
    error.status = 503;
    error.source = "netlify-env";
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

function spotifyLinkForArtist(artist) {
  return (artist.links || []).find((link) => {
    if (link.confidence === "rejected" || link.display === false) return false;
    return Boolean(spotifyArtistIdFromUrl(link.url || ""));
  }) || null;
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
      source: error.source || "netlify-function"
    }
  };
}

function assertSpotifyCooldown() {
  const remainingSeconds = Math.ceil((spotifyCooldownUntil - Date.now()) / 1000);
  if (remainingSeconds <= 0) return;
  const error = new Error(`Spotify lookup is cooling down for ${remainingSeconds}s`);
  error.status = 429;
  error.retryAfter = String(remainingSeconds);
  error.source = "function-cooldown";
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
