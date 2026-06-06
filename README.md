# Mike's List

Mike's List is a local listings project for Bay Area shows, venues, artists, and neighborhood event life. It began as Bay Area Show Explorer, a music calendar built from imported concert listings, and is now widening into a more flexible guide for things worth leaving the house for.

Show Explorer is the first offering inside Mike's List. It focuses on music listings, while also making room for karaoke, trivia, open mics, poetry, games, dance nights, cover bands, and other venue-based events without pretending those are all artists.

The project is intentionally careful:

- Original sources stay credited and linked.
- Artists, venues, and shows can be reviewed before they become trusted.
- Music and non-music listings share a show model, but keep their own review paths.
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

Admin pages require a local access key:

```powershell
$env:SHOW_EXPLORER_ADMIN_KEY="your-local-admin-key"
.\shows
```

The local server provides login, protected admin pages, and save endpoints for review work. A static host alone will not run that backend.

## Common Tasks

Refresh imported listings:

```powershell
.\update-shows
```

Refine upcoming artists:

```powershell
.\refine-upcoming --days=14
```

Rebuild the smaller public artist bundle after standalone artist enrichment or cleanup scripts:

```powershell
npm run build:public-artists
```

Review the project locally:

```text
http://127.0.0.1:4173/admin.html
```

Useful admin areas include artist review, venue review, show review, source checks, and suggestion review.

The full `data/artists.js` file is the admin/review store. Public pages load `data/public-artists.js`, a generated bundle with review notes, evidence, appearances, and research-only search links stripped out.

## Data Sources

Mike's List currently works with listings from:

- [The List](https://jon.luini.com/thelist/date.html)
- [KALX 90.7 FM](https://www.kalx.berkeley.edu/events/)
- [BadSlava](https://badslava.com/open-mics.php?state=CA)

These sources have different strengths. The List is especially useful for music listings, KALX adds curated weekly calendar coverage, and BadSlava helps identify non-music community events and venue details.

## Deployment Notes

The public pages can be served as static files, but the admin workflow currently depends on the local Node server in `scripts/dev-server.mjs`.

The included `netlify.toml` treats Netlify as a public-only static deploy for now and redirects admin pages back to the public calendar. Before launching a live admin area, the project needs a production backend such as Netlify Functions, Clerk, or a hosted Node server. Do not commit real API keys or admin access keys.

## Project Notes

This is a working prototype, not a commercial calendar. The goal is to build a humane review workflow around messy event data, so imported listings can become a cleaner, more useful public guide over time.
