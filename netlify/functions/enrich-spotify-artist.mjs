import { json, requireAdmin } from "./_shared/auth.mjs";

let spotifyTokenCache = null;

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
      artist
    });
  } catch (error) {
    return json(502, { ok: false, error: error.message || "Spotify lookup failed" });
  }
}

async function spotifyAccessToken() {
  if (spotifyTokenCache?.token && spotifyTokenCache.expiresAt > Date.now() + 60_000) {
    return spotifyTokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials are not configured");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Spotify token request failed: ${response.status}`);
  }

  spotifyTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 3600) - 60) * 1000
  };
  return spotifyTokenCache.token;
}

async function searchSpotifyArtist(name) {
  const token = await spotifyAccessToken();
  const params = new URLSearchParams({
    q: name,
    type: "artist",
    limit: "1"
  });
  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Spotify search failed: ${response.status}`);
  }
  return payload.artists?.items?.[0] || null;
}

async function getSpotifyArtist(id) {
  const token = await spotifyAccessToken();
  const response = await fetch(`https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Spotify artist lookup failed: ${response.status}`);
  }
  return payload;
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
