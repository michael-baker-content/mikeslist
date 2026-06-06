# Bay Area Show Explorer

Bay Area Show Explorer is a small, human-reviewed calendar for live music and adjacent nightlife around the Bay Area. It started as a way to make imported show listings easier to browse, verify, and enrich, with a special focus on helping real artists, venues, and event organizers stay visible.

The project is intentionally careful:

- Original sources stay credited and linked.
- Imported artist and venue records are reviewable before they become trusted.
- Non-artist listings, such as karaoke, trivia, open mics, poetry, and game nights, are tracked as shows without polluting the artist queue.
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

Review the project locally:

```text
http://127.0.0.1:4173/admin.html
```

Useful admin areas include artist review, venue review, show review, source checks, and suggestion review.

## Data Sources

The project currently works with listings from:

- [The List](https://jon.luini.com/thelist/date.html)
- [KALX 90.7 FM](https://www.kalx.berkeley.edu/events/)
- [BadSlava](https://badslava.com/open-mics.php?state=CA)

These sources have different strengths. The List is especially useful for music listings, KALX adds curated weekly calendar coverage, and BadSlava helps identify non-music community events and venue details.

## Deployment Notes

The public pages can be served as static files, but the admin workflow currently depends on the local Node server in `scripts/dev-server.mjs`.

Before launching a live admin area, the project needs a production backend such as Netlify Functions, Clerk, or a hosted Node server. Do not commit real API keys or admin access keys.

## Project Notes

This is a working prototype, not a commercial calendar. The goal is to build a humane review workflow around messy event data, so imported listings can become a cleaner, more useful public guide over time.
