const STORE_KEY = "bay-area-show-explorer-venues";
const baseStore = window.SHOW_EXPLORER_VENUES || { venues: {} };
const savedStore = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const venueStore = newerStore(savedStore, baseStore);

const state = {
  query: "",
  filter: "review",
  selectedId: ""
};

const queue = document.querySelector("#venueQueue");
const form = document.querySelector("#venueForm");
const search = document.querySelector("#venueSearch");
const filterButtons = [...document.querySelectorAll("[data-review-filter]")];
const enrichButton = document.querySelector("#enrichButton");
const enrichLikelyButton = document.querySelector("#enrichLikelyButton");

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

function venues() {
  return Object.values(venueStore.venues || {}).sort((a, b) => sortNameFor(a).localeCompare(sortNameFor(b)));
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
    venue.summary,
    venue.reviewNotes,
    ...(venue.aliases || []),
    ...(venue.links || []).flatMap((link) => [link.type, link.label, link.url, link.confidence])
  ].join(" ").toLowerCase();
}

function filteredVenues() {
  const query = state.query.trim().toLowerCase();
  return venues().filter((venue) => {
    const matchesQuery = !query || venueText(venue).includes(query);
    const matchesFilter = state.filter === "all" || venue.confidence === state.filter;
    return matchesQuery && matchesFilter;
  });
}

function preferredFilter() {
  for (const filter of ["review", "likely", "verified"]) {
    if (venues().some((venue) => venue.confidence === filter)) return filter;
  }
  return "all";
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewFilter === state.filter);
  });
}

function updateTotals() {
  const list = venues();
  document.querySelector("#venueTotal").textContent = list.length;
  document.querySelector("#reviewTotal").textContent = list.filter((venue) => venue.confidence === "review").length;
  document.querySelector("#verifiedTotal").textContent = list.filter((venue) => venue.confidence === "verified").length;
}

function renderQueue() {
  const list = filteredVenues();
  queue.replaceChildren();

  if (!list.some((venue) => venue.id === state.selectedId)) {
    state.selectedId = list[0]?.id || "";
  }

  for (const venue of list) {
    const button = document.createElement("button");
    button.className = `queue-item${venue.id === state.selectedId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = displayNameFor(venue);
    button.querySelector("span").textContent = [venue.name !== displayNameFor(venue) ? venue.name : "", venue.city || "unknown city", venue.confidence].filter(Boolean).join(" | ");
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
  display.checked = link.display !== false;
  displayLabel.append(display, document.createTextNode("Show"));

  const priority = document.createElement("select");
  priority.add(new Option("Primary", "primary"));
  priority.add(new Option("Secondary", "secondary"));
  priority.value = link.displayPriority === "primary" ? "primary" : "secondary";

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

function renderAppearances(venue) {
  const appearances = venue.source?.appearances || [];
  fields.appearances.replaceChildren();
  if (!appearances.length) {
    const empty = document.createElement("p");
    empty.className = "appearance";
    empty.textContent = "No upcoming events are attached to this venue yet.";
    fields.appearances.append(empty);
    return;
  }

  appearances.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((appearance) => {
    const item = document.createElement("p");
    item.className = "appearance";
    item.textContent = `${appearance.date} - ${appearance.title || "Untitled event"} - ${appearance.details || ""}`;
    fields.appearances.append(item);
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
document.querySelector("#pruneArtistsButton").addEventListener("click", pruneRejectedVenueArtists);
enrichButton.addEventListener("click", enrichVenue);
enrichLikelyButton.addEventListener("click", enrichLikelyVenues);

search.addEventListener("input", (event) => {
  state.query = event.target.value;
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

state.filter = preferredFilter();
syncFilterButtons();
render();
