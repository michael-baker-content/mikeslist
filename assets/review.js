const STORE_KEY = "bay-area-show-explorer-artists";
const baseStore = window.SHOW_EXPLORER_ARTISTS || { artists: {} };
const savedStore = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const artistStore = newerStore(savedStore, baseStore);

const state = {
  query: "",
  filter: "review",
  selectedId: ""
};

const queue = document.querySelector("#artistQueue");
const form = document.querySelector("#artistForm");
const search = document.querySelector("#artistSearch");
const filterButtons = [...document.querySelectorAll("[data-review-filter]")];
const enrichButton = document.querySelector("#enrichButton");

const fields = {
  selectedName: document.querySelector("#selectedName"),
  selectedConfidence: document.querySelector("#selectedConfidence"),
  confidence: document.querySelector("#confidenceInput"),
  locality: document.querySelector("#localityInput"),
  genres: document.querySelector("#genresInput"),
  priority: document.querySelector("#priorityInput"),
  summary: document.querySelector("#summaryInput"),
  links: document.querySelector("#linksEditor"),
  rejectedLinks: document.querySelector("#rejectedLinksEditor"),
  rejectedSection: document.querySelector("#rejectedLinksSection"),
  rejectedCount: document.querySelector("#rejectedLinkCount"),
  note: document.querySelector("#noteInput"),
  appearances: document.querySelector("#appearanceList"),
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
  return Object.values(artistStore.artists || {}).sort((a, b) => {
    return a.name.localeCompare(b.name);
  });
}

function artistText(artist) {
  return [
    artist.name,
    artist.locality,
    artist.summary,
    artist.disambiguation,
    artist.reviewNotes,
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
    return filterMatch && queryMatch;
  });
}

function preferredFilter() {
  for (const filter of ["review", "likely", "verified"]) {
    if (artists().some((artist) => artist.confidence === filter)) return filter;
  }
  return "all";
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewFilter === state.filter);
  });
}

function updateSummary() {
  const list = artists();
  document.querySelector("#artistTotal").textContent = list.length;
  document.querySelector("#reviewTotal").textContent = list.filter((artist) => artist.confidence === "review").length;
  document.querySelector("#verifiedTotal").textContent = list.filter((artist) => artist.confidence === "verified").length;
}

function inferLinkType(url = "") {
  const lower = url.toLowerCase();
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
  if (lower.includes("wikipedia.org")) return "wikipedia";
  if (lower.includes("music.apple.com")) return "appleMusic";
  if (lower.includes("music.amazon.com")) return "amazonMusic";
  if (lower.includes("ticketmaster.com")) return "ticketmaster";
  if (lower.includes("qobuz.com")) return "qobuz";
  if (lower.includes("deezer.com")) return "deezer";
  if (lower.includes("tidal.com")) return "tidal";
  if (lower.includes("wikidata.org")) return "wikidata";
  if (lower.includes("duckduckgo.com") || lower.includes("google.com/search")) return "search";
  return "official";
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
  fields.locality.value = artist.locality || "";
  fields.genres.value = (artist.genres || artist.tags || []).join(", ");
  fields.priority.value = supportPriorityForArtist(artist).join(", ");
  fields.summary.value = artist.summary || "";
  renderLinkEditor(artist.links || []);
  fields.note.value = artist.reviewNotes || artist.note || "";

  fields.appearances.replaceChildren();
  (artist.source?.appearances || []).forEach((show) => {
    const item = document.createElement("p");
    item.className = "appearance";
    item.textContent = `${show.date} - ${show.venue} - ${show.details}`;
    fields.appearances.append(item);
  });

  renderQueue();
}

function renderQueue() {
  const list = visibleArtists();
  queue.replaceChildren();

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
    const count = artist.source?.appearances?.length || 0;
    meta.textContent = `${artist.confidence || "review"} / ${count} show${count === 1 ? "" : "s"}`;

    button.append(name, meta);
    button.addEventListener("click", () => selectArtist(artist.id));
    queue.append(button);
  });
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  artist.confidence = fields.confidence.value;
  artist.locality = fields.locality.value.trim() || "unknown";
  artist.genres = fields.genres.value.split(",").map((tag) => tag.trim()).filter(Boolean);
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
  renderQueue();
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

enrichButton.addEventListener("click", async () => {
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  fields.saveStatus.textContent = "Saving before enrichment...";
  await saveCurrentArtist();

  enrichButton.disabled = true;
  fields.saveStatus.textContent = `Enriching ${artist.name}...`;

  try {
    const response = await fetch("/api/enrich-artist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: artist.id, name: artist.name })
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
syncFilterButtons();
const first = visibleArtists()[0] || artists()[0];
if (first) selectArtist(first.id);
renderQueue();

async function saveCurrentArtist() {
  const artist = artistStore.artists[state.selectedId];
  if (!artist) return;

  artist.confidence = fields.confidence.value;
  artist.locality = fields.locality.value.trim() || "unknown";
  artist.genres = fields.genres.value.split(",").map((tag) => tag.trim()).filter(Boolean);
  delete artist.tags;
  artist.summary = fields.summary.value.trim();
  artist.links = readLinkEditor();
  artist.supportPriority = supportPriorityForLinks(artist.links);
  artist.reviewNotes = fields.note.value.trim();
  delete artist.note;

  await persist();
}
