# Bay Area Show Explorer

A non-commercial prototype for adding artist context to S.F. Bay Area concert listings from [The List](https://jon.luini.com/thelist/date.html).

The project is deliberately conservative:

- The original listing source stays credited and linked.
- Imported artists start as `review` confidence until enriched or manually verified.
- Direct support links, such as Bandcamp and artist pages, are favored over platform-only discovery.
- Ambiguous artist names are treated as unresolved instead of guessed.

## Open the Prototype

For read-only browsing, open `index.html` in a browser. To save review edits directly to `data/artists.js`, use the local dev server:

```powershell
.\shows
```

If your npm install is available, `npm start` or `npm run shows` starts the same server.

Then open:

```text
http://127.0.0.1:4173/review.html
```

## Import Current Listings

When network access is available, run:

```powershell
.\update-shows
```

That command retrieves current listings from The List, then rebuilds the artist and venue stores while preserving records you have already reviewed. By default it imports shows dated today or later. To import from The List's own last-updated date instead, run:

```powershell
.\update-shows --from=updated
```

To import a specific window start:

```powershell
.\update-shows --from=2026-06-01
```

The page loads `data/sample-events.js` first and then `data/imported-events.js` when it exists, so imported data automatically replaces the small sample set. Show Explorer starts the calendar range at today's date, so older imported records do not appear by default but remain searchable when the date range is changed.

`update-shows` also imports the latest linked KALX Weekly Entertainment Calendar pages, merges duplicate listings by date, venue, and listing text, and preserves source links for The List and KALX. KALX archive weeks can be backfilled directly:

```powershell
node scripts/import-kalx.mjs --from=2026-05-18 --weeks=2
node scripts/classify-event-metadata.mjs
node scripts/build-artist-store.mjs
node scripts/build-venue-store.mjs
```

Event names that are not performers, such as karaoke, trivia, open mics, story slams, film screenings, and theme nights, are stored as event metadata instead of artist records. The main calendar exposes event type and theme chips so those listings can be searched and filtered without polluting the artist queue. The main calendar also has `From` and `To` date fields. It starts at today's date by default, but clearing or changing the range lets visitors search past imported calendars and future windows.

The default Show Explorer filter is music-first: it includes artist-backed shows and music-adjacent events such as karaoke, cover bands, dance nights, jams, open mics, and theme nights, while keeping trivia, book events, poetry, chess, games, comedy, film, and storytelling out of the default public view. Use `All` or the event-type filters to audit those non-music records.

BadSlava is used as a dedicated non-music event source. By default it imports statewide California category feeds, filters them down to the project footprint, and creates event records without artist records for trivia, open mics, poetry, book events, chess, dance, game nights, and karaoke:

```powershell
node scripts/import-badslava.mjs
node scripts/classify-event-metadata.mjs
node scripts/build-venue-store.mjs
```

To target one category:

```powershell
node scripts/import-badslava.mjs --category=karaoke
```

To import a specific BadSlava date window:

```powershell
node scripts/import-badslava.mjs --from=2026-06-01 --to=2026-06-07
```

BadSlava venue detail pages can also enrich existing venue records without crawling the site:

```powershell
node scripts/enrich-venues-badslava.mjs --venue="The Freight" --url=https://badslava.com/details.php?id=1094
```

The enrichment step fills blank venue address, city, region, phone, source links, and recurring-event details from the supplied detail page. Phone and recurring-event fields are reviewable in `venue-review.html`.

## Review Artists

Open `review.html` through the local dev server to work through the artist queue. `Save Artist` writes to `data/artists.js` when the dev server is running. If the page is opened without the dev server, it falls back to browser storage. `Revert Form` discards unsaved changes in the current form only. `Clear Browser Store` is the destructive reset that reloads from `data/artists.js`. Export remains available as a backup.

The artist and venue review pages default to the upcoming 7-day date range. Use the `From` and `To` fields to focus the queue on a specific review window, or clear both fields to review all records with stored appearances.

Use `admin.html` as the back-office landing page. It links directly to artist review, venue review, Show Explorer, and source-checking pages so review work does not have to start from a public-facing navigation path.

`Enrich Artist` is enabled for artists marked `Likely`. It saves the current artist first, then asks the local dev server to run Wikidata, MusicBrainz, Discogs-link cleanup, and normalization for that selected artist.

Rejected links are sticky: enrichment should not revive the same URL after you reject it. Enrichment also uses user-provided Spotify, MusicBrainz, and Discogs artist links as stronger lookup seeds before trying a name-only search. Name-only Wikidata enrichment now requires an exact artist-name match and skips record-label entities, which avoids cases like "The Famous" becoming "The Famous Charisma Label."

When verified official, Bandcamp, or Facebook links exist, enrichment also tries to fill empty locality, genres, and summary from page metadata/text. It only fills blank or `unknown` fields; it does not overwrite reviewed values.

Typed links use this format:

```text
bandcamp | Bandcamp | https://artist.bandcamp.com/ | verified
instagram | Instagram | https://instagram.com/artist | likely
official | Official | https://artist.example.com/ | verified
```

Support Priority is computed from verified link types. Official pages are listed first, link hubs such as Linktree second, and the remaining verified source types are sorted alphabetically.

## Optional Enrichment

Some optional enrichment sources need local API credentials. Keep real keys in a local `.env` file and do not commit that file to GitHub. A safe template is included as `.env.example`.

For Google Places:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```text
GOOGLE_PLACES_API_KEY=your_key_here
```

Restrict the key in Google Cloud as tightly as practical, ideally to the Places API and your local/development use.

Venue enrichment uses Google Places when `GOOGLE_PLACES_API_KEY` is present:

```powershell
node scripts/enrich-venues-google-places.mjs --venue="4 Star Theater"
```

The browser `Enrich Venue` button runs Wikidata, Google Places, and verified-page metadata enrichment in sequence through the local dev server. Google Places is used only on the server side; the key is never sent to browser JavaScript.

Spotify is not required. MusicBrainz can add stable artist identity candidates without any paid account:

```powershell
node scripts/enrich-musicbrainz.mjs --limit=25
```

The script is intentionally conservative and rate-limited. It only marks high-score name matches as `likely`, adds a MusicBrainz link, and records evidence for review.

Wikidata is useful for well-known artists because it can supply official sites, social IDs, Wikipedia, Discogs, MusicBrainz, and some streaming IDs without Spotify credentials:

```powershell
node scripts/enrich-wikidata.mjs --limit=25
node scripts/enrich-wikidata.mjs --artist="2 Chainz"
```

Manual submissions can be applied from JSON:

```powershell
node scripts/apply-artist-submission.mjs --file=docs/submissions/2-chainz.json
```

To clean up stored link statuses after imports or manual edits:

```powershell
node scripts/normalize-artist-store.mjs
```

To refine only artists with shows coming up soon:

```powershell
.\refine-upcoming --days=14
```

That command looks at imported events in the next date window, skips artists that are already `likely` or `verified`, and reuses the conservative review reconsideration checks for the remaining upcoming artists.

To preview the queue without changing artist data:

```powershell
.\refine-upcoming --days=14 --list-only
```

Discogs links can be labeled with artist/alias/legal-name context when the public Discogs API is reachable:

```powershell
node scripts/enrich-discogs-links.mjs --artist="2 Chainz"
```

## Next Build Steps

1. Improve parser accuracy against The List's live HTML.
2. Add an enrichment store for MusicBrainz, Spotify, Bandcamp, Instagram, and official-site links.
3. Add a human review page for accepting or rejecting candidate matches.
4. Contact the site maintainers before making a public version easy to find.
