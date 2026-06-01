const sourceEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const events = sourceEvents.sort((a, b) => {
  return a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue);
});
const artistStore = window.SHOW_EXPLORER_ARTISTS?.artists || {};
const venueStore = window.SHOW_EXPLORER_VENUES?.venues || {};

const state = {
  query: "",
  filter: "default",
  fromDate: todayString(),
  toDate: ""
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
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

const confidenceLabels = {
  verified: "verified",
  likely: "likely",
  review: "review"
};

const eventTypeLabels = {
  comedy: "Comedy",
  coverBand: "Cover band",
  book: "Book event",
  chess: "Chess",
  dance: "Dance",
  film: "Film",
  game: "Games",
  jam: "Jam",
  karaoke: "Karaoke",
  openMic: "Open mic",
  poetry: "Poetry",
  storytelling: "Storytelling",
  themeNight: "Theme night",
  trivia: "Trivia"
};

const genericEventImages = {
  karaoke: {
    url: "https://images.unsplash.com/photo-1741594412133-ffd6530482ad?auto=format&fit=crop&w=960&q=72",
    alt: "People singing karaoke together"
  },
  openMic: {
    url: "https://images.unsplash.com/photo-1561264819-ec6538dc260e?auto=format&fit=crop&w=960&q=72",
    alt: "Microphone on a live stage"
  },
  jam: {
    url: "https://images.unsplash.com/photo-1561264819-ec6538dc260e?auto=format&fit=crop&w=960&q=72",
    alt: "Microphone on a live stage"
  },
  coverBand: {
    url: "https://images.unsplash.com/photo-1561264819-ec6538dc260e?auto=format&fit=crop&w=960&q=72",
    alt: "Microphone on a live stage"
  },
  trivia: {
    url: "https://images.unsplash.com/photo-1558210598-89ba75b1724e?auto=format&fit=crop&w=960&q=72",
    alt: "People gathered in a pub"
  },
  game: {
    url: "https://images.unsplash.com/photo-1558210598-89ba75b1724e?auto=format&fit=crop&w=960&q=72",
    alt: "People gathered in a pub"
  }
};

function todayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
    event.title,
    event.details,
    ...(event.eventTypes || []).map(labelForEventType),
    ...(event.themes || []),
    ...(event.sources || []).map((source) => source.name),
    ...event.artists.map(enrichArtist).flatMap((artist) => [
      artist.name,
      artist.locality,
      ...(artist.genres || artist.tags || [])
    ])
  ].join(" ").toLowerCase();
}

function matchesFilter(event) {
  if (state.filter === "default") return isDefaultShow(event);
  if (state.filter === "all") return true;
  if (state.filter === "tonight") return event.date === todayString();
  if (state.filter === "allAges") return /\ba\/a\b|all ages/i.test(event.details);
  if (state.filter === "karaoke") return hasEventType(event, "karaoke");
  if (state.filter === "trivia") return hasEventType(event, "trivia");
  if (state.filter === "openMic") return hasEventType(event, "openMic");
  if (state.filter === "poetry") return hasEventType(event, "poetry");
  if (state.filter === "game") return hasEventType(event, "game") || hasEventType(event, "chess");
  if (state.filter === "local") return event.artists.map(enrichArtist).some((artist) => /bay area|local|california/i.test(artist.locality));
  if (state.filter === "needsReview") return event.artists.map(enrichArtist).some((artist) => artist.confidence === "review");
  return true;
}

function hasEventType(event, type) {
  return (event.eventTypes || []).includes(type);
}

function isDefaultShow(event) {
  const eventTypes = event.eventTypes || [];
  const hasArtist = (event.artists || []).length > 0;
  const excludedNonMusicTypes = new Set(["book", "chess", "comedy", "film", "game", "poetry", "storytelling", "trivia"]);
  const allowedMusicTypes = new Set(["coverBand", "dance", "jam", "karaoke", "openMic", "themeNight"]);
  if (eventTypes.some((type) => excludedNonMusicTypes.has(type))) return false;
  if (hasArtist) return true;
  return eventTypes.some((type) => allowedMusicTypes.has(type));
}

function visibleEvents() {
  const query = state.query.trim().toLowerCase();
  return events.filter((event) => {
    const queryMatch = !query || textForEvent(event).includes(query);
    return queryMatch && matchesDateRange(event) && matchesFilter(event);
  });
}

function matchesDateRange(event) {
  if (state.fromDate && event.date < state.fromDate) return false;
  if (state.toDate && event.date > state.toDate) return false;
  return true;
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

function renderEventTaxonomy(event, container) {
  container.replaceChildren();
  const chips = [
    ...(event.eventTypes || []).map((type) => ({ kind: "type", value: type, label: labelForEventType(type) })),
    ...(event.themes || []).map((theme) => ({ kind: "theme", value: theme, label: `Theme: ${theme}` }))
  ];
  chips.forEach((chip) => {
    const button = document.createElement("button");
    button.className = "meta-chip";
    button.type = "button";
    button.textContent = chip.label;
    button.addEventListener("click", () => {
      state.query = chip.value;
      searchInput.value = chip.value;
      render();
    });
    container.append(button);
  });
}

function renderSourceLinks(event, container) {
  container.replaceChildren();
  const sources = event.sources || [event.source].filter(Boolean);
  sources.forEach((source) => {
    if (!source?.url) return;
    const anchor = document.createElement("a");
    anchor.href = source.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = source.name || "Source";
    container.append(anchor);
  });
}

function renderEventListing(event) {
  const node = document.createElement("article");
  node.className = "artist-card event-card";
  const title = document.createElement("h2");
  title.className = "artist-name";
  title.textContent = event.title || event.details || "Event listing";
  const meta = document.createElement("p");
  meta.className = "artist-note";
  meta.textContent = [labelForEventTypes(event), event.details].filter(Boolean).join(" | ");
  node.append(title, meta);
  return node;
}

function imageForEvent(event) {
  const genericImage = genericImageForEvent(event);
  if (genericImage) return genericImage.url;

  const topArtist = enrichArtist(event.artists[0] || { name: event.title || event.venue, tags: event.eventTypes || event.themes || [] });
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

function genericImageForEvent(event) {
  if ((event.artists || []).length) return null;
  const eventTypes = event.eventTypes || [];
  const preferredType = eventTypes.find((type) => genericEventImages[type]);
  return preferredType ? genericEventImages[preferredType] : null;
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
  if (/karaoke|trivia|open mic|comedy/.test(text)) return ["#385d87", "#168b83", "#f4d35e"];
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

function labelForEventType(type = "") {
  return eventTypeLabels[type] || type || "Event";
}

function labelForEventTypes(event) {
  return (event.eventTypes || []).map(labelForEventType).join(" / ");
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
    const genericImage = genericImageForEvent(event);
    const eventImage = node.querySelector(".event-image");
    eventImage.src = imageForEvent(event);
    eventImage.alt = genericImage?.alt || `${topArtist.name || event.venue} event image`;
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
    renderEventTaxonomy(event, node.querySelector(".event-taxonomy"));
    renderSourceLinks(event, node.querySelector(".source-links"));

    const artistList = node.querySelector(".artist-list");
    if (event.artists.length) {
      event.artists.forEach((artist) => artistList.append(renderArtist(artist)));
    } else {
      artistList.append(renderEventListing(event));
    }
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
  venueMapSvg.append(mapBackground(bounds));
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

function mapBackground(bounds) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "venue-map-bg");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", "venue-map-tint");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", "1000");
  rect.setAttribute("height", "620");
  group.append(rect);

  latitudeTicks(bounds).forEach((lat) => {
    const point = projectGeo({ latitude: lat, longitude: bounds.minLng }, bounds);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "venue-map-grid venue-map-latitude");
    line.setAttribute("x1", "48");
    line.setAttribute("x2", "950");
    line.setAttribute("y1", point.y);
    line.setAttribute("y2", point.y);
    group.append(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "venue-map-coordinate");
    label.setAttribute("x", "62");
    label.setAttribute("y", point.y - 7);
    label.textContent = `${lat.toFixed(2)}°N`;
    group.append(label);
  });

  longitudeTicks(bounds).forEach((lng) => {
    const point = projectGeo({ latitude: bounds.minLat, longitude: lng }, bounds);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "venue-map-grid venue-map-longitude");
    line.setAttribute("x1", point.x);
    line.setAttribute("x2", point.x);
    line.setAttribute("y1", "40");
    line.setAttribute("y2", "580");
    group.append(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "venue-map-coordinate");
    label.setAttribute("x", point.x + 7);
    label.setAttribute("y", "566");
    label.textContent = `${Math.abs(lng).toFixed(2)}°W`;
    group.append(label);
  });

  const coast = document.createElementNS("http://www.w3.org/2000/svg", "path");
  coast.setAttribute("class", "venue-map-coast");
  coast.setAttribute("d", "M74 92 C122 176 92 244 144 318 C198 394 174 472 236 574");
  group.append(coast);

  [["San Francisco", 290, 245], ["East Bay", 570, 210], ["South Bay", 610, 430], ["Coast", 190, 360]].forEach(([label, x, y]) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "venue-map-region");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.textContent = label;
    group.append(text);
  });
  return group;
}

function latitudeTicks(bounds) {
  return coordinateTicks(bounds.minLat, bounds.maxLat, 0.25);
}

function longitudeTicks(bounds) {
  return coordinateTicks(bounds.minLng, bounds.maxLng, 0.25);
}

function coordinateTicks(min, max, step) {
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }
  return ticks;
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

fromDateInput.value = state.fromDate;
fromDateInput.addEventListener("input", (event) => {
  state.fromDate = event.target.value;
  render();
});

toDateInput.addEventListener("input", (event) => {
  state.toDate = event.target.value;
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
