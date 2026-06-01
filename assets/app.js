const events = [...(window.SHOW_EXPLORER_EVENTS || [])].sort((a, b) => {
  return a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue);
});
const artistStore = window.SHOW_EXPLORER_ARTISTS?.artists || {};
const venueStore = window.SHOW_EXPLORER_VENUES?.venues || {};

const state = {
  query: "",
  filter: "all"
};

const eventList = document.querySelector("#eventList");
const venueMap = document.querySelector("#venueMap");
const venueMapSvg = document.querySelector("#venueMapSvg");
const venueMapCount = document.querySelector("#venueMapCount");
const venueModal = document.querySelector("#venueModal");
const venueModalTitle = document.querySelector("#venueModalTitle");
const venueModalMeta = document.querySelector("#venueModalMeta");
const venueModalLinks = document.querySelector("#venueModalLinks");
const venueModalProfile = document.querySelector("#venueModalProfile");
const venueModalClose = document.querySelector("#venueModalClose");
const eventTemplate = document.querySelector("#eventTemplate");
const artistTemplate = document.querySelector("#artistTemplate");
const searchInput = document.querySelector("#searchInput");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

const confidenceLabels = {
  verified: "verified",
  likely: "likely",
  review: "review"
};

function formatDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function textForEvent(event) {
  return [
    event.date,
    event.venue,
    enrichVenue(event).city,
    enrichVenue(event).region,
    event.details,
    ...event.artists.map(enrichArtist).flatMap((artist) => [
      artist.name,
      artist.locality,
      ...(artist.genres || artist.tags || [])
    ])
  ].join(" ").toLowerCase();
}

function matchesFilter(event) {
  if (state.filter === "all") return true;
  if (state.filter === "tonight") return event.date === new Date().toISOString().slice(0, 10);
  if (state.filter === "allAges") return /\ba\/a\b|all ages/i.test(event.details);
  if (state.filter === "local") return event.artists.map(enrichArtist).some((artist) => /bay area|local|california/i.test(artist.locality));
  if (state.filter === "needsReview") return event.artists.map(enrichArtist).some((artist) => artist.confidence === "review");
  return true;
}

function visibleEvents() {
  const query = state.query.trim().toLowerCase();
  return events.filter((event) => {
    const queryMatch = !query || textForEvent(event).includes(query);
    return queryMatch && matchesFilter(event);
  });
}

function updateSummary(list) {
  const artists = list.flatMap((event) => event.artists.map(enrichArtist));
  document.querySelector("#eventCount").textContent = list.length;
  document.querySelector("#artistCount").textContent = artists.length;
  document.querySelector("#reviewCount").textContent = artists.filter((artist) => artist.confidence === "review").length;
}

function enrichArtist(artist) {
  const enrichment = artistStore[slugify(artist.name)] || {};
  return {
    ...artist,
    ...enrichment,
    links: enrichment.links || artist.links || []
  };
}

function enrichVenue(event) {
  const venue = venueStore[event.venueId || venueIdFor(event)];
  if (venue?.mergedInto && venueStore[venue.mergedInto]) return venueStore[venue.mergedInto];
  return venue || {
    name: event.venue,
    displayName: event.venue,
    city: event.city || "",
    region: ""
  };
}

function renderArtist(artist) {
  const displayArtist = enrichArtist(artist);
  const node = artistTemplate.content.firstElementChild.cloneNode(true);
  const artistName = node.querySelector(".artist-name");
  const artistLink = document.createElement("a");
  artistLink.href = `artist.html?id=${encodeURIComponent(displayArtist.id || slugify(displayArtist.name))}&from=${encodeURIComponent("index.html")}`;
  artistLink.textContent = displayArtist.name;
  artistName.append(artistLink);
  node.querySelector(".artist-tags").textContent = (displayArtist.genres || displayArtist.tags || []).join(" / ");
  node.querySelector(".artist-note").textContent = displayArtist.summary || displayArtist.reviewNotes || displayArtist.note || "";

  const confidence = node.querySelector(".confidence");
  confidence.textContent = confidenceLabels[displayArtist.confidence] || "unknown";
  confidence.classList.add(displayArtist.confidence || "review");

  const links = node.querySelector(".artist-links");
  prioritizedLinks(displayArtist).forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label;
    links.append(anchor);
  });

  return node;
}

function renderVenueLinks(venue, container) {
  showExplorerLinks(venue.links || []).forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label || labelForType(link.type);
    container.append(anchor);
  });
}

function imageForEvent(event) {
  const topArtist = enrichArtist(event.artists[0] || { name: event.venue });
  const palette = paletteForArtist(topArtist);
  const title = topArtist.name || event.venue || "Bay Area Show";
  const subtitleParts = [
    ...(topArtist.genres || topArtist.tags || []).slice(0, 2),
    topArtist.locality
  ].filter(Boolean);
  const titleLines = wrapPosterText(title, 16, 2).map(escapeSvg);
  const subtitle = escapeSvg(truncateText(subtitleParts.join(" / ") || "Live music", 34));
  const initials = escapeSvg(initialsFor(topArtist.name || event.venue || "BA"));
  const titleMarkup = titleLines.map((line, index) => {
    const y = 176 + index * 46;
    return `<text x="34" y="${y}" fill="#fffdfa" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="850">${line}</text>`;
  }).join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360" preserveAspectRatio="none" role="img" aria-label="${escapeSvg(title)}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${palette[0]}"/>
          <stop offset="1" stop-color="${palette[1]}"/>
        </linearGradient>
        <pattern id="lines" width="38" height="38" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 18 H38" stroke="${palette[2]}" stroke-width="4" opacity=".2"/>
        </pattern>
      </defs>
      <rect width="480" height="360" fill="url(#bg)"/>
      <rect width="480" height="360" fill="url(#lines)"/>
      <circle cx="392" cy="70" r="78" fill="${palette[2]}" opacity=".26"/>
      <circle cx="72" cy="314" r="104" fill="#fffdfa" opacity=".14"/>
      <text x="34" y="48" fill="#fffdfa" opacity=".78" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800">TOP BILL</text>
      ${titleMarkup}
      <text x="36" y="282" fill="#fffdfa" opacity=".82" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700">${subtitle}</text>
      <text x="388" y="320" text-anchor="middle" fill="#fffdfa" opacity=".28" font-family="Inter, Arial, sans-serif" font-size="90" font-weight="900">${initials}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function wrapPosterText(text, maxLineLength, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLineLength || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible[visible.length - 1] = truncateText(visible[visible.length - 1], Math.max(4, maxLineLength - 1));
  }
  return visible.length ? visible : ["Live Show"];
}

function truncateText(text, maxLength) {
  if (String(text).length <= maxLength) return String(text);
  return `${String(text).slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function paletteForArtist(artist) {
  const text = [
    artist.name,
    artist.locality,
    ...(artist.genres || artist.tags || [])
  ].join(" ").toLowerCase();
  if (/metal|punk|hardcore|doom|goth|industrial/.test(text)) return ["#231f20", "#9a3324", "#f4c95d"];
  if (/jazz|soul|blues|funk|r&b/.test(text)) return ["#13293d", "#8f5a2a", "#e7c27d"];
  if (/electronic|dj|dance|house|techno|edm|club/.test(text)) return ["#102542", "#7b2cbf", "#00c2a8"];
  if (/folk|country|bluegrass|americana|singer/.test(text)) return ["#204b3a", "#a95d34", "#f0d58c"];
  if (/hip hop|rap|trap/.test(text)) return ["#151515", "#0f6b5f", "#f4a261"];
  const palettes = [
    ["#0f6b5f", "#b9432f", "#f0d58c"],
    ["#345f99", "#a46f09", "#f2d7b6"],
    ["#304c3f", "#8f3f2f", "#e4b64f"],
    ["#433878", "#b75d69", "#f4d35e"]
  ];
  const score = [...(artist.name || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[score % palettes.length];
}

function initialsFor(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function escapeSvg(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prioritizedLinks(artist) {
  const priority = supportPriorityForLinks(artist.links || []);
  return showExplorerLinks(artist.links || []).sort((a, b) => {
    const aDisplayRank = displayPriorityRank(a);
    const bDisplayRank = displayPriorityRank(b);
    const aRank = priority.includes(a.type) ? priority.indexOf(a.type) : priority.length;
    const bRank = priority.includes(b.type) ? priority.indexOf(b.type) : priority.length;
    return aDisplayRank - bDisplayRank || aRank - bRank || labelForType(a.type).localeCompare(labelForType(b.type)) || confidenceRank(b.confidence) - confidenceRank(a.confidence);
  });
}

function showExplorerLinks(links) {
  return [...links].filter((link) => displayableLink(link) && link.displayPriority === "primary").slice(0, 6);
}

function displayableLink(link) {
  return link.confidence !== "rejected" && link.display !== false;
}

function displayPriorityRank(link) {
  return link.displayPriority === "primary" ? 0 : 1;
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

function labelForType(type = "") {
  const labels = {
    appleMusic: "Apple Music",
    amazonMusic: "Amazon Music",
    bandcamp: "Bandcamp",
    deezer: "Deezer",
    discogs: "Discogs",
    discogsAlias: "Discogs Alias",
    discogsArtist: "Discogs Artist",
    discogsLegalName: "Discogs Legal Name",
    facebook: "Facebook",
    instagram: "Instagram",
    linktree: "Linktree",
    musicbrainz: "MusicBrainz",
    official: "Official",
    qobuz: "Qobuz",
    search: "Search",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    tidal: "Tidal",
    tiktok: "TikTok",
    twitter: "X/Twitter",
    wikidata: "Wikidata",
    wikipedia: "Wikipedia",
    youtube: "YouTube",
    youtubeMusic: "YouTube Music"
  };
  return labels[type] || type || "Link";
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function venueIdFor(event) {
  const anchor = (event.venueHref || "").match(/club\.html#([^/?#]+)/i)?.[1];
  return anchor ? slugify(anchor) : slugify(event.venue || "unknown-venue");
}

function render() {
  const list = visibleEvents();
  updateSummary(list);
  renderVenueMap(list);
  eventList.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No shows match these filters yet.";
    eventList.append(empty);
    return;
  }

  list.forEach((event) => {
    const venue = enrichVenue(event);
    const node = eventTemplate.content.firstElementChild.cloneNode(true);
    const topArtist = enrichArtist(event.artists[0] || { name: event.venue });
    const eventImage = node.querySelector(".event-image");
    eventImage.src = imageForEvent(event);
    eventImage.alt = `${topArtist.name || event.venue} image placeholder`;
    node.querySelector(".event-date").dateTime = event.date;
    node.querySelector(".event-date").textContent = formatDate(event.date);
    const venuePlace = [venue.city, venue.region].filter(Boolean).join(", ");
    const venueName = venue.displayName || venue.name || event.venue;
    const venueLink = document.createElement("a");
    venueLink.href = `venue.html?id=${encodeURIComponent(venue.id || event.venueId || venueIdFor(event))}&from=${encodeURIComponent("index.html")}`;
    venueLink.textContent = venuePlace ? `${venueName}, ${venuePlace}` : venueName;
    node.querySelector(".event-venue").replaceChildren(venueLink);
    node.querySelector(".event-detail").textContent = event.details;
    renderVenueLinks(venue, node.querySelector(".venue-links"));

    const artistList = node.querySelector(".artist-list");
    event.artists.forEach((artist) => artistList.append(renderArtist(artist)));
    eventList.append(node);
  });
}

function renderVenueMap(list) {
  if (!venueMap || !venueMapSvg) return;
  const venues = uniqueVenuesWithGeo(list);
  venueMap.hidden = venues.length === 0;
  if (venueMapCount) venueMapCount.textContent = `${venues.length} mapped venue${venues.length === 1 ? "" : "s"}`;
  venueMapSvg.replaceChildren();
  if (!venues.length) return;

  const bounds = boundsForVenues(venues);
  venueMapSvg.append(mapBackground());
  venues.forEach((venue) => {
    const point = projectGeo(venue.geo, bounds);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "venue-map-point");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", Math.max(5, Math.min(12, 4 + venue.showCount)));
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "button");
    circle.setAttribute("aria-label", `Show ${displayNameForVenue(venue)} details`);
    circle.dataset.venueId = venue.id;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${displayNameForVenue(venue)} (${venue.showCount} show${venue.showCount === 1 ? "" : "s"})`;
    circle.append(title);
    venueMapSvg.append(circle);
  });
}

function uniqueVenuesWithGeo(list) {
  const byId = new Map();
  list.forEach((event) => {
    const venue = enrichVenue(event);
    if (!venue.id || !validGeo(venue.geo)) return;
    const current = byId.get(venue.id) || { ...venue, showCount: 0 };
    current.showCount += 1;
    byId.set(venue.id, current);
  });
  return [...byId.values()];
}

function validGeo(geo) {
  return Number.isFinite(geo?.latitude) && Number.isFinite(geo?.longitude);
}

function boundsForVenues(venues) {
  const lats = venues.map((venue) => venue.geo.latitude);
  const lngs = venues.map((venue) => venue.geo.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPad = Math.max(0.08, (maxLat - minLat) * 0.16);
  const lngPad = Math.max(0.08, (maxLng - minLng) * 0.16);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad
  };
}

function projectGeo(geo, bounds) {
  const x = ((geo.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 900 + 50;
  const y = 580 - (((geo.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * 500 + 40);
  return { x, y };
}

function mapBackground() {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "venue-map-bg");
  [["San Francisco", 290, 245], ["East Bay", 570, 210], ["South Bay", 610, 430], ["Coast", 190, 360]].forEach(([label, x, y]) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.textContent = label;
    group.append(text);
  });
  return group;
}

function displayNameForVenue(venue) {
  return venue.displayName || venue.name || "Venue";
}

function openVenueModal(venueId) {
  const venue = venueStore[venueId];
  if (!venueModal || !venue) return;
  const title = displayNameForVenue(venue);
  venueModalTitle.textContent = title;
  venueModalMeta.textContent = [
    [venue.city, venue.region].filter(Boolean).join(", "),
    venue.venueType,
    venue.agePolicy && venue.agePolicy !== "unknown" ? venue.agePolicy : "",
    venue.summary
  ].filter(Boolean).join(" | ");
  venueModalLinks.replaceChildren();
  showExplorerLinks(venue.links || []).forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label || labelForType(link.type);
    venueModalLinks.append(anchor);
  });
  venueModalProfile.href = `venue.html?id=${encodeURIComponent(venue.id)}&from=${encodeURIComponent("index.html")}`;
  if (typeof venueModal.showModal === "function") {
    venueModal.showModal();
  } else {
    venueModal.setAttribute("open", "");
  }
}

function closeVenueModal() {
  if (!venueModal) return;
  if (typeof venueModal.close === "function") venueModal.close();
  else venueModal.removeAttribute("open");
}

venueMapSvg?.addEventListener("click", (event) => {
  const point = event.target.closest?.(".venue-map-point");
  if (point?.dataset.venueId) openVenueModal(point.dataset.venueId);
});

venueMapSvg?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const point = event.target.closest?.(".venue-map-point");
  if (!point?.dataset.venueId) return;
  event.preventDefault();
  openVenueModal(point.dataset.venueId);
});

venueModalClose?.addEventListener("click", closeVenueModal);
venueModal?.addEventListener("click", (event) => {
  if (event.target === venueModal) closeVenueModal();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    render();
  });
});

render();
