# Mike's List

Mike's List is a local listings project for SF Bay Area music shows, venues, and artists. It began as Bay Area Show Explorer and is now framed as a more personal, editorial guide to artist-backed listings.

Show Explorer is the core browsing experience inside Mike's List. It focuses on artist-backed music listings while keeping broader event classification available in the local review tools.

The project is intentionally careful:

- Original sources stay credited and linked.
- Artists, venues, and shows can be reviewed before they become trusted.
- The local data model can classify event-style records, but public pages display artist shows.
- Public pages avoid exposing internal review status.

## Local Preview

Install dependencies and build the site first (Node 22.12 or later):

```powershell
npm install
npm run build
```

Astro generates Mike Says from Markdown in `content/mike-says/`. The build then copies the existing public and review pages, assets, and generated data into `dist/`. Netlify publishes that directory. Show Explorer, artist pages, venue pages, and local review tools retain their existing implementation; the live site still reads JavaScript data bundles rather than SQLite.

Start the local server yourself:

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
http://127.0.0.1:4173/about.html
```

Admin pages require a local access key:

```powershell
$env:SHOW_EXPLORER_ADMIN_KEY="your-local-admin-key"
.\shows
```

The local server provides login, protected admin pages, and save endpoints for review work. A static host alone will not run that backend.

The local server serves generated Mike Says pages from `dist/` and the other pages from the working files. Run `npm run build` again after changing blog posts or Astro templates, and before deployment. See **Mike Says articles** below for front matter, playlists, drafts, and publishing instructions.

Artist Review can also look up Spotify artist matches and fallback images through the Spotify Web API. Add these values to `.env` or set them in your terminal before starting the local server:

```powershell
$env:SPOTIFY_CLIENT_ID="your-spotify-client-id"
$env:SPOTIFY_CLIENT_SECRET="your-spotify-client-secret"
```

The Spotify lookup uses server-side credentials, so the client secret is never shipped to the public browser code. The public artist bundle includes only the display-safe Spotify link and fallback image fields. On the live static site, Spotify lookup results are saved to that browser's local Artist Review storage until the reviewed data is saved locally, committed, and deployed.

See `docs/spotify-enrichment-notes.md` for implementation notes, current rate-limit handling, and suggested next refinements.

Artist page enrichment validates Instagram and Facebook outbound links before URL cleanup. It accepts profile paths and excludes platform homepages, support/developer subdomains, login and other interface routes, and post/reel links. Facebook numeric profile IDs are preserved. Discovered profiles remain candidates for review; this filter does not remove previously saved links.

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

Show Review's Sort menu includes Venue (A–Z), which groups shows alphabetically by venue name, then orders shows at the same venue by date and title. It applies within the current search and filters.

Show Explorer marks Mike's Picks with a compact white checkmark in a blue circle over the show image. The badge retains a "Mike's Pick" tooltip and accessible label.

Capitalization edits in Show Review's artist list are preserved when saving, while keeping the existing lineup artist's other details. These edits apply to that show's lineup; the shared artist profile is managed in Artist Review.

When merging shows with different dates, Show Review's confirmation warns about the mismatch, displays both dates, and explains that the canonical show's date will be kept. Cancel leaves the shows unmerged.

Artist and venue review pages can merge records when a wrong name is still a useful redirect pattern. They can also fully delete the selected artist or venue when the record is only a typo or junk entry.

The full `data/artists.js` file is the admin/review store. Public pages load `data/public-artists.js`, a generated bundle with review notes, evidence, appearances, and research-only search links stripped out.

Local admin saves write back to the data files through `scripts/dev-server.mjs`. Show saves also rebuild the artist, public artist, and venue stores so reviewed event changes stay in sync with public bundles.

The public Show Explorer map uses the locally vendored MapLibre GL 6.9.0 files in `assets/vendor/maplibre/` with CARTO basemap styles loaded from `basemaps.cartocdn.com`. Map access lives inside the Show Explorer `Map and Filters` panel so dates, options, venue, city, and sort can be refined before opening the map. The map offers Light and Dark styles, defaulting to the current site theme. The map will render only when the browser can reach CARTO's style and tile endpoints.

## Mike Says articles

Mike Says uses Astro to generate static pages from Markdown files in `content/mike-says/`. Edit an existing file to update an article, add a file for a new article, or delete a file to remove it. The filename determines its permanent URL: `example.md` becomes `/mike-says/example.html`. Keep filenames stable after publication.

Each file begins with YAML front matter:

```markdown
---
title: "This week on Mike's List"
description: "A short introduction for the archive."
date: "2026-09-21"
draft: true
spotifyPlaylist: "https://open.spotify.com/playlist/3Wqc8phZ9kiWCa3cXe02cp"
---

Write the article here using **Markdown** or HTML tags.
```

The Spotify field is optional; when supplied, the article gets its own playlist embed below the body. Replace it with that week's playlist. Quote dates as shown. Omitted `draft` defaults to true. Drafts are excluded from generated pages and archives. Future-dated posts are also excluded until a build on or after their date in America/Los_Angeles; there is no automatic scheduled publishing. The original introductory note remains undated.

The September 14–20 article is preserved in `content/mike-says/mikes-picks-september-14-20-2026.md` with `draft: true`. It is not published. The former editor files and article data were backed up under the ignored `data/backups/pre-astro-blog-2026-09-13/` folder before retirement. Browser-only drafts, if any, have not been migrated.

### Local workflow

Use Node 22.12 or later (Node 24 is configured for deployment). Run these commands yourself from the project folder:

```powershell
npm install
npm run build
```

The first command installs Astro and updates `package-lock.json`; include that updated lockfile in the next commit. The second generates `dist/`, combining Astro's blog pages with the existing static pages, assets, and generated JS data. Markdown source files and local data backups are not copied into the deployed site.

Rebuild after editing posts. The existing local server serves Mike Says from `dist/` and the other pages from the working files. Its updated routing takes effect the next time you restart it yourself. Installation, builds, and server lifecycle remain user-operated.

To publish an article, finish the Markdown, set `draft: false`, build and review it, then use the normal GitHub deployment workflow. Netlify now runs `npm run build` and publishes `dist/`. Draft Markdown is still part of the repository if committed, so draft status prevents website publication, not repository visibility.

The latest published article appears in full on `/mike-says.html`; earlier articles appear in its archive. Every published article also has a permanent page. Old `mike-says.html?post=...` links redirect to the matching article in the browser. There is no article admin editor or article-save API.

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

MapLibre uses browser ES modules, loaded before the Show Explorer application by `assets/show-explorer-bootstrap.js`. Keep the bundled module, shared module, worker, CSS, source maps, and license in `assets/vendor/maplibre/` synchronized with the installed package when upgrading; changing npm dependencies alone does not update browser assets.
