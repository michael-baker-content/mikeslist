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
node scripts/import-thelist.mjs
node scripts/build-artist-store.mjs
```

The page loads `data/sample-events.js` first and then `data/imported-events.js` when it exists, so imported data automatically replaces the small sample set.

## Review Artists

Open `review.html` through the local dev server to work through the artist queue. `Save Artist` writes to `data/artists.js` when the dev server is running. If the page is opened without the dev server, it falls back to browser storage. `Revert Form` discards unsaved changes in the current form only. `Clear Browser Store` is the destructive reset that reloads from `data/artists.js`. Export remains available as a backup.

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

Discogs links can be labeled with artist/alias/legal-name context when the public Discogs API is reachable:

```powershell
node scripts/enrich-discogs-links.mjs --artist="2 Chainz"
```

## Next Build Steps

1. Improve parser accuracy against The List's live HTML.
2. Add an enrichment store for MusicBrainz, Spotify, Bandcamp, Instagram, and official-site links.
3. Add a human review page for accepting or rejecting candidate matches.
4. Contact the site maintainers before making a public version easy to find.
