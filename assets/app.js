const sourceEvents = [...(window.SHOW_EXPLORER_EVENTS || [])];
const events = sourceEvents.sort((a, b) => {
  return a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue);
});
const artistStore = window.SHOW_EXPLORER_ARTISTS?.artists || {};
const venueStore = window.SHOW_EXPLORER_VENUES?.venues || {};
const eventTextCache = new WeakMap();
const eventImageCache = new WeakMap();

const state = {
  query: "",
  filter: "music",
  customFilters: [],
  source: "all",
  venue: "all",
  city: "all",
  sort: "date",
  fromDate: todayString(),
  toDate: ""
};

const eventList = document.querySelector("#eventList");
const venueMap = document.querySelector("#venueMap");
const venueGoogleMap = document.querySelector("#venueGoogleMap");
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
const showControls = document.querySelector("#showControls");
const searchInput = document.querySelector("#searchInput");
const stickySearchInput = document.querySelector("#stickySearchInput");
const fromDateInput = document.querySelector("#fromDateInput");
const toDateInput = document.querySelector("#toDateInput");
const venueFilterInput = document.querySelector("#venueFilterInput");
const cityFilterInput = document.querySelector("#cityFilterInput");
const sortInput = document.querySelector("#sortInput");
const advancedFilters = document.querySelector(".advanced-filters");
const stickyFiltersButton = document.querySelector("#stickyFiltersButton");
const stickyMapButton = document.querySelector("#stickyMapButton");
const stickyToolsMenu = document.querySelector(".sticky-tools-menu");
const stickyToolsMenuButton = document.querySelector("#stickyToolsMenuButton");
const stickyToolsPopover = document.querySelector("#stickyToolsPopover");
const stickyMenuFiltersButton = document.querySelector("#stickyMenuFiltersButton");
const stickyMenuMapButton = document.querySelector("#stickyMenuMapButton");
const jumpToFiltersButton = document.querySelector("#jumpToFiltersButton");
const returnToListingsButton = document.querySelector("#returnToListingsButton");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const sourceFilterButtons = [...document.querySelectorAll("[data-source-filter]")];
const mobileMapQuery = window.matchMedia("(max-width: 820px)");

let googleMapsPromise;
let googleVenueMap;
let googleVenueInfoWindow;
let googleVenueMarkers = [];
let venueMapRenderToken = 0;
let eventRenderToken = 0;
let lastListingScrollY = 0;
let keepFiltersOpenUntil = 0;
let keepMapOpenUntil = 0;

const venueMapPlot = {
  left: 36,
  right: 964,
  top: 36,
  bottom: 584
};

const customFilterKeys = new Set(["picks", "music", "tonight", "allAges", "karaoke", "trivia", "openMic", "poetry", "game", "local"]);
const typeFilterKeys = new Set(["music", "karaoke", "trivia", "openMic", "poetry", "game", "local"]);
const modifierFilterKeys = new Set(["picks", "tonight", "allAges"]);

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
  if (state.filter === "custom") return matchesCustomFilters(event);
  if (state.filter === "all") return true;
  return matchesNamedFilter(event, state.filter);
}

function matchesCustomFilters(event) {
  const filters = state.customFilters.filter((filter) => customFilterKeys.has(filter));
  if (!filters.length) return true;
  const typeFilters = filters.filter((filter) => typeFilterKeys.has(filter));
  const modifierFilters = filters.filter((filter) => modifierFilterKeys.has(filter));
  const matchesType = !typeFilters.length || typeFilters.some((filter) => matchesNamedFilter(event, filter));
  const matchesModifiers = modifierFilters.every((filter) => matchesNamedFilter(event, filter));
  return matchesType && matchesModifiers;
}

function matchesNamedFilter(event, filter) {
  if (filter === "picks") return isMikesPick(event);
  if (filter === "music") return isDefaultShow(event);
  if (filter === "tonight") return event.date === todayString();
  if (filter === "allAges") return /\ba\/a\b|all ages/i.test(event.details);
  if (filter === "karaoke") return hasEventType(event, "karaoke");
  if (filter === "trivia") return hasEventType(event, "trivia");
  if (filter === "openMic") return hasEventType(event, "openMic");
  if (filter === "poetry") return hasEventType(event, "poetry");
  if (filter === "game") return hasEventType(event, "game") || hasEventType(event, "chess");
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
  if (url.includes("badslava.com")) return "BadSlava";
  if (url.includes("jon.luini.com") || url.includes("thelist")) return "The List";
  return name || "Source";
}

function hasEventType(event, type) {
  return (event.eventTypes || []).includes(type);
}

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function isArtistShow(event) {
  return showTypeForEvent(event) === "artist";
}

function isDefaultShow(event) {
  const eventTypes = event.eventTypes || [];
  const excludedNonMusicTypes = new Set(["book", "chess", "comedy", "film", "game", "karaoke", "openMic", "poetry", "storytelling", "themeNight", "trivia"]);
  const allowedMusicTypes = new Set(["coverBand", "jam"]);
  if (eventTypes.some((type) => excludedNonMusicTypes.has(type))) return false;
  if (isArtistShow(event)) return true;
  return eventTypes.some((type) => allowedMusicTypes.has(type));
}

function baseVisibleEvents() {
  const query = state.query.trim().toLowerCase();
  return events.filter((event) => {
    const queryMatch = !query || textForEvent(event).includes(query);
    return queryMatch && matchesDateRange(event) && matchesFilter(event) && matchesSource(event);
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
  artistLink.href = `artist.html?id=${encodeURIComponent(displayArtist.id || slugify(displayArtist.name))}&from=${encodeURIComponent("index.html")}`;
  artistLink.textContent = displayNameForArtist(displayArtist);
  artistName.append(artistLink);
  const tags = (displayArtist.genres || displayArtist.tags || []).filter((tag) => tag && tag !== "unknown").join(" / ");
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
}

function renderEventListing(event) {
  const node = document.createElement("article");
  node.className = "artist-card event-card";
  const title = document.createElement("h2");
  title.className = "artist-name";
  title.textContent = displayNameForEvent(event);
  const meta = document.createElement("p");
  meta.className = "artist-note";
  meta.textContent = [labelForEventTypes(event), event.details].filter(Boolean).join(" | ");
  node.append(title, meta);
  return node;
}

function imageForEvent(event) {
  if (eventImageCache.has(event)) return eventImageCache.get(event);
  if (event.imageUrl) {
    eventImageCache.set(event, event.imageUrl);
    return event.imageUrl;
  }
  const genericImage = genericImageForEvent(event);
  if (genericImage) {
    eventImageCache.set(event, genericImage.url);
    return genericImage.url;
  }

  const topArtist = enrichArtist(isArtistShow(event) ? event.artists[0] : { name: displayNameForEvent(event), tags: event.eventTypes || event.themes || [] });
  const palette = paletteForArtist(topArtist);
  const title = displayNameForArtist(topArtist) || event.venue || "Bay Area Show";
  const subtitleParts = [
    ...(topArtist.genres || topArtist.tags || []).slice(0, 2),
    topArtist.locality
  ].filter(Boolean);
  const titleLines = wrapPosterText(title, 16, 2).map(escapeSvg);
  const subtitle = escapeSvg(truncateText(subtitleParts.join(" / ") || "Live music", 34));
  const initials = escapeSvg(initialsFor(displayNameForArtist(topArtist) || event.venue || "BA"));
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
  const image = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  eventImageCache.set(event, image);
  return image;
}

function genericImageForEvent(event) {
  if (isArtistShow(event)) return null;
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

  renderEventCardsInBatches(list, renderToken);
}

function renderEventCardsInBatches(list, renderToken) {
  const firstBatchSize = list.length > 250 ? 90 : list.length;
  appendEventCardBatch(list, 0, firstBatchSize);
  if (firstBatchSize >= list.length) return;

  const appendMore = (start) => {
    if (renderToken !== eventRenderToken) return;
    const next = Math.min(start + 120, list.length);
    appendEventCardBatch(list, start, next);
    if (next >= list.length) return;
    scheduleEventCardBatch(() => appendMore(next));
  };
  scheduleEventCardBatch(() => appendMore(firstBatchSize));
}

function scheduleEventCardBatch(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 120 });
    return;
  }
  window.setTimeout(callback, 16);
}

function appendEventCardBatch(list, start, end) {
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    fragment.append(createEventCard(list[index]));
  }
  eventList.append(fragment);
}

function createEventCard(event) {
  const venue = enrichVenue(event);
  const node = eventTemplate.content.firstElementChild.cloneNode(true);
  const topArtist = enrichArtist(isArtistShow(event) ? event.artists[0] : { name: event.venue });
  const genericImage = genericImageForEvent(event);
  const eventImage = node.querySelector(".event-image");
  eventImage.src = imageForEvent(event);
  eventImage.alt = genericImage?.alt || `${displayNameForArtist(topArtist) || event.venue} event image`;
  if (isMikesPick(event)) {
    const badge = document.createElement("span");
    badge.className = "pick-badge";
    badge.textContent = "Mike's Pick";
    node.querySelector(".event-image-wrap").append(badge);
  }
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
  if (isArtistShow(event) && event.artists.length) {
    event.artists.forEach((artist) => artistList.append(renderArtist(artist)));
  } else {
    artistList.append(renderEventListing(event));
  }
  return node;
}

function updateFilterButtons() {
  filterButtons.forEach((button) => {
    const filter = button.dataset.filter;
    const active = state.filter === "custom"
      ? filter === "custom" || state.customFilters.includes(filter)
      : filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setupVenueMapDisclosure() {
  if (!venueMap) return;
  const sync = () => {
    if (mobileMapQuery.matches) venueMap.removeAttribute("open");
    else venueMap.setAttribute("open", "");
  };
  sync();
  mobileMapQuery.addEventListener?.("change", sync);
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
      if (now > keepFiltersOpenUntil) advancedFilters?.removeAttribute("open");
      if (mobileMapQuery.matches && now > keepMapOpenUntil) venueMap?.removeAttribute("open");
    }
  };

  const sync = () => {
    const listTop = eventList.getBoundingClientRect().top;
    if (!isActive && listTop < window.innerHeight * 0.62) setActive(true);
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
  advancedFilters?.setAttribute("open", "");
  showControls?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => advancedFilters?.setAttribute("open", ""), 320);
  window.setTimeout(() => searchInput?.focus({ preventScroll: true }), 260);
}

function returnToListings() {
  window.scrollTo({ top: lastListingScrollY || eventList.offsetTop, behavior: "smooth" });
}

function setStickyToolsMenuOpen(isOpen) {
  if (!stickyToolsMenuButton || !stickyToolsPopover) return;
  stickyToolsMenuButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  stickyToolsPopover.hidden = !isOpen;
}

function jumpToMap() {
  lastListingScrollY = window.scrollY;
  keepMapOpenUntil = Date.now() + 1600;
  returnToListingsButton.disabled = false;
  venueMap?.setAttribute("open", "");
  venueMap?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => venueMap?.setAttribute("open", ""), 320);
}

function renderVenueMap(list) {
  if (!venueMap || !venueMapSvg) return;
  const renderToken = ++venueMapRenderToken;
  const venues = uniqueVenuesWithGeo(list);
  venueMap.hidden = venues.length === 0;
  if (venueMapCount) venueMapCount.textContent = `${venues.length} mapped venue${venues.length === 1 ? "" : "s"}`;
  if (!venues.length) {
    venueMapSvg.replaceChildren();
    clearGoogleVenueMarkers();
    return;
  }

  const googleMapsApiKey = getGoogleMapsApiKey();
  if (googleMapsApiKey && venueGoogleMap) {
    venueMapSvg.hidden = true;
    venueGoogleMap.hidden = false;
    renderGoogleVenueMap(venues, googleMapsApiKey, renderToken);
    return;
  }

  venueMapSvg.hidden = false;
  if (venueGoogleMap) venueGoogleMap.hidden = true;
  clearGoogleVenueMarkers();
  renderSvgVenueMap(venues);
}

function getGoogleMapsApiKey() {
  const params = new URLSearchParams(window.location.search);
  try {
    return window.SHOW_EXPLORER_GOOGLE_MAPS_API_KEY
      || window.localStorage?.getItem("SHOW_EXPLORER_GOOGLE_MAPS_API_KEY")
      || params.get("googleMapsKey")
      || "";
  } catch {
    return window.SHOW_EXPLORER_GOOGLE_MAPS_API_KEY || params.get("googleMapsKey") || "";
  }
}

async function renderGoogleVenueMap(venues, apiKey, renderToken) {
  try {
    await loadGoogleMaps(apiKey);
  } catch {
    if (venueGoogleMap) venueGoogleMap.hidden = true;
    venueMapSvg.hidden = false;
    renderSvgVenueMap(venues);
    return;
  }
  if (renderToken !== venueMapRenderToken || !venueGoogleMap || !window.google?.maps) return;

  const { Map, LatLngBounds, InfoWindow, Marker } = window.google.maps;
  await waitForMapLayout(venueGoogleMap);
  if (renderToken !== venueMapRenderToken) return;

  if (!googleVenueMap) {
    googleVenueMap = new Map(venueGoogleMap, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 10,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true
    });
    googleVenueInfoWindow = new InfoWindow();
  }

  clearGoogleVenueMarkers();
  const bounds = new LatLngBounds();
  venues.forEach((venue) => {
    const position = { lat: venue.geo.latitude, lng: venue.geo.longitude };
    bounds.extend(position);
    const marker = new Marker({
      map: googleVenueMap,
      position,
      title: displayNameForVenue(venue),
      label: venue.showCount > 1 ? String(Math.min(venue.showCount, 9)) : undefined
    });
    marker.addListener("click", () => {
      googleVenueInfoWindow.setContent(googleVenueInfoContent(venue));
      googleVenueInfoWindow.open({ anchor: marker, map: googleVenueMap });
    });
    googleVenueMarkers.push(marker);
  });

  await fitGoogleVenueBounds(bounds, venues.length);
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

async function fitGoogleVenueBounds(bounds, venueCount) {
  window.google.maps.event.trigger(googleVenueMap, "resize");
  googleVenueMap.fitBounds(bounds, 24);
  await new Promise((resolve) => window.google.maps.event.addListenerOnce(googleVenueMap, "idle", resolve));
  googleVenueMap.fitBounds(bounds, 24);
  setTimeout(() => {
    window.google.maps.event.trigger(googleVenueMap, "resize");
    googleVenueMap.fitBounds(bounds, 24);
  }, 250);
  if (venueCount === 1) {
    googleVenueMap.setZoom(Math.min(googleVenueMap.getZoom() || 14, 14));
  }
}

function renderSvgVenueMap(venues) {
  venueMapSvg.replaceChildren();
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

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `showExplorerGoogleMapsReady${Date.now()}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      callback: callbackName
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      delete window[callbackName];
      googleMapsPromise = undefined;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.append(script);
  });
  return googleMapsPromise;
}

function clearGoogleVenueMarkers() {
  googleVenueMarkers.forEach((marker) => marker.setMap(null));
  googleVenueMarkers = [];
}

function googleVenueInfoContent(venue) {
  const title = escapeHtml(displayNameForVenue(venue));
  const meta = escapeHtml([venue.city, venue.region].filter(Boolean).join(" / "));
  const count = `${venue.showCount} show${venue.showCount === 1 ? "" : "s"}`;
  const href = `venue.html?id=${encodeURIComponent(venue.id)}&from=${encodeURIComponent("index.html")}`;
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

function boundsForVenues(venues) {
  const lats = venues.map((venue) => venue.geo.latitude);
  const lngs = venues.map((venue) => venue.geo.longitude);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const rawMinLng = Math.min(...lngs);
  const rawMaxLng = Math.max(...lngs);
  const rawLatRange = rawMaxLat - rawMinLat;
  const rawLngRange = rawMaxLng - rawMinLng;
  const singlePoint = rawLatRange === 0 && rawLngRange === 0;
  const latPad = singlePoint ? 0.01 : 0;
  const lngPad = singlePoint ? 0.01 : 0;
  return {
    minLat: rawMinLat - latPad,
    maxLat: rawMaxLat + latPad,
    minLng: rawMinLng - lngPad,
    maxLng: rawMaxLng + lngPad
  };
}

function projectGeo(geo, bounds) {
  const lngRange = bounds.maxLng - bounds.minLng || 1;
  const latRange = bounds.maxLat - bounds.minLat || 1;
  const x = venueMapPlot.left + ((geo.longitude - bounds.minLng) / lngRange) * (venueMapPlot.right - venueMapPlot.left);
  const y = venueMapPlot.bottom - ((geo.latitude - bounds.minLat) / latRange) * (venueMapPlot.bottom - venueMapPlot.top);
  return { x, y };
}

function mapBackground(bounds) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "venue-map-bg");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", "venue-map-terrain-gradient");
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("x1", "282");
  gradient.setAttribute("y1", "620");
  gradient.setAttribute("x2", "718");
  gradient.setAttribute("y2", "0");
  [
    ["0%", "var(--map-gradient-start)"],
    ["100%", "var(--map-gradient-end)"]
  ].forEach(([offset, color]) => {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    gradient.append(stop);
  });
  defs.append(gradient);
  group.append(defs);

  const gradientRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  gradientRect.setAttribute("class", "venue-map-gradient");
  gradientRect.setAttribute("x", "0");
  gradientRect.setAttribute("y", "0");
  gradientRect.setAttribute("width", "1000");
  gradientRect.setAttribute("height", "620");
  group.append(gradientRect);

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
    line.setAttribute("x1", venueMapPlot.left);
    line.setAttribute("x2", venueMapPlot.right);
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
    line.setAttribute("y1", venueMapPlot.top);
    line.setAttribute("y2", venueMapPlot.bottom);
    group.append(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "venue-map-coordinate");
    label.setAttribute("x", point.x + 7);
    label.setAttribute("y", venueMapPlot.bottom - 14);
    label.textContent = `${Math.abs(lng).toFixed(2)}°W`;
    group.append(label);
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
  const ticks = [Number(min.toFixed(4))];
  const start = Math.ceil(min / step) * step;
  for (let value = start; value <= max; value += step) {
    const tick = Number(value.toFixed(2));
    if (tick > min && tick < max) ticks.push(tick);
  }
  ticks.push(Number(max.toFixed(4)));
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
  activateCustomForControlChange();
  render();
});

cityFilterInput.addEventListener("change", (event) => {
  state.city = event.target.value;
  activateCustomForControlChange();
  render();
});

sortInput.value = state.sort;
sortInput.addEventListener("change", (event) => {
  state.sort = event.target.value;
  activateCustomForControlChange();
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyFilterSelection(button.dataset.filter);
    render();
  });
});

function applyFilterSelection(filter) {
  if (filter === "all") {
    state.filter = filter;
    state.customFilters = [];
    return;
  }

  if (filter === "custom") {
    const previousFilter = state.filter;
    state.filter = "custom";
    if (!state.customFilters.length && customFilterKeys.has(previousFilter)) {
      state.customFilters = [previousFilter];
    }
    return;
  }

  if (state.filter !== "custom") {
    state.filter = filter;
    state.customFilters = [];
    return;
  }

  if (!customFilterKeys.has(filter)) return;
  if (state.customFilters.includes(filter)) {
    state.customFilters = state.customFilters.filter((item) => item !== filter);
  } else {
    state.customFilters = [...state.customFilters, filter];
  }
}

function activateCustomForControlChange() {
  if (state.filter === "custom") {
    if (!state.customFilters.length) state.customFilters = ["music"];
    return;
  }
  const previousFilter = state.filter;
  state.filter = "custom";
  state.customFilters = customFilterKeys.has(previousFilter) ? [previousFilter] : ["music"];
}

sourceFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sourceFilterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.source = button.dataset.sourceFilter;
    activateCustomForControlChange();
    render();
  });
});

jumpToFiltersButton?.addEventListener("click", jumpToFilters);
returnToListingsButton?.addEventListener("click", returnToListings);
stickyFiltersButton?.addEventListener("click", jumpToFilters);
stickyMapButton?.addEventListener("click", jumpToMap);
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
