const sourceEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const events = sourceEvents.sort((a, b) => {
  return a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue);
});
const artistStore = window.SHOW_EXPLORER_ARTISTS?.artists || {};
const venueStore = window.SHOW_EXPLORER_VENUES?.venues || {};
const eventTextCache = new WeakMap();
const eventImageCache = new WeakMap();

function initialMapStyle() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const state = {
  query: "",
  filters: [],
  source: "all",
  venue: "all",
  city: "all",
  sort: "date",
  mapStyle: initialMapStyle(),
  fromDate: todayString(),
  toDate: ""
};

const eventList = document.querySelector("#eventList");
const venueMap = document.querySelector("#venueMap");
const venueMapCanvas = document.querySelector("#venueMapCanvas");
const venueMapStatus = document.querySelector("#venueMapStatus");
const venueMapCount = document.querySelector("#venueMapCount");
const venueModal = document.querySelector("#venueModal");
const venueModalTitle = document.querySelector("#venueModalTitle");
const venueModalMeta = document.querySelector("#venueModalMeta");
const venueModalLinks = document.querySelector("#venueModalLinks");
const venueModalProfile = document.querySelector("#venueModalProfile");
const venueModalClose = document.querySelector("#venueModalClose");
const eventTemplate = document.querySelector("#eventTemplate");
const artistTemplate = document.querySelector("#artistTemplate");
const showControls = document.querySelector("#showControls");
const searchInput = document.querySelector("#searchInput");
const stickySearchInput = document.querySelector("#stickySearchInput");
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const venueFilterInput = document.querySelector("#venueFilterInput");
const cityFilterInput = document.querySelector("#cityFilterInput");
const sortInput = document.querySelector("#sortInput");
const searchCustomization = document.querySelector(".search-customization");
const filterPanelButton = document.querySelector("#filterPanelButton");
const openMapButton = document.querySelector("#openMapButton");
const stickyToolsMenu = document.querySelector(".sticky-tools-menu");
const stickyToolsMenuButton = document.querySelector("#stickyToolsMenuButton");
const stickyToolsPopover = document.querySelector("#stickyToolsPopover");
const stickyMenuFiltersButton = document.querySelector("#stickyMenuFiltersButton");
const stickyMenuMapButton = document.querySelector("#stickyMenuMapButton");
const jumpToFiltersButton = document.querySelector("#jumpToFiltersButton");
const returnToListingsButton = document.querySelector("#returnToListingsButton");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const mapStyleButtons = [...document.querySelectorAll("[data-map-style]")];

let mapLibreMap;
let mapLibrePopup;
let mapLibreMarkers = [];
let venueMapRenderToken = 0;
let eventRenderToken = 0;
let eventScrollObserver = null;
let eventScrollFallbackHandler = null;
let lastListingScrollY = 0;
let keepFiltersOpenUntil = 0;
let venueMapRequested = false;

const initialEventBatchSize = 18;
const eventScrollBatchSize = 24;
const filterKeys = new Set(["picks", "allAges", "local"]);
const cartoMapStyles = {
  light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
};
const cartoMapStyleCache = new Map();

const eventTypeLabels = {
  coverBand: "Cover band",
  dance: "Dance",
  jam: "Jam",
  themeNight: "Theme night"
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
  if (eventTextCache.has(event)) return eventTextCache.get(event);
  const text = [
    event.date,
    event.venue,
    enrichVenue(event).city,
    enrichVenue(event).region,
    displayNameForEvent(event),
    event.title,
    event.details,
    ...sourceNamesForEvent(event),
    ...(event.eventTypes || []).map(labelForEventType),
    ...(event.themes || []),
    ...(event.sources || []).map((source) => source.name),
    ...(isArtistShow(event) ? event.artists : []).map(enrichArtist).flatMap((artist) => [
      artist.name,
      artist.displayName,
      artist.locality,
      ...(artist.genres || artist.tags || [])
    ])
  ].join(" ").toLowerCase();
  eventTextCache.set(event, text);
  return text;
}

function matchesFilter(event) {
  return state.filters.every((filter) => matchesNamedFilter(event, filter));
}

function matchesNamedFilter(event, filter) {
  if (filter === "picks") return isMikesPick(event);
  if (filter === "allAges") return /\ba\/a\b|all ages/i.test(event.details);
  if (filter === "local") return isArtistShow(event) && event.artists.map(enrichArtist).some((artist) => /bay area|local|california/i.test(artist.locality));
  return true;
}

function isMikesPick(event) {
  return Boolean(
    event.featured
    || event.mikesPick
    || event.mikePick
    || event.mikesPicks
    || event.settings?.featured
    || event.settings?.mikesPick
    || event.review?.featured
  );
}

function matchesSource(event) {
  if (state.source === "all") return true;
  return sourceNamesForEvent(event).some((name) => slugify(name) === state.source);
}

function sourceNamesForEvent(event) {
  const sources = [...(event.sources || []), event.source].filter(Boolean);
  return [...new Set(sources.map(sourceNameForSource).filter(Boolean))];
}

function sourceNameForSource(source) {
  const name = String(source?.name || "").trim();
  if (name && name.toLowerCase() !== "source") return name;
  const url = String(source?.url || "").toLowerCase();
  if (url.includes("kalx.berkeley.edu")) return "KALX";
  if (url.includes("jon.luini.com") || url.includes("thelist")) return "The List";
  return name || "Source";
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function isArtistShow(event) {
  return showTypeForEvent(event) === "artist";
}

function baseVisibleEvents() {
  const query = state.query.trim().toLowerCase();
  return events.filter((event) => {
    const queryMatch = !query || textForEvent(event).includes(query);
    return isArtistShow(event) && queryMatch && matchesDateRange(event) && matchesFilter(event) && matchesSource(event);
  });
}

function sortEventsForDisplay(list) {
  return [...list].sort(compareEventsForDisplay);
}

function matchesDateRange(event) {
  if (state.fromDate && event.date < state.fromDate) return false;
  if (state.toDate && event.date > state.toDate) return false;
  return true;
}

function matchesVenue(event) {
  if (state.venue === "all") return true;
  return venueKey(displayNameForVenue(enrichVenue(event)) || event.venue) === state.venue;
}

function matchesCity(event) {
  if (state.city === "all") return true;
  return venueKey(enrichVenue(event).city || event.city || "") === state.city;
}

function compareEventsForDisplay(a, b) {
  if (state.sort === "venue") {
    return displayNameForVenue(enrichVenue(a)).localeCompare(displayNameForVenue(enrichVenue(b)))
      || a.date.localeCompare(b.date)
      || displayNameForEvent(a).localeCompare(displayNameForEvent(b));
  }
  if (state.sort === "city") {
    return (enrichVenue(a).city || "").localeCompare(enrichVenue(b).city || "")
      || displayNameForVenue(enrichVenue(a)).localeCompare(displayNameForVenue(enrichVenue(b)))
      || a.date.localeCompare(b.date);
  }
  if (state.sort === "source") {
    return sourceNamesForEvent(a).join(", ").localeCompare(sourceNamesForEvent(b).join(", "))
      || a.date.localeCompare(b.date)
      || displayNameForVenue(enrichVenue(a)).localeCompare(displayNameForVenue(enrichVenue(b)));
  }
  if (state.sort === "title") {
    return displayNameForEvent(a).localeCompare(displayNameForEvent(b))
      || a.date.localeCompare(b.date)
      || displayNameForVenue(enrichVenue(a)).localeCompare(displayNameForVenue(enrichVenue(b)));
  }
  return a.date.localeCompare(b.date)
    || displayNameForVenue(enrichVenue(a)).localeCompare(displayNameForVenue(enrichVenue(b)))
    || displayNameForEvent(a).localeCompare(displayNameForEvent(b));
}

function updateSummary(list) {
  const artists = list.flatMap((event) => isArtistShow(event) ? event.artists.map(enrichArtist) : []);
  document.querySelector("#eventCount").textContent = list.length;
  document.querySelector("#artistCount").textContent = artists.length;
}

function renderAdvancedFilterOptions(venueEvents, cityEvents) {
  renderEventVenueOptions(venueEvents);
  renderCityOptions(cityEvents);
}

function renderEventVenueOptions(list) {
  const current = state.venue;
  const venues = new Map();
  list.forEach((event) => {
    const venue = enrichVenue(event);
    const name = displayNameForVenue(venue) || event.venue;
    if (name) venues.set(venueKey(name), name);
  });
  venueFilterInput.replaceChildren(new Option("All venues", "all"));
  [...venues.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([key, name]) => venueFilterInput.append(new Option(name, key)));
  state.venue = current === "all" || venues.has(current) ? current : "all";
  venueFilterInput.value = state.venue;
}

function renderCityOptions(list) {
  const current = state.city;
  const cities = new Map();
  list.forEach((event) => {
    const city = enrichVenue(event).city || event.city || "";
    if (city) cities.set(venueKey(city), city);
  });
  cityFilterInput.replaceChildren(new Option("All cities", "all"));
  [...cities.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([key, name]) => cityFilterInput.append(new Option(name, key)));
  state.city = current === "all" || cities.has(current) ? current : "all";
  cityFilterInput.value = state.city;
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
  artistLink.href = `artist.html?id=${encodeURIComponent(displayArtist.id || slugify(displayArtist.name))}&from=${encodeURIComponent("show-explorer.html")}`;
  artistLink.textContent = displayNameForArtist(displayArtist);
  artistName.append(artistLink);
  const tags = (displayArtist.genres || displayArtist.tags || []).filter((tag) => tag && tag !== "unknown").slice(0, 3).join(" / ");
  const tagNode = node.querySelector(".artist-tags");
  tagNode.textContent = tags;
  tagNode.hidden = !tags;
  const noteNode = node.querySelector(".artist-note");
  noteNode.textContent = displayArtist.summary || "";
  noteNode.hidden = !displayArtist.summary;

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

function renderEventLinks(event, venue, container) {
  container.replaceChildren();
  const chips = [
    ...(event.eventTypes || []).map((type) => ({ kind: "type", value: type, label: labelForEventType(type) })),
    ...(event.themes || []).map((theme) => ({ kind: "theme", value: theme, label: theme }))
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

  if (event.infoUrl) {
    const anchor = document.createElement("a");
    anchor.href = event.infoUrl;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = "Show Info";
    container.append(anchor);
  }

  const sources = [...(event.sources || []), event.source].filter(Boolean);
  const seen = new Set();
  sources.forEach((source) => {
    if (!source?.url) return;
    const name = sourceNameForSource(source);
    const key = `${name}|${source.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    const anchor = document.createElement("a");
    anchor.href = source.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = name;
    container.append(anchor);
  });

  renderVenueLinks(venue, container);
}

function renderEventListing(event) {
  const node = document.createElement("article");
  node.className = "artist-card event-card";
  const title = document.createElement("h2");
  title.className = "artist-name";
  title.textContent = displayNameForEvent(event);
  const meta = document.createElement("p");
  meta.className = "artist-note";
  meta.textContent = [labelForEventTypes(event), event.eventDescription].filter(Boolean).join(" | ");
  meta.hidden = !meta.textContent;
  node.append(title, meta);
  return node;
}

function imageForEvent(event) {
  if (eventImageCache.has(event)) return eventImageCache.get(event).url;
  const image = imageSelectionForEvent(event);
  eventImageCache.set(event, image);
  return image.url;
}

function imageSelectionForEvent(event) {
  const topArtist = enrichArtist(event.artists[0] || { name: displayNameForEvent(event), tags: event.eventTypes || event.themes || [] });
  const imageArtist = imageArtistForEvent(event) || topArtist;
  const venue = enrichVenue(event);
  const selectedImage = preferredImageCandidate([
    { url: event.imageUrl, priority: 0, kind: "show", label: "" },
    { url: imageArtist.imageUrl, priority: 1, kind: "artist", label: displayNameForArtist(imageArtist) },
    { url: imageArtist.spotifyImageUrl, priority: 2, kind: "artist", label: displayNameForArtist(imageArtist) },
    { url: venue.imageUrl, priority: 3, kind: "venue", label: displayNameForVenue(venue) || event.venue }
  ]);
  if (selectedImage) {
    return selectedImage;
  }

  const palette = paletteForArtist(topArtist);
  const title = displayNameForArtist(topArtist) || event.venue || "Bay Area Show";
  const subtitleParts = [
    ...(topArtist.genres || topArtist.tags || []).slice(0, 2),
    topArtist.locality
  ].filter(Boolean);
  const titleLines = wrapPosterText(title, 15, 2);
  const subtitle = escapeSvg(truncateText(subtitleParts.join(" / ") || "Live music", 34));
  const initials = escapeSvg(initialsFor(displayNameForArtist(topArtist) || event.venue || "BA"));
  const titleMarkup = titleLines.map((line, index) => {
    const y = 162 + index * 42;
    const fitAttributes = line.length > 16 ? ` textLength="376" lengthAdjust="spacingAndGlyphs"` : "";
    return `<text x="48" y="${y}" fill="#fffdfa" font-family="Inter, Arial, sans-serif" font-size="36" font-weight="850"${fitAttributes}>${escapeSvg(line)}</text>`;
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
      <text x="48" y="48" fill="#fffdfa" opacity=".78" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800">TOP BILL</text>
      ${titleMarkup}
      <text x="50" y="248" fill="#fffdfa" opacity=".84" font-family="Inter, Arial, sans-serif" font-size="19" font-weight="700">${subtitle}</text>
      <text x="388" y="320" text-anchor="middle" fill="#fffdfa" opacity=".28" font-family="Inter, Arial, sans-serif" font-size="90" font-weight="900">${initials}</text>
    </svg>`;
  const image = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return { url: image, kind: "generated", label: "" };
}

function imageSourceForEvent(event) {
  const topArtist = enrichArtist(event.artists[0] || { name: displayNameForEvent(event), tags: event.eventTypes || event.themes || [] });
  const imageArtist = imageArtistForEvent(event) || topArtist;
  const venue = enrichVenue(event);
  const image = preferredImageCandidate([
    { url: event.imageUrl, source: event.imageSource, priority: 0 },
    { url: imageArtist.imageUrl, source: imageArtist.imageSource, priority: 1 },
    { url: imageArtist.spotifyImageUrl, source: "Spotify", priority: 2 },
    { url: venue.imageUrl, source: venue.imageSource, priority: 3 }
  ]);
  if (image) return imageSourceLabel(image.source, image.url);

  return "";
}

function imageArtistForEvent(event) {
  return (event.artists || [])
    .map(enrichArtist)
    .filter((artist) => artist.imageUrl || artist.spotifyImageUrl)
    .sort((a, b) => artistImageRank(a) - artistImageRank(b))[0] || null;
}

function artistImageRank(artist) {
  return preferredImageCandidate([
    { url: artist.imageUrl, priority: 0 },
    { url: artist.spotifyImageUrl, priority: 1 }
  ])?.priority ?? 99;
}

function preferredImageUrl(candidates) {
  return preferredImageCandidate(candidates)?.url || "";
}

function preferredImageCandidate(candidates) {
  return candidates
    .filter((candidate) => candidate.url)
    .sort((a, b) => imageUrlRank(a.url) - imageUrlRank(b.url) || a.priority - b.priority)[0] || null;
}

function imageUrlRank(url = "") {
  return isUnsplashImageUrl(url) ? 1 : 0;
}

function isUnsplashImageUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").endsWith("unsplash.com");
  } catch {
    return false;
  }
}

function imageSourceLabel(source = "", url = "") {
  const cleaned = String(source || "").replace(/^source\s*:\s*/i, "").trim().replace(/\/+$/g, "");
  const fallback = domainForUrl(url);
  const value = cleaned || fallback;
  return value ? `Source: ${value}` : "";
}

function domainForUrl(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    if (host.endsWith("unsplash.com")) return "Unsplash";
    return host;
  } catch {
    return "";
  }
}

function wrapPosterText(text, maxLineLength, maxLines) {
  const words = String(text)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => splitLongPosterWord(word, maxLineLength));
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

function splitLongPosterWord(word, maxLineLength) {
  if (word.length <= maxLineLength) return [word];
  const chunks = [];
  for (let index = 0; index < word.length; index += maxLineLength) {
    const chunk = word.slice(index, index + maxLineLength);
    chunks.push(index + maxLineLength < word.length ? `${chunk}-` : chunk);
  }
  return chunks;
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

function labelForEventType(type = "") {
  return eventTypeLabels[type] || type || "Event";
}

function labelForEventTypes(event) {
  return (event.eventTypes || []).map(labelForEventType).join(" / ");
}

function displayNameForArtist(artist = {}) {
  return artist.displayName || artist.name || "";
}

function displayNameForEvent(event = {}) {
  return event.displayName || event.title || (event.artists || []).map(displayNameForArtist).filter(Boolean).join(" / ") || event.details || "Event listing";
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

function venueKey(text) {
  return String(text || "")
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
  const renderToken = ++eventRenderToken;
  updateFilterButtons();
  const baseList = baseVisibleEvents();
  renderEventVenueOptions(baseList);
  const venueList = baseList.filter(matchesVenue);
  renderCityOptions(venueList);
  const list = sortEventsForDisplay(venueList.filter(matchesCity));
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

  renderEventCardsOnDemand(list, renderToken);
}

function focusLinkedEvent(attempt = 0) {
  const eventId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!eventId) return;
  const target = document.getElementById(eventId);
  if (!target && attempt < 10) {
    window.setTimeout(() => focusLinkedEvent(attempt + 1), 160);
    return;
  }
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  target.classList.add("linked-event");
  window.setTimeout(() => target.classList.remove("linked-event"), 1800);
}

function renderEventCardsOnDemand(list, renderToken) {
  disconnectEventScrollLoader();
  const linkedIndex = linkedEventIndex(list);
  const firstBatchSize = Math.min(list.length, Math.max(initialEventBatchSize, linkedIndex + 1));
  const sentinel = document.createElement("div");
  sentinel.className = "event-scroll-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  let rendered = 0;

  const loadNext = () => {
    if (renderToken !== eventRenderToken) return;
    const size = rendered === 0 ? firstBatchSize : eventScrollBatchSize;
    const next = Math.min(rendered + size, list.length);
    appendEventCardBatch(list, rendered, next);
    rendered = next;
    focusLinkedEvent();
    if (rendered >= list.length) {
      disconnectEventScrollLoader();
      sentinel.remove();
      return;
    }
    if (!sentinel.isConnected) eventList.append(sentinel);
  };

  loadNext();
  if (rendered >= list.length) return;

  if ("IntersectionObserver" in window) {
    eventScrollObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNext();
    }, { rootMargin: "720px 0px" });
    eventScrollObserver.observe(sentinel);
    return;
  }

  eventScrollFallbackHandler = () => {
    const rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 720) loadNext();
  };
  window.addEventListener("scroll", eventScrollFallbackHandler, { passive: true });
}

function disconnectEventScrollLoader() {
  eventScrollObserver?.disconnect();
  eventScrollObserver = null;
  if (eventScrollFallbackHandler) {
    window.removeEventListener("scroll", eventScrollFallbackHandler);
    eventScrollFallbackHandler = null;
  }
}

function linkedEventIndex(list) {
  const eventId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!eventId) return -1;
  return list.findIndex((event) => event.id === eventId);
}

function appendEventCardBatch(list, start, end) {
  const fragment = document.createDocumentFragment();
  const groupByDate = state.sort === "date";
  for (let index = start; index < end; index += 1) {
    const event = list[index];
    if (groupByDate && event.date !== list[index - 1]?.date) {
      fragment.append(createDateGroupHeader(event.date));
    }
    fragment.append(createEventCard(event, { showDate: !groupByDate }));
  }
  eventList.append(fragment);
}

function createDateGroupHeader(dateText) {
  const header = document.createElement("h2");
  header.className = "date-group-heading";
  header.textContent = formatDate(dateText);
  return header;
}

function createEventCard(event, options = {}) {
  const venue = enrichVenue(event);
  const node = eventTemplate.content.firstElementChild.cloneNode(true);
  node.id = event.id;
  node.dataset.eventId = event.id;
  const topArtist = enrichArtist(event.artists[0] || { name: event.venue });
  const eventImage = node.querySelector(".event-image");
  const imageSelection = imageSelectionForEvent(event);
  eventImageCache.set(event, imageSelection);
  eventImage.src = imageSelection.url;
  eventImage.alt = `${displayNameForArtist(topArtist) || event.venue} event image`;
  if (["artist", "venue"].includes(imageSelection.kind) && imageSelection.label) {
    const label = document.createElement("span");
    label.className = "image-record-label";
    label.textContent = imageSelection.label;
    node.querySelector(".event-image-wrap").append(label);
  }
  const imageSource = imageSourceForEvent(event);
  if (imageSource) {
    const credit = document.createElement("span");
    credit.className = "image-source-credit";
    credit.textContent = imageSource;
    node.querySelector(".event-image-wrap").append(credit);
  }
  if (isMikesPick(event)) {
    const badge = document.createElement("span");
    badge.className = "pick-badge";
    badge.textContent = "Mike's Pick";
    node.querySelector(".event-image-wrap").append(badge);
  }
  const dateNode = node.querySelector(".event-date");
  dateNode.dateTime = event.date;
  dateNode.textContent = formatDate(event.date);
  dateNode.hidden = !options.showDate;
  const venuePlace = [venue.city, venue.region].filter(Boolean).join(", ");
  const venueName = venue.displayName || venue.name || event.venue;
  const venueLink = document.createElement("a");
  venueLink.href = `venue.html?id=${encodeURIComponent(venue.id || event.venueId || venueIdFor(event))}&from=${encodeURIComponent("show-explorer.html")}`;
  venueLink.textContent = venuePlace ? `${venueName}, ${venuePlace}` : venueName;
  node.querySelector(".event-venue").replaceChildren(venueLink);
  node.querySelector(".event-detail").textContent = event.details;
  renderEventLinks(event, venue, node.querySelector(".event-links"));

  const artistList = node.querySelector(".artist-list");
  if (isArtistShow(event) && event.artists.length) {
    artistList.classList.toggle("single-artist", event.artists.length === 1);
    event.artists.forEach((artist) => artistList.append(renderArtist(artist)));
  } else {
    artistList.append(renderEventListing(event));
  }
  return node;
}

function updateFilterButtons() {
  filterButtons.forEach((button) => {
    const filter = button.dataset.filter;
    setPressed(button, state.filters.includes(filter));
  });
  mapStyleButtons.forEach((button) => {
    setPressed(button, button.dataset.mapStyle === state.mapStyle);
  });
}

function setPressed(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function setupVenueMapDisclosure() {
  if (!venueMap) return;
  venueMap.hidden = true;
  venueMap.removeAttribute("open");
  venueMap.addEventListener("toggle", () => {
    if (venueMap.open) return;
    venueMapRequested = false;
    venueMap.hidden = true;
  });
}

function setupStickyListingTools() {
  if (!eventList) return;
  let isActive = false;
  const setActive = (active) => {
    if (active === isActive) return;
    isActive = active;
    const now = Date.now();
    document.body.classList.toggle("listing-tools-active", active);
    if (active) {
      if (now > keepFiltersOpenUntil) {
        setFilterPanelOpen(false);
      }
    }
  };

  const sync = () => {
    const listTop = eventList.getBoundingClientRect().top;
    const controlsRect = showControls?.getBoundingClientRect();
    const controlsVisible = controlsRect && controlsRect.bottom > 0 && controlsRect.top < window.innerHeight;
    if (controlsVisible) setActive(false);
    else if (!isActive && listTop < window.innerHeight * 0.62) setActive(true);
    else if (isActive && listTop > window.innerHeight * 0.78) setActive(false);
  };

  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync);
  sync();
}

function jumpToFilters() {
  lastListingScrollY = window.scrollY;
  keepFiltersOpenUntil = Date.now() + 1600;
  returnToListingsButton.disabled = false;
  setFilterPanelOpen(true);
  showControls?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => setFilterPanelOpen(true), 320);
  window.setTimeout(() => searchInput?.focus({ preventScroll: true }), 260);
}

function returnToListings() {
  window.scrollTo({ top: lastListingScrollY || eventList.offsetTop, behavior: "smooth" });
}

function setStickyToolsMenuOpen(isOpen) {
  if (!stickyToolsMenuButton || !stickyToolsPopover) return;
  stickyToolsMenuButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  stickyToolsMenuButton.setAttribute("aria-label", isOpen ? "Close sticky tools menu" : "Open sticky tools menu");
  stickyToolsMenu?.classList.toggle("menu-open", isOpen);
  stickyToolsMenuButton.classList.remove("menu-toggle-activated");
  window.requestAnimationFrame(() => stickyToolsMenuButton.classList.add("menu-toggle-activated"));
  window.setTimeout(() => stickyToolsMenuButton.classList.remove("menu-toggle-activated"), 420);
  stickyToolsPopover.hidden = !isOpen;
}

function syncFilterPanelButton() {
  if (!filterPanelButton || !searchCustomization) return;
  filterPanelButton.setAttribute("aria-expanded", searchCustomization.open ? "true" : "false");
  filterPanelButton.classList.toggle("active", searchCustomization.open);
}

function setFilterPanelOpen(isOpen) {
  if (!searchCustomization) return;
  if (isOpen) searchCustomization.setAttribute("open", "");
  else searchCustomization.removeAttribute("open");
  syncFilterPanelButton();
}

function jumpToMap() {
  lastListingScrollY = window.scrollY;
  venueMapRequested = true;
  returnToListingsButton.disabled = false;
  setFilterPanelOpen(false);
  if (venueMap) venueMap.hidden = false;
  venueMap?.setAttribute("open", "");
  window.requestAnimationFrame(() => {
    venueMap?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.setTimeout(() => venueMap?.setAttribute("open", ""), 320);
}

function renderVenueMap(list) {
  if (!venueMap) return;
  const renderToken = ++venueMapRenderToken;
  const venues = uniqueVenuesWithGeo(list);
  venueMap.hidden = !venueMapRequested || venues.length === 0;
  if (venueMapCount) venueMapCount.textContent = venues.length;
  if (!venues.length) {
    if (venueMapCanvas) venueMapCanvas.hidden = true;
    if (venueMapStatus) venueMapStatus.hidden = true;
    clearMapLibreMarkers();
    return;
  }

  if (venueMapCanvas && window.maplibregl?.Map) {
    if (venueMapStatus) venueMapStatus.hidden = true;
    venueMapCanvas.hidden = false;
    renderMapLibreVenueMap(venues, renderToken);
    return;
  }

  if (venueMapCanvas) venueMapCanvas.hidden = true;
  clearMapLibreMarkers();
  showVenueMapStatus("Street map unavailable. MapLibre did not load.");
}

function showVenueMapStatus(message) {
  if (!venueMapStatus) return;
  venueMapStatus.textContent = message;
  venueMapStatus.hidden = false;
}

async function renderMapLibreVenueMap(venues, renderToken) {
  await waitForMapLayout(venueMapCanvas);
  if (renderToken !== venueMapRenderToken) return;

  if (!mapLibreMap) {
    const style = await loadCartoMapStyle();
    if (renderToken !== venueMapRenderToken) return;
    if (!style) return;
    try {
      mapLibreMap = new maplibregl.Map({
        container: venueMapCanvas,
        style,
        center: [-122.4194, 37.7749],
        zoom: 10,
        attributionControl: true
      });
    } catch (error) {
      venueMapCanvas.hidden = true;
      showVenueMapStatus(`Street map unavailable. ${mapLibreErrorMessage(error)}`);
      return;
    }
    mapLibreMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapLibrePopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "260px" });
    mapLibreMap.on("error", () => {
      if (mapLibreMap.loaded()) return;
      venueMapCanvas.hidden = true;
      showVenueMapStatus("Street map tiles could not load.");
    });
  }

  mapLibreMap.resize();
  clearMapLibreMarkers();
  venues.forEach((venue) => {
    const markerElement = document.createElement("button");
    markerElement.className = "venue-map-marker";
    markerElement.type = "button";
    markerElement.textContent = venue.showCount > 1 ? String(Math.min(venue.showCount, 9)) : "";
    markerElement.setAttribute("aria-label", `Show ${displayNameForVenue(venue)} details`);
    markerElement.addEventListener("click", () => {
      mapLibrePopup
        .setLngLat([venue.geo.longitude, venue.geo.latitude])
        .setHTML(venueMapPopupContent(venue))
        .addTo(mapLibreMap);
    });
    const marker = new maplibregl.Marker({ element: markerElement, anchor: "center" })
      .setLngLat([venue.geo.longitude, venue.geo.latitude])
      .addTo(mapLibreMap);
    mapLibreMarkers.push(marker);
  });

  fitMapLibreVenueBounds(venues);
}

function waitForMapLayout(mapElement) {
  const hasSize = () => mapElement.offsetWidth > 0 && mapElement.offsetHeight > 0;
  if (hasSize()) {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  return new Promise((resolve) => {
    if (typeof ResizeObserver !== "function") {
      setTimeout(resolve, 100);
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!hasSize()) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    observer.observe(mapElement);
  });
}

function fitMapLibreVenueBounds(venues) {
  if (!mapLibreMap || !venues.length) return;
  if (venues.length === 1) {
    mapLibreMap.jumpTo({
      center: [venues[0].geo.longitude, venues[0].geo.latitude],
      zoom: 13.5
    });
    return;
  }
  const bounds = venues.reduce((mapBounds, venue) => {
    return mapBounds.extend([venue.geo.longitude, venue.geo.latitude]);
  }, new maplibregl.LngLatBounds(
    [venues[0].geo.longitude, venues[0].geo.latitude],
    [venues[0].geo.longitude, venues[0].geo.latitude]
  ));
  mapLibreMap.fitBounds(bounds, { padding: 42, maxZoom: 14, duration: 0 });
}

function mapLibreErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  if (!message) return "Chrome could not initialize the map.";
  try {
    const parsed = JSON.parse(message);
    return parsed.message || parsed.statusMessage || message;
  } catch {
    return message;
  }
}

function cartoMapStyleUrl() {
  return cartoMapStyles[state.mapStyle] || cartoMapStyles.light;
}

async function loadCartoMapStyle() {
  const styleKey = state.mapStyle;
  if (cartoMapStyleCache.has(styleKey)) return cloneMapStyle(cartoMapStyleCache.get(styleKey));

  try {
    const response = await fetch(cartoMapStyleUrl());
    if (!response.ok) throw new Error(`CARTO style request failed (${response.status})`);
    const style = customizeCartoMapStyle(await response.json(), styleKey);
    cartoMapStyleCache.set(styleKey, style);
    return cloneMapStyle(style);
  } catch (error) {
    if (venueMapCanvas) venueMapCanvas.hidden = true;
    clearMapLibreMarkers();
    showVenueMapStatus(`Street map unavailable. ${mapLibreErrorMessage(error)}`);
    return null;
  }
}

function cloneMapStyle(style) {
  return JSON.parse(JSON.stringify(style));
}

function customizeCartoMapStyle(style, styleKey) {
  if (styleKey === "light") return style;
  return {
    ...style,
    layers: (style.layers || []).map((layer) => {
      if (!shouldHideNaturalMapLayer(layer)) return layer;
      return {
        ...layer,
        layout: {
          ...(layer.layout || {}),
          visibility: "none"
        }
      };
    })
  };
}

function shouldHideNaturalMapLayer(layer) {
  const layerId = String(layer?.id || "");
  return /^(landcover|park|wood|grass|cemetery|stadium|zoo|glacier)/i.test(layerId);
}

function clearMapLibreMarkers() {
  mapLibreMarkers.forEach((marker) => marker.remove());
  mapLibreMarkers = [];
  mapLibrePopup?.remove();
}

function venueMapPopupContent(venue) {
  const title = escapeHtml(displayNameForVenue(venue));
  const meta = escapeHtml([venue.city, venue.region].filter(Boolean).join(" / "));
  const count = `${venue.showCount} show${venue.showCount === 1 ? "" : "s"}`;
  const href = `venue.html?id=${encodeURIComponent(venue.id)}&from=${encodeURIComponent("show-explorer.html")}`;
  return `
    <div class="map-info-window">
      <strong>${title}</strong>
      ${meta ? `<span>${meta}</span>` : ""}
      <span>${count}</span>
      <a href="${href}">Venue Page</a>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  venueModalProfile.href = `venue.html?id=${encodeURIComponent(venue.id)}&from=${encodeURIComponent("show-explorer.html")}`;
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

venueModalClose?.addEventListener("click", closeVenueModal);
venueModal?.addEventListener("click", (event) => {
  if (event.target === venueModal) closeVenueModal();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  if (stickySearchInput) stickySearchInput.value = state.query;
  render();
});

stickySearchInput?.addEventListener("input", (event) => {
  state.query = event.target.value;
  searchInput.value = state.query;
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

venueFilterInput.addEventListener("change", (event) => {
  state.venue = event.target.value;
  render();
});

cityFilterInput.addEventListener("change", (event) => {
  state.city = event.target.value;
  render();
});

sortInput.value = state.sort;
sortInput.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyFilterSelection(button.dataset.filter);
    render();
  });
});

function applyFilterSelection(filter) {
  if (!filterKeys.has(filter)) return;
  if (state.filters.includes(filter)) {
    state.filters = state.filters.filter((item) => item !== filter);
  } else {
    state.filters = [...state.filters, filter];
  }
}

mapStyleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextStyle = button.dataset.mapStyle;
    if (!cartoMapStyles[nextStyle] || state.mapStyle === nextStyle) return;
    state.mapStyle = nextStyle;
    updateFilterButtons();
    if (!mapLibreMap) return;
    loadCartoMapStyle().then((style) => {
      if (!style || !mapLibreMap) return;
      mapLibreMap.setStyle(style);
      if (venueMapCanvas) venueMapCanvas.hidden = false;
      if (venueMapStatus) venueMapStatus.hidden = true;
      window.setTimeout(() => fitMapLibreVenueBounds(uniqueVenuesWithGeo(baseVisibleEvents())), 120);
    });
  });
});

returnToListingsButton?.addEventListener("click", returnToListings);
jumpToFiltersButton?.addEventListener("click", jumpToFilters);
filterPanelButton?.addEventListener("click", () => {
  setFilterPanelOpen(!searchCustomization?.open);
});
searchCustomization?.addEventListener("toggle", syncFilterPanelButton);
openMapButton?.addEventListener("click", jumpToMap);
stickyToolsMenuButton?.addEventListener("click", () => {
  setStickyToolsMenuOpen(stickyToolsMenuButton.getAttribute("aria-expanded") !== "true");
});
stickyMenuFiltersButton?.addEventListener("click", () => {
  setStickyToolsMenuOpen(false);
  jumpToFilters();
});
stickyMenuMapButton?.addEventListener("click", () => {
  setStickyToolsMenuOpen(false);
  jumpToMap();
});
document.addEventListener("click", (event) => {
  if (!stickyToolsMenu || stickyToolsMenu.contains(event.target)) return;
  setStickyToolsMenuOpen(false);
});

setupVenueMapDisclosure();
setupStickyListingTools();
render();
