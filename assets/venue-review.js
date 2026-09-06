const STORE_KEY = "bay-area-show-explorer-venues";
const EVENT_STORE_KEY = "bay-area-show-explorer-events";
const baseStore = window.SHOW_EXPLORER_VENUES || { venues: {} };
const savedStore = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const venueStore = newerStore(savedStore, baseStore);
const baseEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const savedEvents = JSON.parse(localStorage.getItem(EVENT_STORE_KEY) || "null");
const events = newerEvents(savedEvents, baseEvents);

const state = {
  query: "",
  filter: "review",
  venueView: "records",
  appearanceMode: "group",
  fromDate: todayString(),
  toDate: dateStringFromOffset(6),
  selectedId: ""
};

const queue = document.querySelector("#venueQueue");
const form = document.querySelector("#venueForm");
const reviewGrid = document.querySelector("#venueReviewGrid");
const reviewPanel = form?.closest(".review-panel");
const search = document.querySelector("#venueSearch");
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const filterButtons = [...document.querySelectorAll("[data-review-filter]")];
const enrichButton = document.querySelector("#enrichButton");
const enrichLikelyButton = document.querySelector("#enrichLikelyButton");
const deleteOrphanVenueShowsButton = document.querySelector("#deleteOrphanVenueShowsButton");
const venueViewButtons = [...document.querySelectorAll("[data-venue-view]")];
const appearanceModeButtons = [...document.querySelectorAll("[data-appearance-mode]")];

const fields = {
  selectedName: document.querySelector("#selectedName"),
  selectedConfidence: document.querySelector("#selectedConfidence"),
  confidence: document.querySelector("#confidenceInput"),
  displayName: document.querySelector("#displayNameInput"),
  status: document.querySelector("#statusInput"),
  venueType: document.querySelector("#venueTypeInput"),
  venueTypeOptions: document.querySelector("#venueTypeOptions"),
  agePolicy: document.querySelector("#agePolicyInput"),
  city: document.querySelector("#cityInput"),
  region: document.querySelector("#regionInput"),
  regionOptions: document.querySelector("#regionOptions"),
  address: document.querySelector("#addressInput"),
  imageUrl: document.querySelector("#imageUrlInput"),
  imageSource: document.querySelector("#imageSourceInput"),
  phone: document.querySelector("#phoneInput"),
  recurringEvents: document.querySelector("#recurringEventsInput"),
  capacity: document.querySelector("#capacityInput"),
  geo: document.querySelector("#geoInput"),
  mergeTarget: document.querySelector("#mergeTargetInput"),
  summary: document.querySelector("#summaryInput"),
  summarySource: document.querySelector("#summarySourceLink"),
  links: document.querySelector("#linksEditor"),
  rejectedLinks: document.querySelector("#rejectedLinksEditor"),
  rejectedSection: document.querySelector("#rejectedLinksSection"),
  rejectedCount: document.querySelector("#rejectedLinkCount"),
  note: document.querySelector("#noteInput"),
  appearanceHeading: document.querySelector("#appearanceHeading"),
  appearanceGroupSummary: document.querySelector("#appearanceGroupSummary"),
  mergedVenueList: document.querySelector("#mergedVenueList"),
  appearances: document.querySelector("#appearanceList"),
  saveStatus: document.querySelector("#saveStatus")
};

const linkTypes = [
  "official",
  "theList",
  "instagram",
  "facebook",
  "twitter",
  "yelp",
  "ticketmaster",
  "liveNation",
  "maps",
  "wikidata",
  "wikipedia",
  "localwiki",
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

function newerEvents(saved, base) {
  const source = Array.isArray(saved) ? saved : base;
  return JSON.parse(JSON.stringify(source));
}

function venues() {
  return Object.values(venueStore.venues || {}).sort((a, b) => sortNameFor(a).localeCompare(sortNameFor(b)));
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

function sortNameFor(venue) {
  return displayNameFor(venue).replace(/^the\s+/i, "").trim();
}

function verifiedVenueTypes() {
  return [...new Set(venues()
    .filter((venue) => venue.confidence === "verified")
    .map((venue) => venue.venueType)
    .filter((type) => type && type !== "unknown"))]
    .sort((a, b) => a.localeCompare(b));
}

function verifiedRegions() {
  const defaults = ["SF", "East Bay", "South Bay", "Peninsula", "North Bay", "Santa Cruz/Monterey"];
  const reviewed = venues()
    .filter((venue) => venue.confidence === "verified")
    .map((venue) => venue.region)
    .filter(Boolean);
  return [...new Set([...defaults, ...reviewed])].sort((a, b) => a.localeCompare(b));
}

function venueText(venue) {
  return [
    venue.name,
    venue.displayName,
    venue.mergedInto,
    venue.city,
    venue.region,
    venue.status,
    venue.venueType,
    venue.address,
    venue.imageUrl,
    venue.imageSource,
    venue.phone,
    venue.summary,
    venue.reviewNotes,
    ...(venue.recurringEvents || []).flatMap((item) => [item.type, item.day, item.time, item.frequency, item.cost, item.sourceUrl]),
    ...(venue.aliases || []),
    ...(venue.links || []).flatMap((link) => [link.type, link.label, link.url, link.confidence])
  ].join(" ").toLowerCase();
}

function filteredVenues() {
  const query = state.query.trim().toLowerCase();
  return venuesForFilter(state.filter).filter((venue) => !query || venueText(venue).includes(query));
}

function filteredVenueEntries() {
  return state.venueView === "merged" ? filteredMergedVenueEntries() : filteredVenues().map((venue) => ({
    id: venue.id,
    venue,
    group: [venue]
  }));
}

function filteredMergedVenueEntries() {
  const query = state.query.trim().toLowerCase();
  const groups = new Map();
  venuesForFilter(state.filter).forEach((venue) => {
    const group = mergedVenueGroupFor(venue);
    const canonical = canonicalVenueFor(venue);
    const key = canonical.id || venue.id;
    if (!groups.has(key)) groups.set(key, { id: key, venue: canonical, group });
  });
  return [...groups.values()]
    .filter((entry) => !query || entry.group.some((venue) => venueText(venue).includes(query)))
    .sort((a, b) => sortNameFor(a.venue).localeCompare(sortNameFor(b.venue)));
}

function venuesForFilter(filter) {
  return venues().filter((venue) => {
    const matchesFilter = filter === "all" || venue.confidence === filter;
    return matchesFilter && matchesDateRange(venue);
  });
}

function matchesDateRange(venue) {
  return !state.fromDate && !state.toDate ? true : appearancesInRange(venue.source?.appearances || []).length > 0;
}

function appearancesInRange(appearances) {
  return appearances.filter((appearance) => {
    if (state.fromDate && appearance.date < state.fromDate) return false;
    if (state.toDate && appearance.date > state.toDate) return false;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.title || "").localeCompare(b.title || ""));
}

function preferredFilter() {
  if (venuesForFilter("review").length) return "review";
  if (venuesForFilter("likely").length) return "likely";
  return "verified";
}

function promoteEmptyDefaultFilter() {
  if (!["review", "likely"].includes(state.filter)) return;
  if (venuesForFilter(state.filter).length) return;
  state.filter = preferredFilter();
  state.selectedId = "";
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    setPressed(button, button.dataset.reviewFilter === state.filter);
  });
  venueViewButtons.forEach((button) => {
    setPressed(button, button.dataset.venueView === state.venueView);
  });
  appearanceModeButtons.forEach((button) => {
    setPressed(button, button.dataset.appearanceMode === state.appearanceMode);
  });
}

function setPressed(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function updateTotals() {
  const list = venues();
  document.querySelector("#venueTotal").textContent = list.length;
  document.querySelector("#reviewTotal").textContent = list.filter((venue) => venue.confidence === "review").length;
  document.querySelector("#verifiedTotal").textContent = list.filter((venue) => venue.confidence === "verified").length;
}

function renderQueue() {
  const list = filteredVenueEntries();
  queue.replaceChildren();
  if (reviewGrid) reviewGrid.hidden = list.length === 0;

  if (!list.some((entry) => entry.venue.id === state.selectedId)) {
    state.selectedId = list[0]?.venue.id || "";
  }

  if (!list.length) {
    renderForm();
    return;
  }

  for (const entry of list) {
    const venue = entry.venue;
    const isGroup = state.venueView === "merged" && entry.group.length > 1;
    const button = document.createElement("button");
    button.className = `queue-item${venue.id === state.selectedId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = displayNameFor(venue);
    const count = isGroup ? appearancesInRangeWithSources(entry.group).length : appearancesInRange(venue.source?.appearances || []).length;
    button.querySelector("span").textContent = [
      isGroup ? `${entry.group.length} merged records` : venue.name !== displayNameFor(venue) ? venue.name : "",
      venue.city || "unknown city",
      venue.confidence,
      `${count} in range`
    ].filter(Boolean).join(" | ");
    button.addEventListener("click", () => {
      state.selectedId = venue.id;
      render();
    });
    queue.append(button);
  }

  renderForm();
}

function selectedVenue() {
  return venueStore.venues?.[state.selectedId] || null;
}

function renderForm() {
  const venue = selectedVenue();
  form.hidden = !venue;
  if (reviewPanel) reviewPanel.hidden = !venue;
  if (!venue) return;

  fields.selectedName.textContent = venue.name;
  fields.selectedConfidence.textContent = confidenceLabel(venue.confidence);
  fields.selectedConfidence.className = `confidence ${venue.confidence || "review"}`;
  fields.confidence.value = venue.confidence || "review";
  fields.displayName.value = venue.displayName || venue.name || "";
  fields.status.value = venue.status || "unknown";
  fields.venueType.value = venue.venueType || "";
  fields.agePolicy.value = venue.agePolicy || "";
  fields.city.value = venue.city || "";
  fields.region.value = venue.region || "";
  fields.address.value = venue.address || "";
  fields.imageUrl.value = venue.imageUrl || "";
  fields.imageSource.value = displayImageSourceValue(venue.imageSource || "");
  fields.phone.value = venue.phone || "";
  fields.recurringEvents.value = formatRecurringEvents(venue.recurringEvents || []);
  fields.capacity.value = venue.capacity || "";
  fields.geo.value = venue.geo ? `${venue.geo.latitude}, ${venue.geo.longitude}` : "";
  fields.summary.value = venue.summary || "";
  renderSummarySource(venue);
  fields.note.value = venue.reviewNotes || "";
  renderMergeTargets(venue);
  renderLinks(venue);
  renderAppearances(venue);
}

function renderSummarySource(venue) {
  const source = venue.summarySource;
  if (!source?.url) {
    fields.summarySource.hidden = true;
    fields.summarySource.removeAttribute("href");
    fields.summarySource.textContent = "";
    return;
  }

  fields.summarySource.hidden = false;
  fields.summarySource.href = source.url;
  fields.summarySource.textContent = source.label ? `source: ${source.label}` : "source";
}

function confidenceLabel(value) {
  return {
    review: "review",
    likely: "likely",
    verified: "verified",
    rejected: "rejected"
  }[value] || "review";
}

function displayNameFor(venue) {
  return venue.displayName || venue.name || "";
}

function cleanImageSource(value = "") {
  return String(value || "").replace(/^source\s*:\s*/i, "").trim().replace(/\/+$/g, "");
}

function displayImageSourceValue(value = "") {
  return cleanImageSource(value);
}

function renderMergeTargets(venue) {
  fields.mergeTarget.replaceChildren();
  fields.mergeTarget.add(new Option("Choose venue", ""));
  venues()
    .filter((candidate) => candidate.id !== venue.id && candidate.confidence !== "rejected")
    .forEach((candidate) => {
      fields.mergeTarget.add(new Option(`${displayNameFor(candidate)} (${candidate.id})`, candidate.id));
    });
}

function activeLinks(venue) {
  return [...(venue.links || [])].filter((link) => link.confidence !== "rejected").sort(linkSort);
}

function rejectedLinks(venue) {
  return [...(venue.links || [])].filter((link) => link.confidence === "rejected").sort(linkSort);
}

function linkSort(a, b) {
  return linkDisplayRank(a) - linkDisplayRank(b) || labelForType(a.type).localeCompare(labelForType(b.type)) || (a.url || "").localeCompare(b.url || "");
}

function linkDisplayRank(link) {
  if (link.display === false) return 2;
  if (link.displayPriority === "primary") return 0;
  return 1;
}

function renderLinks(venue) {
  fields.links.replaceChildren();
  fields.rejectedLinks.replaceChildren();
  activeLinks(venue).forEach((link) => fields.links.append(linkRow(venue, link)));
  rejectedLinks(venue).forEach((link) => fields.rejectedLinks.append(linkRow(venue, link, true)));
  fields.rejectedCount.textContent = rejectedLinks(venue).length;
  fields.rejectedSection.hidden = rejectedLinks(venue).length === 0;
}

function linkRow(venue, link, rejected = false) {
  const row = document.createElement("div");
  row.className = `link-row${rejected ? " rejected" : ""}`;

  const type = document.createElement("select");
  linkTypes.forEach((value) => type.add(new Option(labelForType(value), value)));
  type.value = link.type || "other";

  const label = document.createElement("input");
  label.type = "text";
  label.value = link.label || labelForType(link.type);

  const url = document.createElement("input");
  url.type = "url";
  url.value = link.url || "";

  const confidence = document.createElement("select");
  confidenceOptions.forEach((value) => confidence.add(new Option(value, value)));
  confidence.value = link.confidence || "candidate";

  const displayLabel = document.createElement("label");
  displayLabel.className = "link-display-control";
  const display = document.createElement("input");
  display.type = "checkbox";
  display.checked = suggestedLinkDisplay(link);
  displayLabel.append(display, document.createTextNode("Show"));

  const priority = document.createElement("select");
  priority.add(new Option("Primary", "primary"));
  priority.add(new Option("Secondary", "secondary"));
  priority.value = link.displayPriority || suggestedLinkPriority(link);

  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.type = "button";
  remove.textContent = "x";
  remove.title = "Remove link";

  type.addEventListener("change", () => {
    link.type = type.value;
    link.label = labelForType(type.value);
    label.value = link.label;
    persistDraft();
    renderLinks(venue);
  });
  label.addEventListener("input", () => {
    link.label = label.value;
    persistDraft();
  });
  url.addEventListener("input", () => {
    link.url = url.value;
    persistDraft();
  });
  confidence.addEventListener("change", () => {
    link.confidence = confidence.value;
    applyVerifiedDisplaySuggestion(link, display, priority);
    persistDraft();
    renderLinks(venue);
  });
  display.addEventListener("change", () => {
    link.display = display.checked;
    persistDraft();
    renderLinks(venue);
  });
  priority.addEventListener("change", () => {
    link.displayPriority = priority.value;
    persistDraft();
    renderLinks(venue);
  });
  remove.addEventListener("click", () => {
    venue.links = (venue.links || []).filter((item) => item !== link);
    persistDraft();
    renderLinks(venue);
  });

  row.append(type, label, url, confidence, displayLabel, priority, remove);
  return row;
}

function suggestedLinkDisplay(link = {}) {
  if (link.display === false) return false;
  return link.display !== undefined ? Boolean(link.display) : true;
}

function suggestedLinkPriority(link = {}) {
  if (link.displayPriority) return link.displayPriority;
  if (link.confidence !== "verified" || link.type === "search") return "secondary";
  return ["official", "theList", "badSlava", "maps", "yelp"].includes(link.type) ? "primary" : "secondary";
}

function applyVerifiedDisplaySuggestion(link, display, priority) {
  if (link.confidence !== "verified" || link.type === "search") return;
  if (link.display === undefined) {
    link.display = true;
    display.checked = true;
  }
  if (!link.displayPriority) {
    link.displayPriority = suggestedLinkPriority(link);
    priority.value = link.displayPriority;
  }
}

function renderAppearances(venue) {
  const group = mergedVenueGroupFor(venue);
  const useGroup = state.appearanceMode === "group" && group.length > 1;
  const appearanceSources = useGroup ? group : [venue];
  const appearances = appearancesInRangeWithSources(appearanceSources);
  fields.appearanceHeading.textContent = useGroup
    ? (state.fromDate || state.toDate ? "Merged Group Events in Range" : "Merged Group Events")
    : (state.fromDate || state.toDate ? "Events in Range" : "Events");
  renderMergedVenueSummary(venue, group);
  fields.appearances.replaceChildren();
  if (!appearances.length) {
    const empty = document.createElement("p");
    empty.className = "appearance";
    empty.textContent = "No events match the selected date range.";
    fields.appearances.append(empty);
    return;
  }

  appearances.forEach((appearance) => {
    const item = document.createElement("p");
    item.className = "appearance";
    const sourceLabel = useGroup ? ` (${appearance.sourceVenueName})` : "";
    item.textContent = `${appearance.date} - ${appearance.title || "Untitled event"}${sourceLabel} - ${appearance.details || ""}`;
    fields.appearances.append(item);
  });
}

function mergedVenueGroupFor(venue) {
  const canonical = canonicalVenueFor(venue);
  const canonicalId = canonical?.id || venue.id;
  return venues()
    .filter((candidate) => candidate.id === canonicalId || candidate.mergedInto === canonicalId)
    .sort((a, b) => Number(a.id === canonicalId) - Number(b.id === canonicalId) || displayNameFor(a).localeCompare(displayNameFor(b)));
}

function canonicalVenueFor(venue) {
  return venue.mergedInto && venueStore.venues?.[venue.mergedInto]
    ? venueStore.venues[venue.mergedInto]
    : venue;
}

function appearancesInRangeWithSources(appearanceSources) {
  const appearances = appearanceSources.flatMap((venue) => {
    return appearancesInRange(venue.source?.appearances || []).map((appearance) => ({
      ...appearance,
      sourceVenueId: venue.id,
      sourceVenueName: displayNameFor(venue) || venue.name || venue.id,
      sourceVenueConfidence: venue.confidence || "review"
    }));
  });
  return uniqueAppearances(appearances)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.title || "").localeCompare(b.title || "") || a.sourceVenueName.localeCompare(b.sourceVenueName));
}

function renderMergedVenueSummary(selected, group) {
  const hasGroup = group.length > 1;
  fields.appearanceGroupSummary.hidden = !hasGroup;
  fields.mergedVenueList.hidden = !hasGroup;
  appearanceModeButtons.forEach((button) => {
    button.hidden = !hasGroup;
  });

  if (!hasGroup) {
    fields.appearanceGroupSummary.textContent = "";
    fields.mergedVenueList.replaceChildren();
    return;
  }

  const canonical = canonicalVenueFor(selected);
  const summaryGroup = [...group].sort((a, b) => Number(b.id === canonical.id) - Number(a.id === canonical.id) || displayNameFor(a).localeCompare(displayNameFor(b)));
  const selectedIsCanonical = selected.id === canonical.id;
  fields.appearanceGroupSummary.textContent = selectedIsCanonical
    ? `Showing ${group.length} merged venue records for ${displayNameFor(canonical)}.`
    : `Showing merged group for ${displayNameFor(canonical)}. Selected source record: ${displayNameFor(selected)}.`;

  fields.mergedVenueList.replaceChildren();
  summaryGroup.forEach((venue) => {
    const item = document.createElement("span");
    item.className = `merged-venue-chip ${venue.confidence || "review"}`;
    item.textContent = [
      displayNameFor(venue),
      venue.id === canonical.id ? "canonical" : venue.confidence || "review"
    ].filter(Boolean).join(" / ");
    fields.mergedVenueList.append(item);
  });
}

function updateSelectedVenueFromForm() {
  const venue = selectedVenue();
  if (!venue) return null;
  venue.confidence = fields.confidence.value;
  venue.displayName = fields.displayName.value.trim() || venue.name;
  venue.status = fields.status.value;
  venue.venueType = fields.venueType.value.trim() || "unknown";
  venue.agePolicy = fields.agePolicy.value.trim() || "unknown";
  venue.city = fields.city.value.trim();
  venue.region = fields.region.value.trim();
  venue.address = fields.address.value.trim();
  venue.imageUrl = fields.imageUrl.value.trim();
  venue.imageSource = cleanImageSource(fields.imageSource.value);
  venue.phone = fields.phone.value.trim();
  venue.recurringEvents = parseRecurringEvents(fields.recurringEvents.value);
  venue.capacity = fields.capacity.value.trim();
  venue.geo = parseGeo(fields.geo.value);
  const previousSummary = venue.summary || "";
  venue.summary = fields.summary.value.trim();
  if (venue.summary !== previousSummary) {
    venue.summarySource = venue.summary ? {
      label: "Manual",
      url: "",
      source: "manual"
    } : null;
  }
  venue.reviewNotes = fields.note.value.trim();
  venue.updatedAt = new Date().toISOString();
  return venue;
}

async function mergeSelectedVenue() {
  const source = updateSelectedVenueFromForm();
  const targetId = fields.mergeTarget.value;
  const target = venueStore.venues?.[targetId];
  if (!source || !target || source.id === target.id) {
    fields.saveStatus.textContent = "Choose a target venue first";
    return;
  }

  target.aliases = unique([
    ...(target.aliases || []),
    source.name,
    source.displayName,
    ...(source.aliases || [])
  ].filter(Boolean));
  target.imageUrl ||= source.imageUrl || "";
  target.imageSource ||= source.imageSource || "";
  target.links = mergeVenueLinks(target.links || [], source.links || []);
  target.evidence = [...(target.evidence || []), ...(source.evidence || [])];
  target.source ||= {};
  target.source.appearances = uniqueAppearances([
    ...(target.source?.appearances || []),
    ...(source.source?.appearances || [])
  ]);
  target.source.lastImportedAt = latestDate(target.source?.lastImportedAt, source.source?.lastImportedAt);

  source.confidence = "rejected";
  source.status = "inactive";
  source.mergedInto = target.id;
  source.reviewNotes = [source.reviewNotes, `Merged into ${displayNameFor(target)}.`].filter(Boolean).join("\n");
  persistDraft();
  await saveStore();
  state.selectedId = target.id;
  fields.saveStatus.textContent = `Merged into ${displayNameFor(target)}`;
  render();
}

async function deleteSelectedVenue() {
  const venue = selectedVenue();
  if (!venue) return;

  const displayName = displayNameFor(venue) || venue.id;
  const redirectCount = venues().filter((item) => item.mergedInto === venue.id).length;
  const redirectWarning = redirectCount
    ? ` ${redirectCount} merged venue record${redirectCount === 1 ? "" : "s"} point to this record.`
    : "";
  const confirmed = window.confirm(`Delete "${displayName}"? This permanently removes the venue record.${redirectWarning}`);
  if (!confirmed) return;

  const visibleBefore = filteredVenueEntries();
  const currentIndex = Math.max(0, visibleBefore.findIndex((item) => item.venue.id === venue.id));
  removeMergedVenueAlias(venue);
  delete venueStore.venues[venue.id];

  const visibleAfter = filteredVenueEntries();
  const fallbackAfter = venues();
  const next = visibleAfter[Math.min(currentIndex, visibleAfter.length - 1)] || visibleAfter[0] || null;
  state.selectedId = next?.venue?.id || fallbackAfter[0]?.id || "";

  await saveStore();
  fields.saveStatus.textContent = `Deleted ${displayName}`;
  render();
}

async function deleteOrphanVenueShows() {
  const orphanEvents = events.filter(isOrphanVenueShow);
  if (!orphanEvents.length) {
    fields.saveStatus.textContent = "No shows are missing venue records";
    return;
  }

  const confirmed = window.confirm(`Delete ${orphanEvents.length} show record${orphanEvents.length === 1 ? "" : "s"} without a matching venue? This checks all shows, not just the current venue filter.`);
  if (!confirmed) return;

  const orphanIds = new Set(orphanEvents.map((event) => event.id));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (orphanIds.has(events[index].id)) events.splice(index, 1);
  }

  const savedToFile = await saveEvents();
  fields.saveStatus.textContent = `Deleted ${orphanEvents.length} show record${orphanEvents.length === 1 ? "" : "s"} without venues${savedToFile ? "" : " in browser only"}`;
}

function isOrphanVenueShow(event) {
  return !resolvedVenueForEvent(event);
}

function resolvedVenueForEvent(event) {
  return bestVenueMatch([
    venueByName(event.venue || ""),
    venueById(slugify(event.venue || "")),
    venueById(event.venueId)
  ]);
}

function venueById(id = "") {
  return id ? venueStore.venues?.[id] || null : null;
}

function venueByName(name = "") {
  const key = normalizeText(name);
  if (!key) return null;
  return venues().find((venue) => {
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
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))[0] || null;
}

function removeMergedVenueAlias(venue) {
  const target = venue.mergedInto ? venueStore.venues?.[venue.mergedInto] : null;
  if (!target?.aliases?.length) return;

  const removedNames = new Set([
    venue.name,
    venue.displayName,
    ...(venue.aliases || [])
  ].filter(Boolean).map(normalizedAlias));

  target.aliases = target.aliases.filter((alias) => !removedNames.has(normalizedAlias(alias)));
}

function normalizedAlias(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueAppearances(appearances) {
  const seen = new Set();
  return appearances.filter((appearance) => {
    const key = appearance.eventId || `${appearance.date}|${appearance.title}|${appearance.details}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestDate(a = "", b = "") {
  return Date.parse(a) > Date.parse(b) ? a : b;
}

function mergeVenueLinks(existingLinks, incomingLinks) {
  const links = new Map();
  for (const link of [...existingLinks, ...incomingLinks]) {
    if (!link?.url) continue;
    const key = linkKey(link);
    const previous = links.get(key);
    if (previous?.confidence === "rejected") continue;
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence)) {
      links.set(key, link);
    }
  }
  return [...links.values()];
}

function linkKey(link) {
  if (link.type === "maps") return "maps";
  return normalizedUrl(link.url || "");
}

function normalizedUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^www\./i, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function parseGeo(value) {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { latitude: Number(match[1]), longitude: Number(match[2]) };
}

function formatRecurringEvents(items) {
  return items.map((item) => {
    return [
      item.frequency || "",
      item.day || "",
      item.time || "",
      item.type || "",
      item.cost || "",
      item.sourceUrl || ""
    ].join(" | ").replace(/\s+\|\s+$/g, "");
  }).join("\n");
}

function parseRecurringEvents(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [frequency = "", day = "", time = "", type = "", cost = "", sourceUrl = ""] = line.split("|").map((part) => part.trim());
      return {
        frequency,
        day,
        time,
        type,
        cost,
        sourceUrl,
        source: sourceUrl ? "manual" : "manual"
      };
    });
}

function persistDraft() {
  venueStore.generatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(venueStore));
}

async function saveStore() {
  persistDraft();
  try {
    const response = await fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(venueStore)
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const result = await response.json();
    venueStore.generatedAt = result.savedAt || venueStore.generatedAt;
    localStorage.setItem(STORE_KEY, JSON.stringify(venueStore));
    fields.saveStatus.textContent = "Saved to data/venues.js";
  } catch {
    fields.saveStatus.textContent = "Saved in browser only";
  }
}

function persistEventDraft() {
  localStorage.setItem(EVENT_STORE_KEY, JSON.stringify(events));
}

async function saveEvents() {
  persistEventDraft();
  fields.saveStatus.textContent = "Show changes saved in browser";

  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events)
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const result = await response.json();
    localStorage.removeItem(EVENT_STORE_KEY);
    fields.saveStatus.textContent = `Saved ${result.count} shows at ${new Date(result.savedAt).toLocaleTimeString()}`;
    return true;
  } catch {
    fields.saveStatus.textContent = "Show changes saved in browser only";
    return false;
  }
}

async function enrichVenue() {
  const venue = updateSelectedVenueFromForm();
  if (!venue) return;
  fields.saveStatus.textContent = "Enriching...";
  await saveStore();
  try {
    const response = await fetch("/api/enrich-venue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: venue.id, name: venue.name })
    });
    if (!response.ok) throw new Error(`Enrichment failed: ${response.status}`);
    const result = await response.json();
    venueStore.venues[venue.id] = result.venue;
    venueStore.generatedAt = result.generatedAt || new Date().toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(venueStore));
    fields.saveStatus.textContent = "Enrichment complete";
    render();
  } catch {
    fields.saveStatus.textContent = "Enrichment needs the local dev server";
  }
}

async function enrichLikelyVenues() {
  updateSelectedVenueFromForm();
  const count = venues().filter((venue) => venue.confidence === "likely").length;
  if (!count) {
    fields.saveStatus.textContent = "No likely venues to enrich";
    return;
  }

  fields.saveStatus.textContent = `Enriching ${count} likely venues...`;
  enrichLikelyButton.disabled = true;
  enrichButton.disabled = true;
  await saveStore();

  try {
    const response = await fetch("/api/enrich-likely-venues", { method: "POST" });
    if (!response.ok) throw new Error(`Batch enrichment failed: ${response.status}`);
    const result = await response.json();
    venueStore.venues = result.venues || venueStore.venues;
    venueStore.generatedAt = result.generatedAt || new Date().toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(venueStore));
    fields.saveStatus.textContent = "Likely venue enrichment complete";
    render();
  } catch {
    fields.saveStatus.textContent = "Likely enrichment needs the local dev server";
  } finally {
    enrichLikelyButton.disabled = false;
    enrichButton.disabled = false;
  }
}

async function pruneRejectedVenueArtists() {
  fields.saveStatus.textContent = "Pruning...";
  await saveStore();
  try {
    const response = await fetch("/api/prune-rejected-venue-artists", { method: "POST" });
    if (!response.ok) throw new Error(`Prune failed: ${response.status}`);
    const result = await response.json();
    fields.saveStatus.textContent = `Removed ${result.removed} artist profile${result.removed === 1 ? "" : "s"}`;
  } catch {
    fields.saveStatus.textContent = "Prune needs the local dev server";
  }
}

function exportStore() {
  const payload = `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(venueStore, null, 2)};\n`;
  const blob = new Blob([payload], { type: "text/javascript" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "venues.js";
  link.click();
  URL.revokeObjectURL(link.href);
}

function labelForType(type = "") {
  const labels = {
    facebook: "Facebook",
    instagram: "Instagram",
    liveNation: "Live Nation",
    maps: "Maps",
    official: "Official",
    search: "Search",
    theList: "The List",
    ticketmaster: "Ticketmaster",
    twitter: "X/Twitter",
    wikidata: "Wikidata",
    wikipedia: "Wikipedia",
    localwiki: "LocalWiki",
    yelp: "Yelp",
    other: "Other"
  };
  return labels[type] || type || "Link";
}

function render() {
  promoteEmptyDefaultFilter();
  syncFilterButtons();
  renderVenueTypeOptions();
  renderRegionOptions();
  updateTotals();
  renderQueue();
}

function renderVenueTypeOptions() {
  fields.venueTypeOptions.replaceChildren();
  verifiedVenueTypes().forEach((type) => {
    fields.venueTypeOptions.append(new Option(type, type));
  });
}

function renderRegionOptions() {
  fields.regionOptions.replaceChildren();
  verifiedRegions().forEach((region) => {
    fields.regionOptions.append(new Option(region, region));
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateSelectedVenueFromForm();
  await saveStore();
  render();
});

document.querySelector("#addLinkButton").addEventListener("click", () => {
  const venue = selectedVenue();
  if (!venue) return;
  venue.links ||= [];
  venue.links.push({
    type: "official",
    label: "Official",
    url: "",
    confidence: "candidate",
    source: "manual"
  });
  persistDraft();
  renderLinks(venue);
});

document.querySelector("#resetButton").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  window.location.reload();
});

document.querySelector("#clearLocalButton").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  fields.saveStatus.textContent = "Browser store cleared";
});

document.querySelector("#exportButton").addEventListener("click", exportStore);
document.querySelector("#mergeVenueButton").addEventListener("click", mergeSelectedVenue);
document.querySelector("#deleteVenueButton").addEventListener("click", deleteSelectedVenue);
deleteOrphanVenueShowsButton?.addEventListener("click", deleteOrphanVenueShows);
document.querySelector("#pruneArtistsButton").addEventListener("click", pruneRejectedVenueArtists);
enrichButton.addEventListener("click", enrichVenue);
enrichLikelyButton.addEventListener("click", enrichLikelyVenues);

search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

fromDateInput.value = state.fromDate;
toDateInput.value = state.toDate;

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

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.reviewFilter;
    syncFilterButtons();
    state.selectedId = "";
    render();
  });
});

venueViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.venueView = button.dataset.venueView;
    syncFilterButtons();
    state.selectedId = "";
    render();
  });
});

appearanceModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.appearanceMode = button.dataset.appearanceMode;
    syncFilterButtons();
    const venue = selectedVenue();
    if (venue) renderAppearances(venue);
  });
});

state.filter = preferredFilter();
syncFilterButtons();
render();
