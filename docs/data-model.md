# Data Model Notes

## Direction

Mike's List is moving toward a SQLite-backed local admin workflow with static
public exports. The database should become the local source of truth for
reviewed data, imported snapshots, merge/delete decisions, and manual
overrides. The existing `data/*.js` files should eventually become generated
public/admin bundles, not the place where important review work primarily
lives.

The guiding rule: imports may add evidence, but they should not erase Mike's
decisions. Manual choices such as merges, deletions, Mike's Picks, verified
links, reviewed images, and review notes need to be durable and replayable
after future imports.

During the transition, local admin saves and `.\update-shows` create timestamped
backups of the JavaScript data files under `data/backups/` before rewriting
them. Those backups are ignored by Git and are meant as local recovery points.

The initial schema lives in `data/sqlite/schema.sql`.

Useful setup commands:

```powershell
npm run db:init -- --reset
npm run db:export -- --dry-run
```

`db:init` imports the current JavaScript stores into `data/mikeslist.sqlite`.
`db:export` can regenerate the existing JavaScript data files from SQLite once
we are ready to make the database-backed workflow primary. The SQLite file is
local-only and ignored by Git.

The existing update flow now includes `scripts/sync-sqlite-imports.mjs` and
`scripts/apply-sqlite-decisions.mjs`. The import sync step records the current
imported source rows with first-seen/last-seen timestamps and content
fingerprints. The decision step replays saved show merge/delete suppressions
after source imports.

The flow also includes `scripts/sync-sqlite-canonical.mjs`, which mirrors the
current reviewed JavaScript stores into canonical SQLite tables. This is still
an intermediate safety step: the app writes and reads JavaScript bundles, but
imported evidence, resolved duplicate/deleted show rows, and the latest reviewed
show/artist/venue state have durable SQLite records that can be inspected and
reapplied when a scrape covers the same source period again. Saved Show Review
fields are also mirrored into `show_overrides` so manually reviewed show data
can be restored after imports.

This project has three primary entity types: artists, venues, and events. Artist data is already treated as a reviewable enrichment store; venues and events should follow the same principle, but with different trust rules.

## Artist

Artists are people, bands, DJs, collectives, or other performers. Artist profiles are review-heavy because names collide often and source quality varies widely.

Recommended fields:

- `id`: stable slug from canonical artist name
- `name`: display name from the best reviewed source
- `aliases`: alternate spellings or billing variants
- `confidence`: `review`, `likely`, or `verified`
- `locality`: origin or current base when known
- `genres`: reviewed or source-derived genre tags
- `summary`: short human-readable description
- `imageUrl`: reviewed public image URL
- `imageSource`: optional image credit text; public UI renders this as `Source: {imageSource}` and falls back to the image URL domain when blank
- `links`: reviewed source links with type, label, URL, confidence, and source
- `reviewNotes`: human notes for unresolved ambiguity
- `evidence`: machine notes about how enrichment happened
- `updatedAt`: last profile update

## Venue

Venues should be a relatively stable store. New venues appear occasionally, but most changes are address, naming, website, age policy, or closure status updates.

Recommended fields:

- `id`: stable slug, preferably based on The List anchor when available
- `name`: imported or canonical source name
- `displayName`: public-facing name to show in the interface
- `aliases`: alternate names, former names, and spelling variants
- `mergedInto`: target venue id when this record is a duplicate of another venue
- `confidence`: `review`, `likely`, `verified`, or `rejected`
- `status`: `active`, `inactive`, `closed`, `seasonal`, or `unknown`
- `venueType`: `club`, `theater`, `arena`, `bar`, `gallery`, `outdoor`, `festival-site`, `house-show`, `other`, or `unknown`
- `city`: city or neighborhood when known
- `region`: Bay Area subregion, such as SF, East Bay, South Bay, Peninsula, North Bay, Santa Cruz/Monterey
- `address`: street address when useful
- `imageUrl`: reviewed public image URL
- `imageSource`: optional image credit text; public UI renders this as `Source: {imageSource}` and falls back to the image URL domain when blank
- `geo`: latitude/longitude when known
- `agePolicy`: `all-ages`, `18+`, `21+`, `mixed`, or `unknown`
- `capacity`: rough capacity if known
- `accessibilityNotes`: optional human-reviewed notes
- `links`: official site, ticketing page, Instagram, Facebook, maps, The List anchor
- `sourceRefs`: where the venue data came from
- `reviewNotes`: human notes
- `updatedAt`: last profile update

Venue confidence can be mostly link-level rather than profile-level. A venue name and The List anchor can be accepted as a useful starting point, while address, official site, and status should be reviewed before being treated as verified.

Rejected venues are for listings that should not drive artist discovery, such as one-off private/pop-up locations with no useful public profile. Duplicate venues should generally be merged rather than rejected; the duplicate record can point at the target with `mergedInto`.

## Event

Events are time-bound listings. They can be canceled, rescheduled, renamed, merged, split, or have lineup changes. The model should preserve imported snapshots instead of pretending the newest import is the only truth.

In the SQLite model, current reviewed shows live separately from raw imported
source rows. Raw imports are kept as snapshots. Shows represent the local
canonical version the app should display or review.

Recommended fields:

- `id`: stable local event id
- `date`: event date
- `venueId`: link to venue store
- `venueNameSnapshot`: venue name as imported at the time
- `title`: event title when separate from artist lineup
- `lineup`: ordered list of artist slots
- `detailsRaw`: original details text from The List
- `times`: parsed doors/show times when available
- `price`: parsed price range when available
- `agePolicy`: parsed event-specific age policy
- `seating`: seated/standing when available
- `ticketStatus`: `available`, `sold-out`, `canceled`, `postponed`, `unknown`
- `status`: `scheduled`, `canceled`, `postponed`, `rescheduled`, `past`, or `unknown`
- `sourceUrl`: The List source URL
- `imageUrl`: reviewed public image URL for featured cards
- `imageSource`: optional image credit text; public UI renders this as `Source: {imageSource}` and falls back to the image URL domain when blank
- `sourceFingerprint`: hash of the source row content
- `lastSeenAt`: most recent import where this event appeared
- `firstSeenAt`: first import where this event appeared
- `changeLog`: notable imported changes

Lineup slot fields:

- `artistId`: link to artist store when resolvable
- `nameSnapshot`: artist name as billed
- `billingOrder`: imported order
- `role`: `headliner`, `support`, `dj`, `host`, `speaker`, `film`, `unknown`
- `status`: `scheduled`, `removed`, `added`, `unknown`

## Event Identity

The current import creates event ids from `date + venue + first artist`, but this is not enough long-term because a single venue can have multiple listings on the same day. The imported data already shows many same-day venue collisions.

A better event matching key should combine:

- normalized date
- venue id or The List venue anchor
- parsed show time when available
- normalized first billed artist or event title
- source row position as a fallback

The stored `id` should remain stable once created. If a later import changes artist names or details, the importer should update the same event when the match is strong and append to `changeLog` when the row content changed.

Resolved decisions should live outside the raw import itself:

- `decisions` records merge, delete, verify, reject, and enrichment actions.
- `suppressed_imports` records source listings or fuzzy event identities that
  should not reappear after a later scrape.
- Raw import rows keep `firstSeenAt`, `lastSeenAt`, and a content fingerprint so
  source changes can be reviewed without overwriting canonical fields.

## Suggested Build Order

1. Create the SQLite schema and migration scripts while the existing app still
   reads `data/*.js`.
2. Import current artists, venues, shows, source listings, lineups, links, and
   aliases into SQLite.
3. Add database-backed snapshots/backups and decision logging for local admin
   saves.
4. Change import scripts to write raw import rows, then apply durable decisions
   before generating display records.
5. Change admin review pages to save through SQLite instead of rewriting the
   JavaScript files directly.
6. Export static `data/*.js` bundles from SQLite for Netlify/public display.
