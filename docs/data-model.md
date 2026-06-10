# Data Model Notes

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

## Suggested Build Order

1. Create `data/venues.js` from current imported events, keyed by normalized venue id.
2. Update imported events to reference `venueId` while preserving `venueNameSnapshot`.
3. Parse event `detailsRaw` into structured fields for age policy, price, doors/show times, seating, and flags.
4. Add event snapshot tracking: `firstSeenAt`, `lastSeenAt`, `sourceFingerprint`, and `changeLog`.
5. Build a venue review page similar to the artist review page, but simpler.
6. Add event status/change detection after repeated imports establish history.
