const STORE_KEY = "bay-area-show-explorer-artists";
const EVENTS_STORE_KEY = "bay-area-show-explorer-events";
const baseStore = window.SHOW_EXPLORER_ARTISTS || { artists: {} };
const savedStore = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const artistStore = newerStore(savedStore, baseStore);
const baseEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const savedEvents = JSON.parse(localStorage.getItem(EVENTS_STORE_KEY) || "null");
const events = Array.isArray(savedEvents) ? JSON.parse(JSON.stringify(savedEvents)) : JSON.parse(JSON.stringify(baseEvents));

const state = {
  query: "",
  filter: "review",
  venue: "all",
  sort: "name",
  fromDate: todayString(),
  toDate: dateStringFromOffset(6),
  selectedId: ""
};

const queue = document.querySelector("#artistQueue");
const form = document.querySelector("#artistForm");
const search = document.querySelector("#artistSearch");
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const venueFilterInput = document.querySelector("#venueFilterInput");
const artistSortInput = document.querySelector("#artistSortInput");
const filterButtons = [...document.querySelectorAll("[data-review-filter]")];
const enrichButton = document.querySelector("#enrichButton");
const previousArtistButton = document.querySelector("#previousArtistButton");
const nextArtistButton = document.querySelector("#nextArtistButton");

const fields = {
  selectedName: document.querySelector("#selectedName"),
  selectedConfidence: document.querySelector("#selectedConfidence"),
  confidence: document.querySelector("#confidenceInput"),
  displayName: document.querySelector("#displayNameInput"),
  locality: document.querySelector("#localityInput"),
  genres: document.querySelector("#genresInput"),
  imageUrl: document.querySelector("#imageUrlInput"),
  priority: document.querySelector("#priorityInput"),
  summary: document.querySelector("#summaryInput"),
  links: document.querySelector("#linksEditor"),
  rejectedLinks: document.querySelector("#rejectedLinksEditor"),
  rejectedSection: document.querySelector("#rejectedLinksSection"),
  rejectedCount: document.querySelector("#rejectedLinkCount"),
  note: document.querySelector("#noteInput"),
  mergeArtist: document.querySelector("#mergeArtistInput"),
  appearanceHeading: document.querySelector("#appearanceHeading"),
  appearances: document.querySelector("#appearanceList"),
  artistPosition: document.querySelector("#artistPosition"),
  saveStatus: document.querySelector("#saveStatus")
};

const linkTypes = [
  "bandcamp",
  "official",
  "linktree",
  "instagram",
  "facebook",
  "twitter",
  "tiktok",
  "youtube",
  "youtubeMusic",
  "soundcloud",
  "discogsArtist",
  "discogsAlias",
  "discogsLegalName",
  "musicbrainz",
  "wikidata",
  "wikipedia",
  "appleMusic",
  "spotify",
  "deezer",
  "tidal",
  "amazonMusic",
  "ticketmaster",
  "qobuz",
  "search",
  "other"
];

const confidenceOptions = ["research", "candidate", "likely", "verified", "rejected"];

function newerStore(saved, base) {
  if (!saved) return JSON.parse(JSON.stringify(base));
  const savedTime = Date.parse(saved.generatedAt || "");
  const baseTime = Date.parse(base.generatedAt || "");
  if (Number.isFinite(savedTime) && Number.isFinite(baseTime)) {
    return JSON.parse(JSON.stringify(savedTime > baseTime ? saved : base));
  }
  return JSON.parse(JSON.stringify(saved));
}

function artists() {
  return Object.values(artistStore.artists || {});
}

function todayString() {
  return dateStringFromOffset(0);
}

function dateStringFromOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function artistText(artist) {
  return [
    artist.name,
    artist.displayName,
    artist.locality,
    artist.imageUrl,
    artist.summary,
    artist.disambiguation,
    artist.reviewNotes,
    ...(artist.aliases || []),
    ...(artist.genres || artist.tags || []),
    ...(artist.links || []).flatMap((link) => [link.type, link.label, link.url, link.confidence]),
    ...(artist.evidence || []).flatMap((item) => [item.url, item.note]),
    ...(artist.source?.appearances || []).flatMap((show) => [show.date, show.venue, show.details])
  ].join(" ").toLowerCase();
}

function visibleArtists() {
  const query = state.query.trim().toLowerCase();
  return artists().filter((artist) => {
    const filterMatch = state.filter === "all" || artist.confidence === state.filter;
    const queryMatch = !query || artistText(artist).includes(query);
    const appearances = appearancesInRange(artist.source?.appearances || []);
    const dateMatch = !state.fromDate && !state.toDate ? true : appearances.length > 0;
    const venueMatch = state.venue === "all" || appearances.some((appearance) => venueKey(appearance.venue) === state.venue);
    return filterMatch && queryMatch && dateMatch && venueMatch;
  }).sort(compareArtistsForQueue);
}

function appearancesInRange(appearances) {
  return appearances.filter((appearance) => {
    if (state.fromDate && appearance.date < state.fromDate) return false;
    if (state.toDate && appearance.date > state.toDate) return false;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.venue || "").localeCompare(b.venue || ""));
}

function preferredFilter() {
  for (const filter of ["review", "likely", "verified"]) {
    if (artists().some((artist) => artist.confidence === filter)) return filter;
  }
  return "all";
}

function compareArtistsForQueue(a, b) {
  if (state.sort === "venue") {
    return primaryVenueForArtist(a).localeCompare(primaryVenueForArtist(b))
      || nextDateForArtist(a).localeCompare(nextDateForArtist(b))
      || a.name.localeCompare(b.name);
  }
  if (state.sort === "date") {
    return nextDateForArtist(a).localeCompare(nextDateForArtist(b))
      || primaryVenueForArtist(a).localeCompare(primaryVenueForArtist(b))
      || a.name.localeCompare(b.name);
  }
  if (state.sort === "status") {
    return confidenceSortRank(a.confidence) - confidenceSortRank(b.confidence)
      || primaryVenueForArtist(a).localeCompare(primaryVenueForArtist(b))
      || a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

function primaryVenueForArtist(artist) {
  return appearancesInRange(artist.source?.appearances || [])[0]?.venue || "";
}

function nextDateForArtist(artist) {
  return appearancesInRange(artist.source?.appearances || [])[0]?.date || "9999-12-31";
}

function confidenceSortRank(confidence = "review") {
  return { review: 0, likely: 1, verified: 2, rejected: 3 }[confidence] ?? 4;
}

function venueKey(value = "") {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderVenueFilterOptions() {
  const current = state.venue;
  const venues = new Map();
  artists().forEach((artist) => {
    appearancesInRange(artist.source?.appearances || []).forEach((appearance) => {
      if (!appearance.venue) return;
      venues.set(venueKey(appearance.venue), appearance.venue);
    });
  });
  venueFilterInput.replaceChildren(new Option("All venues", "all"));
  [...venues.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([key, name]) => venueFilterInput.append(new Option(name, key)));
  state.venue = current === "all" || venues.has(current) ? current : "all";
  venueFilterInput.value = state.venue;
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    setPressed(button, button.dataset.reviewFilter === state.filter);
  });
}

function setPressed(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function updateSummary() {
  const list = artists();
  document.querySelector("#artistTotal").textContent = list.length;
  document.querySelector("#reviewTotal").textContent = list.filter((artist) => artist.confidence === "review").length;
  document.querySelector("#verifiedTotal").textContent = list.filter((artist) => artist.confidence === "verified").length;
}

function inferLinkType(url = "") {
  const lower = url.toLowerCase();
  const host = hostForUrl(url);
  if (lower.includes("bandcamp.com")) return "bandcamp";
  if (lower.includes("linktr.ee")) return "linktree";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com")) return "facebook";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "twitter";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("musicbrainz.org")) return "musicbrainz";
  if (lower.includes("spotify.com")) return "spotify";
  if (lower.includes("music.youtube.com")) return "youtubeMusic";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("soundcloud.com")) return "soundcloud";
  if (lower.includes("discogs.com")) return "discogs";
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return "wikipedia";
  if (lower.includes("music.apple.com")) return "appleMusic";
  if (lower.includes("music.amazon.com")) return "amazonMusic";
  if (lower.includes("ticketmaster.com")) return "ticketmaster";
  if (lower.includes("qobuz.com")) return "qobuz";
  if (lower.includes("deezer.com")) return "deezer";
  if (lower.includes("tidal.com")) return "tidal";
  if (host === "wikidata.org" || host.endsWith(".wikidata.org")) return "wikidata";
  if (lower.includes("duckduckgo.com") || lower.includes("google.com/search")) return "search";
  return "official";
}

function hostForUrl(url = "") {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function labelForType(type = "official") {
  const labels = {
    bandcamp: "Bandcamp",
    official: "Official",
    linktree: "Linktree",
    instagram: "Instagram",
    facebook: "Facebook",
    twitter: "X/Twitter",
    tiktok: "TikTok",
    musicbrainz: "MusicBrainz",
    youtube: "YouTube",
    youtubeMusic: "YouTube Music",
    soundcloud: "SoundCloud",
    discogs: "Discogs",
    discogsArtist: "Discogs Artist",
    discogsAlias: "Discogs Alias",
    discogsLegalName: "Discogs Legal Name",
    wikipedia: "Wikipedia",
    appleMusic: "Apple Music",
    amazonMusic: "Amazon Music",
    ticketmaster: "Ticketmaster",
    qobuz: "Qobuz",
    deezer: "Deezer",
    tidal: "Tidal",
    wikidata: "Wikidata",
    spotify: "Spotify",
    search: "Search"
  };
  return labels[type] || "Link";
}

function selectArtist(id) {
  state.selectedId = id;
  const artist = artistStore.artists[id];
  if (!artist) return;

  fields.selectedName.textContent = artist.name;
  fields.selectedConfidence.textContent = artist.confidence || "review";
  fields.selectedConfidence.className = `confidence ${artist.confidence || "review"}`;
  enrichButton.disabled = artist.confidence !== "likely";
  enrichButton.title = artist.confidence === "likely" ? "Try Wikidata, MusicBrainz, and Discogs enrichment for this artist" : "Enrichment is intended for Likely artists";
  fields.confidence.value = artist.confidence || "review";
  fields.displayName.value = artist.displayName || "";
  fields.locality.value = artist.locality || "";
  fields.genres.value = (artist.genres || artist.tags || []).join(", ");
  fields.imageUrl.value = artist.imageUrl || "";
  fields.priority.value = supportPriorityForArtist(artist).join(", ");
  fields.summary.value = artist.summary || "";
  renderLinkEditor(artist.links || []);
  fields.note.value = artist.reviewNotes || artist.note || "";
  renderMergeArtistOptions(artist);

  fields.appearances.replaceChildren();
  const appearances = appearancesInRange(artist.source?.appearances || []);
  fields.appearanceHeading.textContent = state.fromDate || state.toDate ? "Shows in Range" : "Shows";
  if (!appearances.length) {
    const empty = document.createElement("p");
    empty.className = "appearance";
    empty.textContent = "No shows match the selected date range.";
    fields.appearances.append(empty);
  }
  appearances.forEach((show) => fields.appearances.append(createAppearanceRow(artist, show)));

  renderQueue();
}

function renderMergeArtistOptions(selectedArtist) {
  fields.mergeArtist.replaceChildren();
  fields.mergeArtist.append(new Option("Choose canonical artist...", ""));
  artists()
    .filter((artist) => artist.id !== selectedArtist.id)
    .forEach((artist) => {
      const displayName = artist.displayName || artist.name;
      const label = [displayName, normalizeName(artist.name) !== normalizeName(displayName) ? artist.name : "", artist.confidence || "review"]
        .filter(Boolean)
        .join(" - ");
      fields.mergeArtist.append(new Option(label, artist.id));
    });
}

function createAppearanceRow(artist, show) {
  const item = document.createElement("div");
  item.className = "appearance appearance-control";

  const event = eventForAppearance(show);
  const text = document.createElement("p");
  text.textContent = `${show.date} - ${show.venue} - ${show.details}`;
  item.append(text);

  if (!event) return item;

  const controls = document.createElement("div");
  controls.className = "filter-group compact-filter";

  const type = document.createElement("select");
  type.setAttribute("aria-label", "Show type");
  type.add(new Option("Artist show", "artist"));
  type.add(new Option("Event show", "event"));
  type.value = showTypeForEvent(event);

  const displayName = document.createElement("input");
  displayName.type = "text";
  displayName.placeholder = "Show display name";
  displayName.value = event.displayName || "";

  const save = document.createElement("button");
  save.className = "chip";
  save.type = "button";
  save.textContent = "Save Show";
  save.addEventListener("click", async () => {
    const nextType = type.value === "event" ? "event" : "artist";
    event.showType = nextType;
    event.displayName = displayName.value.trim();
    if (nextType === "event") {
      event.title ||= event.displayName || artist.displayName || artist.name;
      event.artists = [];
    } else if (!(event.artists || []).length) {
      event.artists = [artistPlaceholderFromReview(artist)];
    }
    await persistEvents();
  });

  controls.append(type, displayName, save);
  item.append(controls);
  return item;
}

function eventForAppearance(show) {
  if (show.eventId) return events.find((event) => event.id === show.eventId) || null;
  return events.find((event) => {
    return event.date === show.date
      && event.venue === show.venue
      && (event.details || "") === (show.details || "");
  }) || null;
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function artistPlaceholderFromReview(artist) {
  return {
    name: artist.name,
    displayName: artist.displayName || "",
    tags: artist.genres || artist.tags || ["unknown"],
    locality: artist.locality || "unknown",
    confidence: artist.confidence || "review",
    links: artist.links || []
  };
}

async function mergeSelectedArtist() {
  const source = artistStore.artists[state.selectedId];
  const targetId = fields.mergeArtist.value;
  const target = artistStore.artists[targetId];
  if (!source || !target || source.id === target.id) return;

  const confirmed = window.confirm(`Merge "${source.displayName || source.name}" into "${target.displayName || target.name}"? This will update show listings and remove the duplicate artist record.`);
  if (!confirmed) return;

  mergeArtistData(target, source);
  const renamed = renameArtistInEvents(source, target);
  delete artistStore.artists[source.id];

  await persistEvents();
  await persist();
  updateSummary();
  state.selectedId = target.id;
  selectArtist(target.id);
  fields.saveStatus.textContent = `Merged ${source.name} into ${target.name}${renamed ? ` across ${renamed} show listing${renamed === 1 ? "" : "s"}` : ""}`;
}

function mergeArtistData(target, source) {
  target.displayName ||= source.displayName || "";
  target.aliases = uniqueList([
    ...(target.aliases || []),
    ...(source.aliases || []),
    source.name,
    source.displayName
  ].filter((value) => value && normalizeName(value) !== normalizeName(target.name) && normalizeName(value) !== normalizeName(target.displayName || "")));
  target.genres = uniqueList([...(target.genres || target.tags || []), ...(source.genres || source.tags || [])]);
  target.imageUrl ||= source.imageUrl || "";
  target.locality = preferredText(target.locality, source.locality, "unknown");
  target.summary = preferredText(target.summary, source.summary);
  target.reviewNotes = uniqueParagraphs(target.reviewNotes, source.reviewNotes || source.note);
  target.links = mergeLinks(target.links || [], source.links || []);
  target.evidence = mergeEvidence(target.evidence || [], source.evidence || []);
  target.supportPriority = supportPriorityForLinks(target.links || []);
  target.confidence = higherConfidence(target.confidence, source.confidence);
  target.source = {
    ...(target.source || {}),
    firstSeenAt: earliestDate(target.source?.firstSeenAt, source.source?.firstSeenAt),
    lastImportedAt: latestDate(target.source?.lastImportedAt, source.source?.lastImportedAt),
    appearances: mergeAppearances(target.source?.appearances || [], source.source?.appearances || [])
  };
}

function renameArtistInEvents(source, target) {
  let renamed = 0;
  events.forEach((event) => {
    if (showTypeForEvent(event) !== "artist") return;
    const artists = event.artists || [];
    const sourceMatches = artists.filter((artist) => sameArtistName(artist.name, source));
    if (!sourceMatches.length) return;

    const targetArtist = artists.find((artist) => sameArtistName(artist.name, target)) || artistPlaceholderFromReview(target);
    sourceMatches.forEach((artist) => mergeEventArtistData(targetArtist, artist, source));
    event.artists = [
      targetArtist,
      ...artists.filter((artist) => !sameArtistName(artist.name, source) && !sameArtistName(artist.name, target))
    ];
    renamed += 1;
  });
  return renamed;
}

function mergeEventArtistData(targetArtist, sourceArtist, sourceRecord) {
  targetArtist.name = targetArtist.name || sourceRecord.name;
  targetArtist.displayName ||= sourceRecord.displayName || sourceArtist.displayName || "";
  targetArtist.tags = uniqueList([...(targetArtist.tags || []), ...(sourceArtist.tags || []), ...(sourceRecord.genres || [])]);
  targetArtist.locality = preferredText(targetArtist.locality, sourceArtist.locality || sourceRecord.locality, "unknown");
  targetArtist.confidence = higherConfidence(targetArtist.confidence, sourceArtist.confidence || sourceRecord.confidence);
  targetArtist.links = mergeLinks(targetArtist.links || [], sourceArtist.links || sourceRecord.links || []);
}

function sameArtistName(name, artist) {
  const normalized = normalizeName(name);
  return [artist.name, artist.displayName, ...(artist.aliases || [])].some((value) => normalizeName(value) === normalized);
}

function mergeLinks(existingLinks = [], incomingLinks = []) {
  const links = new Map();
  [...existingLinks, ...incomingLinks].filter((link) => link?.url).forEach((link) => {
    const key = link.url;
    const previous = links.get(key);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) links.set(key, { ...previous, ...link });
  });
  return [...links.values()];
}

function mergeEvidence(existing = [], incoming = []) {
  const evidence = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((item) => {
    evidence.set(`${item.url || ""}|${item.note || ""}`, item);
  });
  return [...evidence.values()];
}

function mergeAppearances(existing = [], incoming = []) {
  const appearances = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((show) => {
    appearances.set(show.eventId || `${show.date}|${show.venue}|${show.details}`, show);
  });
  return [...appearances.values()].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.venue || "").localeCompare(b.venue || ""));
}

function uniqueList(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item || "").trim();
    const key = normalizeName(value);
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueParagraphs(...items) {
  return uniqueList(items.flatMap((item) => String(item || "").split(/\n+/))).join("\n");
}

function preferredText(current = "", incoming = "", weakValue = "") {
  if (!current || normalizeName(current) === normalizeName(weakValue)) return incoming || current || "";
  return current;
}

function higherConfidence(current = "review", incoming = "review") {
  return confidenceRank(incoming) > confidenceRank(current) ? incoming : current;
}

function earliestDate(a = "", b = "") {
  if (!a) return b || "";
  if (!b) return a || "";
  return a < b ? a : b;
}

function latestDate(a = "", b = "") {
  if (!a) return b || "";
  if (!b) return a || "";
  return a > b ? a : b;
}

function normalizeName(value = "") {
  return String(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function renderQueue() {
  const list = visibleArtists();
  queue.replaceChildren();
  updateRecordNavigation(list);

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No artists match these filters.";
    queue.append(empty);
    return;
  }

  list.forEach((artist) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `queue-item ${artist.id === state.selectedId ? "active" : ""}`;
    button.dataset.artistId = artist.id;

    const name = document.createElement("strong");
    name.textContent = artist.name;
    const meta = document.createElement("span");
    const count = appearancesInRange(artist.source?.appearances || []).length;
    meta.textContent = `${artist.confidence || "review"} / ${count} in range`;

    button.append(name, meta);
    button.addEventListener("click", () => selectArtist(artist.id));
    queue.append(button);
  });
  keepSelectedQueueItemVisible();
}

function updateRecordNavigation(list = visibleArtists()) {
  const index = list.findIndex((artist) => artist.id === state.selectedId);
  const hasSelection = index >= 0;
  fields.artistPosition.textContent = hasSelection ? `${index + 1} of ${list.length}` : `0 of ${list.length}`;
  previousArtistButton.disabled = !hasSelection || index === 0;
  nextArtistButton.disabled = !hasSelection || index === list.length - 1;
}

function selectRelativeArtist(direction) {
  const list = visibleArtists();
  const index = list.findIndex((artist) => artist.id === state.selectedId);
  if (index < 0) return;
  const next = list[index + direction];
  if (next) selectArtist(next.id);
}

function keepSelectedQueueItemVisible() {
  const active = queue.querySelector(".queue-item.active");
  if (!active) return;
  const activeTop = active.offsetTop;
  const activeBottom = activeTop + active.offsetHeight;
  const visibleTop = queue.scrollTop;
  const visibleBottom = visibleTop + queue.clientHeight;
  if (activeTop < visibleTop) queue.scrollTop = activeTop;
  else if (activeBottom > visibleBottom) queue.scrollTop = activeBottom - queue.clientHeight;
}

async function persist() {
  artistStore.generatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(artistStore));
  fields.saveStatus.textContent = "Saved in browser";

  try {
    const response = await fetch("/api/artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(artistStore)
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const result = await response.json();
    fields.saveStatus.textContent = `Saved to data/artists.js at ${new Date(result.savedAt).toLocaleTimeString()}`;
    localStorage.removeItem(STORE_KEY);
  } catch {
    fields.saveStatus.textContent = "Saved in browser only";
  }
}

async function persistEvents() {
  localStorage.setItem(EVENTS_STORE_KEY, JSON.stringify(events));
  fields.saveStatus.textContent = "Saved show in browser";

  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events)
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const result = await response.json();
    localStorage.removeItem(EVENTS_STORE_KEY);
    fields.saveStatus.textContent = `Saved show data at ${new Date(result.savedAt).toLocaleTimeString()}`;
  } catch {
    fields.saveStatus.textContent = "Saved show in browser only";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  artist.confidence = fields.confidence.value;
  artist.displayName = fields.displayName.value.trim();
  artist.locality = fields.locality.value.trim() || "unknown";
  artist.genres = fields.genres.value.split(",").map((tag) => tag.trim()).filter(Boolean);
  artist.imageUrl = fields.imageUrl.value.trim();
  delete artist.tags;
  artist.supportPriority = supportPriorityForLinks(artist.links);
  artist.summary = fields.summary.value.trim();
  artist.links = readLinkEditor();
  artist.supportPriority = supportPriorityForLinks(artist.links);
  artist.reviewNotes = fields.note.value.trim();
  delete artist.note;

  await persist();
  updateSummary();
  selectArtist(artist.id);
});

function renderLinkEditor(links) {
  fields.links.replaceChildren();
  fields.rejectedLinks.replaceChildren();

  const activeLinks = links.filter((link) => link.confidence !== "rejected").sort(sortLinksByLabel);
  const rejectedLinks = links.filter((link) => link.confidence === "rejected").sort(sortLinksByLabel);

  activeLinks.forEach((link) => fields.links.append(createLinkRow(link)));
  rejectedLinks.forEach((link) => fields.rejectedLinks.append(createLinkRow(link)));

  fields.rejectedCount.textContent = rejectedLinks.length;
  fields.rejectedSection.hidden = rejectedLinks.length === 0;
}

function sortLinksByLabel(a, b) {
  return linkDisplayRank(a) - linkDisplayRank(b) || (a.label || labelForType(a.type)).localeCompare(b.label || labelForType(b.type));
}

function linkDisplayRank(link) {
  if (link.display === false) return 2;
  if (link.displayPriority === "primary") return 0;
  return 1;
}

function createLinkRow(link = {}) {
  const row = document.createElement("div");
  row.className = `link-row ${link.confidence === "rejected" ? "rejected" : ""}`;

  const type = document.createElement("select");
  type.className = "link-type";
  linkTypes.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = labelForType(item);
    type.append(option);
  });
  type.value = link.type || inferLinkType(link.url || "");

  const label = document.createElement("input");
  label.className = "link-label";
  label.type = "text";
  label.placeholder = "Label";
  label.value = link.label || labelForType(type.value);

  const url = document.createElement("input");
  url.className = "link-url";
  url.type = "url";
  url.placeholder = "https://";
  url.value = link.url || "";

  const confidence = document.createElement("select");
  confidence.className = "link-confidence";
  confidenceOptions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    confidence.append(option);
  });
  confidence.value = link.confidence || (type.value === "search" ? "research" : "candidate");

  const displayLabel = document.createElement("label");
  displayLabel.className = "link-display-control";
  const display = document.createElement("input");
  display.className = "link-display";
  display.type = "checkbox";
  display.checked = link.display !== false;
  displayLabel.append(display, document.createTextNode("Show"));

  const priority = document.createElement("select");
  priority.className = "link-priority";
  priority.add(new Option("Primary", "primary"));
  priority.add(new Option("Secondary", "secondary"));
  priority.value = link.displayPriority === "primary" ? "primary" : "secondary";

  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.type = "button";
  remove.title = "Remove link";
  remove.textContent = "x";

  type.addEventListener("change", () => {
    label.value = labelForType(type.value);
  });
  url.addEventListener("change", () => {
    if (!type.value || type.value === "other") type.value = inferLinkType(url.value);
    if (!label.value || label.value === "Link") label.value = labelForType(type.value);
  });
  confidence.addEventListener("change", () => {
    row.classList.toggle("rejected", confidence.value === "rejected");
    moveLinkRowToCorrectSection(row);
  });
  remove.addEventListener("click", () => row.remove());

  row.append(type, label, url, confidence, displayLabel, priority, remove);
  return row;
}

function readLinkEditor() {
  return [...document.querySelectorAll(".link-row")].map((row) => {
    const type = row.querySelector(".link-type").value;
    const label = row.querySelector(".link-label").value.trim() || labelForType(type);
    const url = row.querySelector(".link-url").value.trim();
    const confidence = row.querySelector(".link-confidence").value;
    const display = row.querySelector(".link-display").checked;
    const displayPriority = row.querySelector(".link-priority").value;
    return {
      type: type || inferLinkType(url),
      label,
      url,
      confidence,
      display,
      displayPriority,
      source: "manual"
    };
  }).filter((link) => link.url);
}

function supportPriorityForArtist(artist) {
  return supportPriorityForLinks(artist.links || []);
}

function supportPriorityForLinks(links) {
  const verifiedTypes = [...new Set(links
    .filter((link) => link.confidence === "verified")
    .map((link) => link.type)
    .filter(Boolean))];
  return verifiedTypes.sort((a, b) => {
    return priorityBucket(a) - priorityBucket(b) || labelForType(a).localeCompare(labelForType(b));
  });
}

function priorityBucket(type) {
  if (type === "official") return 0;
  if (type === "linktree") return 1;
  return 2;
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function moveLinkRowToCorrectSection(row) {
  const confidence = row.querySelector(".link-confidence").value;
  const target = confidence === "rejected" ? fields.rejectedLinks : fields.links;
  if (row.parentElement !== target) {
    target.append(row);
  }

  const rejectedCount = fields.rejectedLinks.querySelectorAll(".link-row").length;
  fields.rejectedCount.textContent = rejectedCount;
  fields.rejectedSection.hidden = rejectedCount === 0;
}

search.addEventListener("input", (event) => {
  state.query = event.target.value;
  syncArtistSelection();
});

fromDateInput.value = state.fromDate;
toDateInput.value = state.toDate;

fromDateInput.addEventListener("input", (event) => {
  state.fromDate = event.target.value;
  renderVenueFilterOptions();
  syncArtistSelection();
});

toDateInput.addEventListener("input", (event) => {
  state.toDate = event.target.value;
  renderVenueFilterOptions();
  syncArtistSelection();
});

venueFilterInput.addEventListener("change", (event) => {
  state.venue = event.target.value;
  syncArtistSelection();
});

artistSortInput.value = state.sort;
artistSortInput.addEventListener("change", (event) => {
  state.sort = event.target.value;
  syncArtistSelection();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.reviewFilter;
    syncFilterButtons();
    const first = visibleArtists()[0];
    if (first) selectArtist(first.id);
    else {
      state.selectedId = "";
      fields.selectedName.textContent = "Choose an artist";
      fields.selectedConfidence.textContent = "review";
      fields.selectedConfidence.className = "confidence review";
      form.reset();
      fields.links.replaceChildren();
      fields.appearances.replaceChildren();
      renderQueue();
    }
  });
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (state.selectedId) selectArtist(state.selectedId);
  fields.saveStatus.textContent = "Reverted to last saved version";
});

document.querySelector("#addLinkButton").addEventListener("click", () => {
  fields.links.append(createLinkRow({ confidence: "candidate", source: "manual" }));
});

previousArtistButton.addEventListener("click", () => selectRelativeArtist(-1));
nextArtistButton.addEventListener("click", () => selectRelativeArtist(1));

document.querySelector("#mergeArtistButton").addEventListener("click", mergeSelectedArtist);

enrichButton.addEventListener("click", async () => {
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  fields.saveStatus.textContent = "Saving before enrichment...";
  await saveCurrentArtist();

  enrichButton.disabled = true;
  const enrichmentName = artist.displayName || artist.name;
  fields.saveStatus.textContent = `Enriching ${enrichmentName}...`;

  try {
    const response = await fetch("/api/enrich-artist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: artist.id, name: enrichmentName })
    });
    if (!response.ok) throw new Error(`Enrichment failed: ${response.status}`);
    const result = await response.json();
    artistStore.artists[result.artist.id] = result.artist;
    artistStore.generatedAt = result.generatedAt;
    localStorage.removeItem(STORE_KEY);
    fields.saveStatus.textContent = `Enriched ${result.artist.name}`;
    updateSummary();
    selectArtist(result.artist.id);
  } catch {
    fields.saveStatus.textContent = "Enrichment needs the local dev server";
    enrichButton.disabled = false;
  }
});

document.querySelector("#clearLocalButton").addEventListener("click", () => {
  const confirmed = window.confirm("Clear browser-saved review edits and reload from data/artists.js?");
  if (!confirmed) return;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(EVENTS_STORE_KEY);
  window.location.reload();
});

document.querySelector("#exportButton").addEventListener("click", () => {
  const payload = `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(artistStore, null, 2)};\n`;
  const blob = new Blob([payload], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "artists.js";
  anchor.click();
  URL.revokeObjectURL(url);
});

updateSummary();
state.filter = preferredFilter();
renderVenueFilterOptions();
syncFilterButtons();
const first = visibleArtists()[0] || artists()[0];
if (first) selectArtist(first.id);
renderQueue();

function syncArtistSelection() {
  const list = visibleArtists();
  if (list.some((artist) => artist.id === state.selectedId)) {
    selectArtist(state.selectedId);
    return;
  }

  const first = list[0];
  if (first) {
    selectArtist(first.id);
    return;
  }

  state.selectedId = "";
  fields.selectedName.textContent = "Choose an artist";
  fields.selectedConfidence.textContent = "review";
  fields.selectedConfidence.className = "confidence review";
  form.reset();
  fields.links.replaceChildren();
  fields.rejectedLinks.replaceChildren();
  fields.appearances.replaceChildren();
  renderQueue();
}

async function saveCurrentArtist() {
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  artist.confidence = fields.confidence.value;
  artist.displayName = fields.displayName.value.trim();
  artist.locality = fields.locality.value.trim() || "unknown";
  artist.genres = fields.genres.value.split(",").map((tag) => tag.trim()).filter(Boolean);
  artist.imageUrl = fields.imageUrl.value.trim();
  delete artist.tags;
  artist.summary = fields.summary.value.trim();
  artist.links = readLinkEditor();
  artist.supportPriority = supportPriorityForLinks(artist.links);
  artist.reviewNotes = fields.note.value.trim();
  delete artist.note;

  await persist();
}
