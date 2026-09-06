const STORE_KEY = "bay-area-show-explorer-events";
const RECENT_STORE_KEY = "bay-area-show-explorer-recent-events";
const baseEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const venueStore = window.SHOW_EXPLORER_VENUES || { venues: {} };
const savedEvents = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const events = newerEvents(savedEvents, baseEvents);
const recentEventIds = new Set(JSON.parse(localStorage.getItem(RECENT_STORE_KEY) || "[]"));
let duplicateGroups = [];
let duplicateEventIds = new Set();

const state = {
  query: "",
  filter: "needsMetadata",
  source: "all",
  sort: "default",
  fromDate: todayString(),
  toDate: dateStringFromOffset(6),
  selectedId: ""
};

const queue = document.querySelector("#eventQueue");
const form = document.querySelector("#eventForm");
const search = document.querySelector("#eventSearch");
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const sortInput = document.querySelector("#eventSortInput");
const filterButtons = [...document.querySelectorAll("[data-review-filter]")];
const sourceFilterButtons = [...document.querySelectorAll("[data-source-filter]")];
const deleteOrphanVenueShowsButton = document.querySelector("#deleteOrphanVenueShowsButton");

const fields = {
  selectedName: document.querySelector("#selectedName"),
  selectedStatus: document.querySelector("#selectedStatus"),
  date: document.querySelector("#dateInput"),
  venue: document.querySelector("#venueInput"),
  venueStatusHint: document.querySelector("#venueStatusHint"),
  showType: document.querySelector("#showTypeInput"),
  title: document.querySelector("#titleInput"),
  displayName: document.querySelector("#displayNameInput"),
  details: document.querySelector("#detailsInput"),
  eventDescription: document.querySelector("#eventDescriptionInput"),
  mikesPick: document.querySelector("#mikesPickInput"),
  eventTypes: document.querySelector("#eventTypesInput"),
  eventTypeOptions: document.querySelector("#eventTypeOptions"),
  themes: document.querySelector("#themesInput"),
  artists: document.querySelector("#artistsInput"),
  source: document.querySelector("#sourceInput"),
  infoUrl: document.querySelector("#infoUrlInput"),
  imageUrl: document.querySelector("#imageUrlInput"),
  imageSource: document.querySelector("#imageSourceInput"),
  mergeEvent: document.querySelector("#mergeEventInput"),
  duplicateCount: document.querySelector("#duplicateCount"),
  duplicateSuggestions: document.querySelector("#duplicateSuggestions"),
  duplicatePanel: document.querySelector(".duplicate-panel"),
  saveStatus: document.querySelector("#saveStatus")
};

const knownEventTypes = [
  "book",
  "chess",
  "comedy",
  "coverBand",
  "dance",
  "film",
  "game",
  "jam",
  "karaoke",
  "openMic",
  "poetry",
  "storytelling",
  "themeNight",
  "trivia"
];

function newerEvents(saved, base) {
  const source = Array.isArray(saved) ? saved : base;
  return JSON.parse(JSON.stringify(source)).map(normalizeEventRecord);
}

function normalizeEventRecord(event) {
  event.title = cleanJoinedText(event.title || "");
  event.displayName = cleanJoinedText(event.displayName || "");
  event.details = cleanJoinedText(event.details || "");
  event.eventDescription = cleanJoinedText(event.eventDescription || "");
  event.eventTypes = uniqueList(event.eventTypes || []);
  event.themes = uniqueList(event.themes || []);
  event.artists = mergeArtists(event.artists || []);
  return event;
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

function eventTitle(event) {
  return cleanJoinedText(event.displayName)
    || cleanJoinedText(event.title)
    || cleanJoinedText((event.artists || []).map(artistDisplayName).join(", "))
    || cleanJoinedText(event.details)
    || "Untitled event";
}

function artistDisplayName(artist) {
  return cleanJoinedText(artist.displayName || artist.name || "");
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return hasArtists(event) ? "artist" : "event";
}

function isArtistShow(event) {
  return showTypeForEvent(event) === "artist";
}

function isEventShow(event) {
  return showTypeForEvent(event) === "event";
}

function eventText(event) {
  return [
    event.date,
    eventTitle(event),
    showTypeForEvent(event),
    event.venue,
    event.city,
    event.region,
    event.displayName,
    event.details,
    event.eventDescription,
    event.mikesPick ? "Mike's Pick featured" : "",
    ...sourceNamesForEvent(event),
    event.source?.name,
    event.source?.url,
    event.sourceUrl,
    event.infoUrl,
    event.imageUrl,
    event.imageSource,
    ...(event.eventTypes || []),
    ...(event.themes || []),
    ...(event.artists || []).flatMap((artist) => [artist.name, artist.displayName])
  ].join(" ").toLowerCase();
}

function visibleEvents() {
  const query = state.query.trim().toLowerCase();
  refreshDuplicateIndex();
  return events
    .filter((event) => matchesDateRange(event) && matchesFilter(event) && matchesSource(event) && (!query || eventText(event).includes(query)))
    .sort(compareVisibleEvents);
}

function compareVisibleEvents(a, b) {
  if (state.sort === "title") {
    return eventTitle(a).localeCompare(eventTitle(b))
      || a.date.localeCompare(b.date)
      || a.venue.localeCompare(b.venue);
  }
  return a.date.localeCompare(b.date)
    || a.venue.localeCompare(b.venue)
    || eventTitle(a).localeCompare(eventTitle(b));
}

function matchesDateRange(event) {
  if (state.fromDate && event.date < state.fromDate) return false;
  if (state.toDate && event.date > state.toDate) return false;
  return true;
}

function matchesFilter(event) {
  if (state.filter === "all") return true;
  if (state.filter === "duplicates") return duplicateEventIds.has(event.id);
  if (state.filter === "recent") return recentEventIds.has(event.id);
  if (state.filter === "nonArtist") return isEventShow(event);
  if (state.filter === "artistBacked") return isArtistShow(event);
  if (state.filter === "mikesPick") return Boolean(event.mikesPick);
  if (state.filter === "needsMetadata") return needsMetadata(event);
  return true;
}

function matchesSource(event) {
  if (state.source === "all") return true;
  return sourceNamesForEvent(event).some((name) => slugify(name) === state.source);
}

function hasArtists(event) {
  return (event.artists || []).length > 0;
}

function needsMetadata(event) {
  return (isArtistShow(event) && !hasArtists(event))
    || (isEventShow(event) && !(event.eventTypes || []).length && !(event.themes || []).length);
}

function eventStatus(event) {
  if (isOrphanVenueShow(event)) return "missing venue";
  if (needsMetadata(event)) return "needs metadata";
  return isArtistShow(event) ? "artist show" : "event show";
}

function updateTotals() {
  refreshDuplicateIndex();
  const inRange = events.filter((event) => matchesDateRange(event) && matchesSource(event));
  document.querySelector("#eventTotal").textContent = inRange.length;
  document.querySelector("#metadataTotal").textContent = inRange.filter(needsMetadata).length;
  document.querySelector("#nonArtistTotal").textContent = inRange.filter(isEventShow).length;
  document.querySelector("#duplicateTotal").textContent = inRange.filter((event) => duplicateEventIds.has(event.id)).length;
  document.querySelector("#sourceSummary").textContent = sourceSummaryText(inRange);
}

function sourceSummaryText(list) {
  const counts = { "The List": 0, KALX: 0, Other: 0 };
  list.forEach((event) => {
    const names = sourceNamesForEvent(event);
    if (names.includes("The List")) counts["The List"] += 1;
    if (names.includes("KALX")) counts.KALX += 1;
    if (!names.includes("The List") && !names.includes("KALX")) counts.Other += 1;
  });
  return `${counts["The List"]} / ${counts.KALX} / ${counts.Other}`;
}

function renderEventTypeOptions() {
  fields.eventTypeOptions.replaceChildren();
  knownEventTypes.forEach((type) => fields.eventTypeOptions.append(new Option(type, type)));
}

function renderQueue() {
  const list = visibleEvents();
  queue.replaceChildren();

  if (!list.some((event) => event.id === state.selectedId)) {
    state.selectedId = list[0]?.id || "";
  }

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No shows match these filters.";
    queue.append(empty);
    renderForm();
    return;
  }

  list.forEach((event) => {
    const button = document.createElement("button");
    button.className = `queue-item${event.id === state.selectedId ? " active" : ""}`;
    button.type = "button";

    const name = document.createElement("strong");
    name.textContent = eventTitle(event);
    const meta = document.createElement("span");
    meta.textContent = [event.date, event.venue, eventStatus(event), (event.eventTypes || []).join(", ")].filter(Boolean).join(" | ");

    button.append(name, meta);
    button.addEventListener("click", () => {
      state.selectedId = event.id;
      render();
    });
    queue.append(button);
  });

  renderForm();
}

function selectedEvent() {
  return events.find((event) => event.id === state.selectedId) || null;
}

function renderForm() {
  const event = selectedEvent();
  form.hidden = !event;
  if (!event) {
    if (fields.venueStatusHint) fields.venueStatusHint.textContent = "";
    return;
  }

  const status = eventStatus(event);
  fields.selectedName.textContent = eventTitle(event);
  fields.selectedStatus.textContent = status;
  fields.selectedStatus.className = `confidence ${needsMetadata(event) ? "review" : isArtistShow(event) ? "likely" : "verified"}`;
  fields.date.value = event.date || "";
  fields.venue.value = event.venue || "";
  renderVenueStatusHint(event);
  fields.showType.value = showTypeForEvent(event);
  fields.title.value = cleanJoinedText(event.title || "");
  fields.displayName.value = cleanJoinedText(event.displayName || "");
  fields.details.value = cleanJoinedText(event.details || "");
  fields.eventDescription.value = cleanJoinedText(event.eventDescription || "");
  setMikesPickButton(Boolean(event.mikesPick));
  fields.eventTypes.value = (event.eventTypes || []).join(", ");
  fields.themes.value = (event.themes || []).join(", ");
  fields.artists.value = uniqueList((event.artists || []).map((artist) => cleanJoinedText(artist.name))).join("\n");
  syncShowTypeFields();
  fields.source.value = event.source?.url || event.sourceUrl || "";
  fields.infoUrl.value = event.infoUrl || "";
  fields.imageUrl.value = event.imageUrl || "";
  fields.imageSource.value = displayImageSourceValue(event.imageSource || "");
  renderMergeEventOptions(event);
  renderDuplicateSuggestions(event);
}

function renderMergeEventOptions(selectedEvent) {
  fields.mergeEvent.replaceChildren();
  const selectedType = fields.showType.value || showTypeForEvent(selectedEvent);
  fields.mergeEvent.append(new Option(`Choose canonical ${showTypeLabel(selectedType).toLowerCase()}...`, ""));
  mergeTargetsFor(selectedEvent)
    .sort((a, b) => compareMergeTargets(a, b, selectedEvent))
    .forEach((event) => {
      const label = [event.date, eventTitle(event), event.venue, sourceNamesForEvent(event).join(", ")].filter(Boolean).join(" - ");
      fields.mergeEvent.append(new Option(label, event.id));
    });
}

function mergeTargetsFor(selectedEvent) {
  const selectedType = fields.showType.value || showTypeForEvent(selectedEvent);
  return events.filter((event) => {
    return event.id !== selectedEvent.id
      && showTypeForEvent(event) === selectedType
      && matchesDateRange(event)
      && matchesSource(event);
  });
}

function refreshDuplicateIndex() {
  duplicateGroups = duplicateSuggestionGroups();
  duplicateEventIds = new Set(duplicateGroups.flatMap((group) => group.events.map((event) => event.id)));
}

function duplicateSuggestionGroups() {
  const buckets = new Map();
  events
    .filter((event) => matchesDateRange(event) && matchesSource(event))
    .forEach((event) => {
      const key = duplicateBucketKey(event);
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(event);
    });

  return [...buckets.values()]
    .map((bucket) => likelyDuplicateGroup(bucket))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.events[0].date.localeCompare(b.events[0].date));
}

function duplicateBucketKey(event) {
  const date = event.date || "";
  const venue = normalizeText(event.venue || "");
  const type = showTypeForEvent(event);
  if (!date || !venue) return "";
  return `${date}|${venue}|${type}`;
}

function likelyDuplicateGroup(bucket) {
  if (bucket.length < 2) return null;
  const eventsWithTokens = bucket.map((event) => ({ event, tokens: eventTokens(event) }));
  const related = [];
  let bestScore = 0;

  for (let index = 0; index < eventsWithTokens.length; index += 1) {
    const current = eventsWithTokens[index];
    const matches = eventsWithTokens.filter((candidate, candidateIndex) => {
      if (candidateIndex === index) return false;
      const score = tokenOverlapScore(current.tokens, candidate.tokens);
      bestScore = Math.max(bestScore, score);
      return score >= 0.6;
    });
    if (matches.length) related.push(current.event, ...matches.map((match) => match.event));
  }

  const uniqueEvents = uniqueEventsById(related);
  if (uniqueEvents.length < 2) return null;
  return {
    score: bestScore,
    events: uniqueEvents.sort(compareCanonicalPreference)
  };
}

function eventTokens(event) {
  return new Set(normalizeText([
    eventTitle(event),
    event.details,
    ...(event.artists || []).map(artistDisplayName),
    ...(event.eventTypes || []),
    ...(event.themes || [])
  ].join(" ")).split(/\s+/).filter((token) => token.length > 2));
}

function tokenOverlapScore(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let overlap = 0;
  small.forEach((token) => {
    if (large.has(token)) overlap += 1;
  });
  return overlap / small.size;
}

function uniqueEventsById(items = []) {
  const seen = new Set();
  return items.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function compareCanonicalPreference(a, b) {
  return canonicalScore(b) - canonicalScore(a)
    || sourceNamesForEvent(a).join(", ").localeCompare(sourceNamesForEvent(b).join(", "))
    || eventTitle(a).localeCompare(eventTitle(b));
}

function canonicalScore(event) {
  return Number(Boolean(event.displayName)) * 8
    + Number((event.sources || []).length > 1) * 6
    + Number((event.artists || []).length) * 4
    + Number((event.eventTypes || []).length) * 2
    + Number((event.themes || []).length)
    + sourceNamesForEvent(event).length;
}

function duplicateGroupsForEvent(event) {
  return duplicateGroups.filter((group) => group.events.some((item) => item.id === event.id));
}

function renderDuplicateSuggestions(event) {
  const groups = duplicateGroupsForEvent(event);
  fields.duplicateSuggestions.replaceChildren();
  fields.duplicateCount.textContent = String(groups.reduce((total, group) => total + group.events.length - 1, 0));
  fields.duplicatePanel.classList.toggle("is-empty", !groups.length);

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state compact-empty";
    empty.textContent = "No likely duplicate in the current date/source range.";
    fields.duplicateSuggestions.append(empty);
    return;
  }

  groups.forEach((group) => {
    const wrapper = document.createElement("div");
    wrapper.className = "duplicate-group";
    group.events.forEach((candidate) => wrapper.append(duplicateCard(candidate, event)));
    fields.duplicateSuggestions.append(wrapper);
  });
}

function duplicateCard(candidate, selectedEvent) {
  const card = document.createElement("article");
  card.className = `duplicate-card${candidate.id === selectedEvent.id ? " active" : ""}`;
  const heading = document.createElement("h4");
  heading.textContent = eventTitle(candidate);
  const meta = document.createElement("p");
  const venueStatus = venueStatusText(candidate);
  meta.textContent = [
    candidate.date,
    candidate.venue,
    venueStatus,
    showTypeLabel(showTypeForEvent(candidate)),
    sourceNamesForEvent(candidate).join(", ")
  ].filter(Boolean).join(" | ");
  const details = document.createElement("p");
  details.textContent = cleanJoinedText(candidate.details || "");
  const artists = document.createElement("p");
  artists.textContent = (candidate.artists || []).map(artistDisplayName).join(", ");

  const actions = document.createElement("div");
  actions.className = "admin-source-links";
  if (candidate.id !== selectedEvent.id) {
    const select = document.createElement("button");
    select.type = "button";
    select.className = "chip";
    select.textContent = "Review";
    select.addEventListener("click", () => {
      state.selectedId = candidate.id;
      render();
    });

    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "chip danger-chip";
    merge.textContent = "Merge into this";
    merge.addEventListener("click", async () => {
      fields.mergeEvent.value = candidate.id;
      await mergeSelectedEvent();
    });
    actions.append(select, merge);
  }

  card.append(heading, meta);
  if (details.textContent) card.append(details);
  if (artists.textContent) card.append(artists);
  card.append(actions);
  return card;
}

function renderVenueStatusHint(event) {
  const match = resolvedVenueForEvent(event);
  if (!fields.venueStatusHint) return;
  fields.venueStatusHint.textContent = venueStatusText(event, match);
  fields.venueStatusHint.className = `field-hint venue-status-hint ${match?.confidence || "review"}`;
}

function venueStatusText(event, match = resolvedVenueForEvent(event)) {
  if (!match) return "Venue not found in review store";
  const name = displayNameForVenue(match);
  const confidence = confidenceLabel(match.confidence);
  const status = match.status && match.status !== "unknown" ? match.status : "";
  const type = match.venueType && match.venueType !== "unknown" ? match.venueType : "";
  const canonical = name && normalizeText(name) !== normalizeText(event.venue || "") ? ` -> ${name}` : "";
  return [`Venue ${confidence}${canonical}`, status, type].filter(Boolean).join(" / ");
}

function resolvedVenueForEvent(event) {
  return bestVenueMatch([
    venueByName(event.venue || ""),
    venueById(slugify(event.venue || "")),
    venueById(event.venueId)
  ]);
}

function isOrphanVenueShow(event) {
  return !resolvedVenueForEvent(event);
}

function venueById(id = "") {
  return id ? venueStore.venues?.[id] || null : null;
}

function venueByName(name = "") {
  const key = normalizeText(name);
  if (!key) return null;
  return Object.values(venueStore.venues || {}).find((venue) => {
    return [
      venue.name,
      venue.displayName,
      ...(venue.aliases || [])
    ].some((value) => normalizeText(value) === key);
  }) || null;
}

function resolveMergedVenue(venue) {
  if (!venue) return null;
  return venue.mergedInto && venueStore.venues?.[venue.mergedInto]
    ? venueStore.venues[venue.mergedInto]
    : venue;
}

function bestVenueMatch(matches = []) {
  return matches
    .map(resolveMergedVenue)
    .filter(Boolean)
    .sort((a, b) => venueMatchRank(b) - venueMatchRank(a))[0] || null;
}

function venueMatchRank(venue) {
  return confidenceRank(venue.confidence) * 10
    + Number(venue.status === "active") * 3
    + Number(Boolean(venue.displayName)) * 2
    + Number(Boolean(venue.address || venue.geo)) * 2;
}

function displayNameForVenue(venue) {
  return venue?.displayName || venue?.name || "";
}

function confidenceLabel(value = "review") {
  return {
    review: "needs review",
    likely: "likely",
    verified: "verified",
    rejected: "rejected"
  }[value] || value || "needs review";
}

function compareMergeTargets(a, b, selectedEvent) {
  return Number(!sameDateAndVenue(a, selectedEvent)) - Number(!sameDateAndVenue(b, selectedEvent))
    || a.date.localeCompare(b.date)
    || a.venue.localeCompare(b.venue)
    || eventTitle(a).localeCompare(eventTitle(b));
}

function sameDateAndVenue(a, b) {
  return (a.date || "") === (b.date || "") && normalizeText(a.venue || "") === normalizeText(b.venue || "");
}

function showTypeLabel(type) {
  return type === "artist" ? "Artist show" : "Event show";
}

function syncShowTypeFields() {
  const eventShow = fields.showType.value === "event";
  fields.artists.disabled = eventShow;
  fields.artists.placeholder = eventShow ? "Event shows do not create artist records." : "One artist per line.";
}

function setMikesPickButton(isPicked) {
  fields.mikesPick.classList.toggle("active", isPicked);
  fields.mikesPick.setAttribute("aria-pressed", isPicked ? "true" : "false");
}

function updateSelectedEventFromForm() {
  const event = selectedEvent();
  if (!event) return null;

  event.date = fields.date.value;
  event.venue = fields.venue.value.trim();
  event.venueId = resolvedVenueForEvent({ ...event, venue: event.venue })?.id || slugify(event.venue);
  event.showType = fields.showType.value === "event" ? "event" : "artist";
  event.title = cleanJoinedText(fields.title.value);
  event.displayName = cleanJoinedText(fields.displayName.value);
  event.details = cleanJoinedText(fields.details.value);
  event.eventDescription = cleanJoinedText(fields.eventDescription.value);
  event.mikesPick = fields.mikesPick.getAttribute("aria-pressed") === "true";
  event.eventTypes = splitList(fields.eventTypes.value);
  event.themes = splitTaxonomyList(fields.themes.value);
  event.artists = event.showType === "event"
    ? []
    : fields.artists.value
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .filter(uniqueByNormalizedText)
      .map((name) => existingArtistOrPlaceholder(event, name));

  const sourceUrl = fields.source.value.trim();
  event.sourceUrl = sourceUrl;
  if (sourceUrl) {
    event.source = {
      name: sourceNameForUrl(sourceUrl, event.source?.name),
      url: sourceUrl
    };
    event.sources = mergeSources(event.sources || [], [event.source]);
  }

  event.infoUrl = fields.infoUrl.value.trim();
  event.imageUrl = fields.imageUrl.value.trim();
  event.imageSource = cleanImageSource(fields.imageSource.value);

  if (!event.id) event.id = slugify(`${event.date}-${event.venue}-${eventTitle(event)}`);
  return event;
}

function existingArtistOrPlaceholder(event, name) {
  const existing = (event.artists || []).find((artist) => artist.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  return {
    name,
    tags: ["unknown"],
    locality: "unknown",
    confidence: "review",
    note: "",
    links: [{
      label: "Search",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" band music`)}`,
      type: "search",
      confidence: "research",
      source: "manual"
    }]
  };
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTaxonomyList(value = "") {
  return value
    .split(",")
    .map((item) => normalizeTaxonomyItem(item))
    .filter(Boolean);
}

function normalizeTaxonomyItem(value = "") {
  const item = String(value || "").trim();
  if (!item) return "";
  return /[A-Z]/.test(item) ? item : item.toLowerCase();
}

function mergeSources(existing, incoming) {
  const sources = new Map();
  for (const source of [...existing, ...incoming].filter(Boolean)) {
    if (!source.url) continue;
    const normalized = {
      ...source,
      name: sourceNameForUrl(source.url, source.name)
    };
    sources.set(`${normalized.name}|${normalized.url}`, normalized);
  }
  return [...sources.values()];
}

function sourceNameForUrl(url, fallback = "Source") {
  const normalized = String(url || "").toLowerCase();
  if (normalized.includes("kalx.berkeley.edu")) return "KALX";
  if (normalized.includes("jon.luini.com") || normalized.includes("thelist")) return "The List";
  return fallback && fallback !== "Source" ? fallback : "Source";
}

function cleanImageSource(value = "") {
  return String(value || "").replace(/^source\s*:\s*/i, "").trim().replace(/\/+$/g, "");
}

function displayImageSourceValue(value = "") {
  return cleanImageSource(value);
}

function sourceNamesForEvent(event) {
  const sources = [...(event.sources || []), event.source].filter(Boolean);
  return [...new Set(sources.map((source) => sourceNameForUrl(source.url, source.name)).filter(Boolean))];
}

async function mergeSelectedEvent() {
  updateSelectedEventFromForm();
  const source = selectedEvent();
  const targetId = fields.mergeEvent.value;
  const target = events.find((event) => event.id === targetId);
  if (!source || !target || source.id === target.id) return;
  if (showTypeForEvent(source) !== showTypeForEvent(target)) {
    fields.saveStatus.textContent = "Choose a canonical show with the same show type.";
    return;
  }

  const confirmed = window.confirm(`Merge "${eventTitle(source)}" into "${eventTitle(target)}"? This removes the duplicate show listing but keeps its source, artist, type, and theme data.`);
  if (!confirmed) return;

  mergeEventData(target, source);
  markRecentlyChanged(target.id, source.id);
  const sourceIndex = events.findIndex((event) => event.id === source.id);
  if (sourceIndex >= 0) events.splice(sourceIndex, 1);
  state.selectedId = target.id;
  await saveEvents({ skipFormUpdate: true });
  fields.saveStatus.textContent = `Merged duplicate show into ${eventTitle(target)}`;
}

async function deleteSelectedEvent() {
  const event = selectedEvent();
  if (!event) return;
  const index = events.findIndex((item) => item.id === event.id);
  if (index < 0) return;

  const confirmed = window.confirm(`Delete "${eventTitle(event)}" at "${event.venue || "unknown venue"}" on ${event.date || "unknown date"}? This removes the show record.`);
  if (!confirmed) return;

  const visibleBeforeDelete = visibleEvents();
  const visibleIndex = visibleBeforeDelete.findIndex((item) => item.id === event.id);
  events.splice(index, 1);
  const visibleAfterDelete = visibleEvents();
  const nextVisibleIndex = visibleIndex >= 0 ? Math.min(visibleIndex, visibleAfterDelete.length - 1) : 0;
  const next = visibleAfterDelete[nextVisibleIndex] || events[Math.min(index, Math.max(events.length - 1, 0))] || events[0] || null;
  state.selectedId = next?.id || "";
  await saveEvents({ skipFormUpdate: true });
  fields.saveStatus.textContent = "Deleted show record";
}

async function deleteOrphanVenueShows() {
  const orphanEvents = events.filter(isOrphanVenueShow);
  if (!orphanEvents.length) {
    fields.saveStatus.textContent = "No shows are missing venue records";
    return;
  }

  const confirmed = window.confirm(`Delete ${orphanEvents.length} show record${orphanEvents.length === 1 ? "" : "s"} without a matching venue? This checks all shows, not just the current filter.`);
  if (!confirmed) return;

  const orphanIds = new Set(orphanEvents.map((event) => event.id));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (orphanIds.has(events[index].id)) events.splice(index, 1);
  }

  if (orphanIds.has(state.selectedId)) {
    state.selectedId = visibleEvents()[0]?.id || events[0]?.id || "";
  }
  await saveEvents({ skipFormUpdate: true });
  fields.saveStatus.textContent = `Deleted ${orphanEvents.length} show record${orphanEvents.length === 1 ? "" : "s"} without venues`;
}

function markRecentlyChanged(...ids) {
  ids.filter(Boolean).forEach((id) => recentEventIds.add(id));
  const trimmed = [...recentEventIds].slice(-250);
  recentEventIds.clear();
  trimmed.forEach((id) => recentEventIds.add(id));
  localStorage.setItem(RECENT_STORE_KEY, JSON.stringify(trimmed));
}

function mergeEventData(target, source) {
  target.showType = showTypeForEvent(target);
  target.displayName = preferredShowText(target.displayName, source.displayName);
  target.title = preferredShowText(target.title, source.title);
  target.details = uniqueDetails(target.details, source.details);
  target.eventDescription = uniqueDetails(target.eventDescription, source.eventDescription);
  target.mikesPick = Boolean(target.mikesPick || source.mikesPick);
  target.eventTypes = uniqueList([...(target.eventTypes || []), ...(source.eventTypes || [])]);
  target.themes = uniqueList([...(target.themes || []), ...(source.themes || [])]);
  target.artists = mergeArtists(target.artists || [], source.artists || []);
  target.sources = mergeSources(target.sources || [], [
    ...(source.sources || []),
    source.source,
    target.source
  ].filter(Boolean));
  target.source ||= target.sources[0] || source.source;
  if (!target.sourceUrl && source.sourceUrl) target.sourceUrl = source.sourceUrl;
  target.infoUrl ||= source.infoUrl || "";
  target.imageUrl ||= source.imageUrl || "";
  target.imageSource ||= source.imageSource || "";
  target.city ||= source.city || "";
  target.region ||= source.region || "";
  target.time ||= source.time || "";
  target.price ||= source.price || "";
}

function mergeArtists(existing = [], incoming = []) {
  const artists = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((artist) => {
    const key = normalizeText(artist.displayName || artist.name);
    if (!key) return;
    const previous = artists.get(key);
    artists.set(key, previous ? mergeArtistData(previous, artist) : artist);
  });
  return [...artists.values()];
}

function mergeArtistData(target, source) {
  return {
    ...target,
    name: preferredShowText(target.name, source.name),
    displayName: preferredShowText(target.displayName, source.displayName),
    tags: uniqueList([...(target.tags || []), ...(source.tags || [])]),
    locality: preferredText(target.locality, source.locality),
    confidence: higherConfidence(target.confidence, source.confidence),
    note: uniqueDetails(target.note, source.note),
    links: mergeArtistLinks(target.links || [], source.links || [])
  };
}

function mergeArtistLinks(existing = [], incoming = []) {
  const links = new Map();
  [...existing, ...incoming].filter((link) => link?.url).forEach((link) => {
    const previous = links.get(link.url);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) links.set(link.url, { ...previous, ...link });
  });
  return [...links.values()];
}

function higherConfidence(current = "review", incoming = "review") {
  return confidenceRank(incoming) > confidenceRank(current) ? incoming : current;
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function uniqueDetails(current = "", incoming = "") {
  const currentClean = cleanJoinedText(current);
  const incomingClean = cleanJoinedText(incoming);
  if (!currentClean) return incomingClean || "";
  if (!incomingClean || normalizeText(currentClean).includes(normalizeText(incomingClean))) return currentClean;
  if (normalizeText(incomingClean).includes(normalizeText(currentClean))) return incomingClean;
  return cleanJoinedText(`${currentClean} / ${incomingClean}`);
}

function preferredText(current = "", incoming = "") {
  return current || incoming || "";
}

function preferredShowText(current = "", incoming = "") {
  const currentClean = cleanJoinedText(current);
  const incomingClean = cleanJoinedText(incoming);
  if (!currentClean) return incomingClean;
  if (!incomingClean) return currentClean;
  if (normalizeText(currentClean).includes(normalizeText(incomingClean))) return currentClean;
  if (normalizeText(incomingClean).includes(normalizeText(currentClean))) return incomingClean;
  return currentClean;
}

function uniqueList(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const value = cleanJoinedText(item);
    const key = normalizeText(value);
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value = "") {
  return decodeHtml(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanJoinedText(value = "") {
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return text;
  return uniqueList(parts).join(" / ");
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;|&#038;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function uniqueByNormalizedText(value, index, list) {
  const key = normalizeText(value);
  return key && list.findIndex((item) => normalizeText(item) === key) === index;
}

function persistDraft() {
  localStorage.setItem(STORE_KEY, JSON.stringify(events));
}

async function saveEvents(options = {}) {
  if (!options.skipFormUpdate) {
    const event = updateSelectedEventFromForm();
    if (event?.id) markRecentlyChanged(event.id);
  }
  persistDraft();
  fields.saveStatus.textContent = "Saved in browser";

  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events)
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const result = await response.json();
    fields.saveStatus.textContent = `Saved ${result.count} shows at ${new Date(result.savedAt).toLocaleTimeString()}`;
    localStorage.removeItem(STORE_KEY);
  } catch {
    fields.saveStatus.textContent = "Saved in browser only";
  }

  render();
}

function exportEvents() {
  const payload = `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(events, null, 2)};\n`;
  const blob = new Blob([payload], { type: "text/javascript" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "imported-events.js";
  link.click();
  URL.revokeObjectURL(link.href);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    setPressed(button, button.dataset.reviewFilter === state.filter);
  });
  sourceFilterButtons.forEach((button) => {
    setPressed(button, button.dataset.sourceFilter === state.source);
  });
}

function setPressed(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function render() {
  renderEventTypeOptions();
  updateTotals();
  renderQueue();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveEvents();
});

search.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.selectedId = "";
  render();
});

fields.venue.addEventListener("input", () => {
  renderVenueStatusHint({
    ...selectedEvent(),
    venue: fields.venue.value,
    venueId: slugify(fields.venue.value)
  });
});

fromDateInput.value = state.fromDate;
toDateInput.value = state.toDate;
sortInput.value = state.sort;

fromDateInput.addEventListener("input", (event) => {
  state.fromDate = event.target.value;
  state.selectedId = "";
  render();
});

toDateInput.addEventListener("input", (event) => {
  state.toDate = event.target.value;
  state.selectedId = "";
  render();
});

sortInput.addEventListener("change", (event) => {
  state.sort = event.target.value;
  state.selectedId = "";
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.reviewFilter;
    state.selectedId = "";
    syncFilterButtons();
    render();
  });
});

sourceFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.source = button.dataset.sourceFilter;
    state.selectedId = "";
    syncFilterButtons();
    render();
  });
});

document.querySelector("#clearArtistsButton").addEventListener("click", () => {
  fields.artists.value = "";
  fields.showType.value = "event";
  syncShowTypeFields();
});

document.querySelector("#mergeEventButton").addEventListener("click", mergeSelectedEvent);
document.querySelector("#deleteEventButton").addEventListener("click", deleteSelectedEvent);
deleteOrphanVenueShowsButton?.addEventListener("click", deleteOrphanVenueShows);

fields.showType.addEventListener("change", () => {
  syncShowTypeFields();
  const event = selectedEvent();
  if (event) renderMergeEventOptions(event);
});

fields.mikesPick.addEventListener("click", () => {
  setMikesPickButton(fields.mikesPick.getAttribute("aria-pressed") !== "true");
});

document.querySelector("#resetButton").addEventListener("click", () => {
  renderForm();
  fields.saveStatus.textContent = "Reverted to last saved version";
});

document.querySelector("#clearLocalButton").addEventListener("click", () => {
  const confirmed = window.confirm("Clear browser-saved show edits and reload from data/imported-events.js?");
  if (!confirmed) return;
  localStorage.removeItem(STORE_KEY);
  window.location.reload();
});

document.querySelector("#exportButton").addEventListener("click", exportEvents);

syncFilterButtons();
render();
