# Mike's List

Mike's List is a local listings project for Bay Area shows, venues, artists, and neighborhood event life. It began as Bay Area Show Explorer, a music calendar built from imported concert listings, and is now widening into a more flexible guide for things worth leaving the house for.

Show Explorer is the first offering inside Mike's List. It focuses on artist-backed music listings while keeping broader event classification available in the local review tools.

The project is intentionally careful:

- Original sources stay credited and linked.
- Artists, venues, and shows can be reviewed before they become trusted.
- The local data model can classify event-style records, but public pages display artist shows.
- Public pages avoid exposing internal review status.

## Local Preview

Start the local server:

```powershell
.\shows
```

Then open:

```text
http://127.0.0.1:4173/
```

Useful public pages:

```text
http://127.0.0.1:4173/
http://127.0.0.1:4173/show-explorer.html
http://127.0.0.1:4173/mike-says.html
http://127.0.0.1:4173/sources.html
```

Admin pages require a local access key:

```powershell
$env:SHOW_EXPLORER_ADMIN_KEY="your-local-admin-key"
.\shows
```

The local server provides login, protected admin pages, and save endpoints for review work. A static host alone will not run that backend.

Artist Review can also look up Spotify artist matches and fallback images through the Spotify Web API. Add these values to `.env` or set them in your terminal before starting the local server:

```powershell
$env:SPOTIFY_CLIENT_ID="your-spotify-client-id"
$env:SPOTIFY_CLIENT_SECRET="your-spotify-client-secret"
```

The Spotify lookup uses server-side credentials, so the client secret is never shipped to the public browser code. The public artist bundle includes only the display-safe Spotify link and fallback image fields.

See `docs/spotify-enrichment-notes.md` for implementation notes, current rate-limit handling, and suggested next refinements.

## Common Tasks

Back up the current data files before risky cleanup or import work:

```powershell
npm run data:backup
```

Backups are written under `data/backups/`, which is ignored by Git.

Create or refresh the local SQLite working database from the current JavaScript data files:

```powershell
npm run db:init -- --reset
```

Preview exporting the existing public/admin JavaScript data bundles from SQLite:

```powershell
npm run db:export -- --dry-run
```

The SQLite database is the planned safer local source of truth for review work. For now, the live site still reads the generated JavaScript files in `data/`. See `docs/data-model.md` for the migration plan.

Replay saved merge/delete decisions and saved show overrides against the current event data:

```powershell
node --no-warnings=ExperimentalWarning scripts/apply-sqlite-decisions.mjs
```

The normal `.\update-shows` flow now syncs an import ledger and then replays saved decisions after imports and pruning. That means source listings get a first-seen/last-seen/fingerprint record in SQLite, show records deleted or merged in Show Review can be suppressed again if the same source listing appears in a later scrape, and saved Show Review fields can be reapplied to matching shows.

Mirror the current reviewed JavaScript data into SQLite without scraping:

```powershell
node --no-warnings=ExperimentalWarning scripts/sync-sqlite-canonical.mjs
```

Local admin saves and `.\update-shows` now run this sync so SQLite keeps a current copy of the reviewed artist, venue, and show state while the UI still reads the JavaScript bundles.

Refresh imported listings:

```powershell
.\update-shows
```

Refresh from today and include the next few KALX weekly event pages:

```powershell
.\update-shows --from=today --kalx-weeks=3
```

Check which KALX weekly pages the importer will read:

```powershell
node scripts\import-kalx.mjs --from=today --kalx-weeks=3 --list-urls
```

Merge likely duplicate show records after imports:

```powershell
npm run dedupe:events
```

Preview duplicate merges first:

```powershell
npm run dedupe:events -- --dry-run
```

Refine upcoming artists:

```powershell
.\refine-upcoming --days=14
```

Rebuild the smaller public artist bundle after standalone artist enrichment or cleanup scripts:

```powershell
npm run build:public-artists
```

Remove past events and untouched artists that are no longer attached to current/future listings:

```powershell
npm run prune:past -- --before=today
```

Preview the cleanup first:

```powershell
npm run prune:past -- --before=today --dry-run
```

Review the project locally:

```text
http://127.0.0.1:4173/admin.html
```

Useful admin areas include artist review, venue review, show review, source checks, and suggestion review.

Artist and venue review pages can merge records when a wrong name is still a useful redirect pattern. They can also fully delete the selected artist or venue when the record is only a typo or junk entry.

The full `data/artists.js` file is the admin/review store. Public pages load `data/public-artists.js`, a generated bundle with review notes, evidence, appearances, and research-only search links stripped out.

Local admin saves write back to the data files through `scripts/dev-server.mjs`. Show saves also rebuild the artist, public artist, and venue stores so reviewed event changes stay in sync with public bundles.

The public Show Explorer map uses the locally vendored MapLibre GL files in `assets/vendor/maplibre/` with CARTO basemap styles loaded from `basemaps.cartocdn.com`. The map will render only when the browser can reach CARTO's style and tile endpoints.

## Data Sources

Mike's List currently works with listings from:

- [The List](https://jon.luini.com/thelist/date.html)
- [KALX 90.7 FM](https://www.kalx.berkeley.edu/events/)

These sources have different strengths. The List is especially useful for music listings, and KALX adds curated weekly calendar coverage.

## Deployment Notes

The public pages can be served as static files. Netlify Functions provide live login/session endpoints and Spotify artist lookup for Artist Review, but normal data-file saves still depend on the local Node server in `scripts/dev-server.mjs`.

Set these Netlify environment variables with Functions scope before deploying live admin Spotify lookup:

```text
SHOW_EXPLORER_ADMIN_KEY
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
```

Live Artist Review can use Spotify lookup and save the result in the current browser. To make those changes part of the public site, save/rebuild locally, commit the generated data files, and deploy. Before launching full live admin editing, the project still needs persistent production saves such as Netlify Functions writing through GitHub, a database, Clerk, or a hosted Node server. Do not commit real API keys or admin access keys.

## Project Notes

This is a working prototype, not a commercial calendar. The goal is to build a humane review workflow around messy event data, so imported listings can become a cleaner, more useful public guide over time.
