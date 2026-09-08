# Spotify Enrichment Notes

## Current Behavior

Artist Review can use Spotify to enrich a selected artist record.

- If the artist already has a displayable Spotify artist link, Mike's List uses that exact link to fetch Spotify's artist image.
- If no Spotify artist link exists, Mike's List searches Spotify for the selected artist name and uses the top artist result.
- The resulting Spotify URL is added as a candidate link when it came from search.
- The Spotify image is stored as `spotifyImageUrl` and used as a fallback image.
- Manual artist images still have higher priority than Spotify images.
- Spotify images have higher priority than venue images in Show Explorer.
- The `Disable automatic Spotify match` checkbox clears Spotify match metadata and prevents future automatic matching for that artist.

## Where The Code Lives

- Local endpoint: `scripts/dev-server.mjs`
- Live Netlify endpoint: `netlify/functions/enrich-spotify-artist.mjs`
- Artist Review UI: `review.html` and `assets/review.js`
- Public artist bundle: `scripts/build-public-artist-store.mjs`
- Public display image priority: `assets/app.js` and `assets/detail.js`

## Credentials

Local `.env`:

```text
SHOW_EXPLORER_ADMIN_KEY=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Netlify environment variables:

```text
SHOW_EXPLORER_ADMIN_KEY
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
```

Mark `SHOW_EXPLORER_ADMIN_KEY` and `SPOTIFY_CLIENT_SECRET` as secret values in Netlify. `SPOTIFY_CLIENT_ID` does not need secret treatment.

## Rate-Limit Context

The user is making one request at a time, but working quickly through records. Each uncached Spotify lookup can still require one token request and one artist search or artist lookup. Spotify rate limits and Development Mode quota limits are expected to return `429 Too Many Requests`, sometimes with a `Retry-After` header.

The current local and Netlify code now includes groundwork for:

- Reusing a cached Spotify access token.
- Caching artist searches by normalized artist name.
- Caching direct artist lookups by Spotify artist ID.
- Returning structured error details with `status`, `message`, `reason`, `retryAfter`, and `source`.
- Cooling down after `429` or upstream/server failures.
- Treating `429` with `reason: "QUOTA_EXCEEDED"` as a 24-hour stop signal.
- Saving the active Spotify cooldown in Artist Review browser storage so the `Find Spotify` button stays disabled across refreshes.

The explicit `Find Spotify` action should preserve Spotify's real status details instead of flattening them into a generic local `500`. If Spotify sends `Retry-After`, use it. If Spotify sends `QUOTA_EXCEEDED`, stop lookups for 24 hours to protect development-mode API access.

## Suggested Next Refinement

1. Improve the Artist Review UI around rate limits.
   - Keep the short status line compact.
   - Show a calm "Spotify asked us to wait X seconds" message.
   - Keep detailed diagnostics in the collapsed error details section.

2. Add a visible cached-result cue.
   - When the server returns a cached result, show something like "Used cached Spotify result."
   - This may require returning `cached: true` from `searchSpotifyArtist` / `getSpotifyArtist`.

3. Add optional pacing for fast review work.
   - After a successful Spotify lookup, optionally disable `Find Spotify` for a very short delay.
   - Keep this gentle; the user's workflow is manual and should not feel sluggish.

4. Consider a local-only persistent cache later.
   - A JSON cache file could preserve Spotify matches across server restarts.
   - Do this only if the in-memory cache is not enough.
   - If implemented, keep it out of public bundles unless the fields are already display-safe.

## Open Questions

- Should Spotify's suggested genres be shown as optional suggestions in Artist Review?
- Should a searched Spotify link default to `candidate` or `likely` confidence?
- Should the live Netlify workflow ever persist edits through GitHub or a database, or remain browser-local for admin experiments?
