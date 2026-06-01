const detailKind = document.querySelector("[data-detail-kind]")?.dataset.detailKind || "";
const detailPanel = document.querySelector("#detailPanel");
const detailTitle = document.querySelector("#detailTitle");
const backButton = document.querySelector("#backButton");
const events = [...(window.SHOW_EXPLORER_EVENTS || [])].sort((a, b) => a.date.localeCompare(b.date));
const artistStore = loadStore("bay-area-show-explorer-artists", window.SHOW_EXPLORER_ARTISTS || { artists: {} });
const venueStore = loadStore("bay-area-show-explorer-venues", window.SHOW_EXPLORER_VENUES || { venues: {} });

function loadStore(key, base) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (!saved) return base;
    const savedTime = Date.parse(saved.generatedAt || "");
    const baseTime = Date.parse(base.generatedAt || "");
    if (Number.isFinite(savedTime) && Number.isFinite(baseTime)) return savedTime > baseTime ? saved : base;
    return saved;
  } catch {
    return base;
  }
}

function render() {
  setupBackNavigation();
  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (detailKind === "artist") return renderArtistPage(id);
  if (detailKind === "venue") return renderVenuePage(id);
  renderMissing("Unknown page type.");
}

function setupBackNavigation() {
  if (!backButton) return;
  const fallback = detailKind === "venue" ? "index.html" : "index.html";
  const from = new URLSearchParams(window.location.search).get("from");
  backButton.addEventListener("click", () => {
    if (from && isLocalPath(from)) {
      window.location.href = from;
      return;
    }
    if (document.referrer && sameOrigin(document.referrer) && window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = fallback;
  });
}

function renderArtistPage(id) {
  const artist = artistStore.artists?.[id];
  if (!artist) return renderMissing("Artist not found.");
  detailTitle.textContent = artist.name;
  document.title = `${artist.name} - Bay Area Show Explorer`;

  const shows = events.filter((event) => event.artists.some((item) => slugify(item.name) === artist.id));
  detailPanel.replaceChildren(
    heroSection({
      kicker: artist.confidence || "review",
      title: artist.name,
      summary: artist.summary || artist.reviewNotes || "No summary has been added yet.",
      meta: [
        artist.locality || "unknown locality",
        ...(artist.genres || artist.tags || []).slice(0, 4)
      ]
    }),
    infoGrid([
      ["Locality", artist.locality || "unknown"],
      ["Genres", (artist.genres || artist.tags || []).join(", ") || "unknown"],
      ["Aliases", (artist.aliases || []).join(", ") || "none"],
      ["Confidence", artist.confidence || "review"]
    ]),
    linkSection("Links", prioritizedArtistLinks(artist.links || [])),
    showsSection("Upcoming Shows", shows.map((event) => ({
      date: event.date,
      title: event.artists.map((item) => item.name).join(" / "),
      meta: eventLineFor(event),
      href: `venue.html?id=${encodeURIComponent(resolveVenue(event).id || venueIdFor(event))}`
    })))
  );
}

function renderVenuePage(id) {
  const rawVenue = venueStore.venues?.[id];
  const venue = rawVenue?.mergedInto && venueStore.venues?.[rawVenue.mergedInto] ? venueStore.venues[rawVenue.mergedInto] : rawVenue;
  if (!venue) return renderMissing("Venue not found.");
  const title = displayNameFor(venue);
  detailTitle.textContent = title;
  document.title = `${title} - Bay Area Show Explorer`;

  const shows = events.filter((event) => {
    const eventVenue = resolveVenue(event);
    return eventVenue.id === venue.id || venueIdFor(event) === venue.id;
  });
  detailPanel.replaceChildren(
    heroSection({
      kicker: venue.confidence || "review",
      title,
      summary: venue.summary || venue.reviewNotes || "No summary has been added yet.",
      meta: [
        [venue.city, venue.region].filter(Boolean).join(", "),
        venue.venueType,
        venue.status
      ].filter(Boolean)
    }),
    infoGrid([
      ["Listed As", venue.name || "unknown"],
      ["Address", venue.address || "unknown"],
      ["Age Policy", venue.agePolicy || "unknown"],
      ["Capacity", venue.capacity || "unknown"],
      ["Status", venue.status || "unknown"],
      ["Confidence", venue.confidence || "review"]
    ]),
    linkSection("Links", activeLinks(venue.links || [])),
    showsSection("Upcoming Shows", shows.map((event) => ({
      date: event.date,
      title: event.artists.map((artist) => artist.name).join(" / "),
      meta: event.details || "",
      href: `index.html?show=${encodeURIComponent(event.id || "")}`
    })))
  );
}

function heroSection({ kicker, title, summary, meta }) {
  const section = document.createElement("section");
  section.className = "detail-hero";
  section.innerHTML = `
    <p class="kicker"></p>
    <h2 class="statement-type"></h2>
    <p class="detail-summary"></p>
    <div class="detail-chips"></div>
  `;
  section.querySelector(".kicker").textContent = kicker;
  section.querySelector("h2").textContent = title;
  section.querySelector(".detail-summary").textContent = summary;
  const chips = section.querySelector(".detail-chips");
  meta.filter(Boolean).forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item;
    chips.append(chip);
  });
  return section;
}

function infoGrid(items) {
  const section = document.createElement("section");
  section.className = "detail-section";
  section.innerHTML = "<h3>Details</h3><dl class=\"detail-list\"></dl>";
  const list = section.querySelector("dl");
  items.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    list.append(dt, dd);
  });
  return section;
}

function linkSection(title, links) {
  const section = document.createElement("section");
  section.className = "detail-section";
  section.innerHTML = "<h3></h3><div class=\"artist-links detail-links\"></div>";
  section.querySelector("h3").textContent = title;
  const container = section.querySelector(".detail-links");
  if (!links.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No reviewed links yet.";
    section.append(empty);
    return section;
  }
  links.forEach((link) => {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label || labelForType(link.type);
    container.append(anchor);
  });
  return section;
}

function showsSection(title, shows) {
  const section = document.createElement("section");
  section.className = "detail-section";
  section.innerHTML = "<h3></h3><div class=\"detail-show-list\"></div>";
  section.querySelector("h3").textContent = title;
  const list = section.querySelector(".detail-show-list");
  if (!shows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No upcoming shows are attached yet.";
    list.append(empty);
    return section;
  }
  shows.forEach((show) => {
    const item = document.createElement("a");
    item.className = "detail-show";
    item.href = show.href;
    item.innerHTML = "<time></time><strong></strong><span></span>";
    item.querySelector("time").textContent = formatDate(show.date);
    item.querySelector("strong").textContent = show.title;
    item.querySelector("span").textContent = show.meta;
    list.append(item);
  });
  return section;
}

function isLocalPath(path) {
  return /^(?:[a-z-]+\.html(?:[?#].*)?|index\.html(?:[?#].*)?|\/[^/].*)$/i.test(path) && !path.includes("://");
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function renderMissing(message) {
  detailTitle.textContent = "Not Found";
  detailPanel.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  detailPanel.append(empty);
}

function prioritizedArtistLinks(links) {
  return [...links].filter(displayableLink).sort((a, b) => {
    const aRank = displayPriorityRank(a);
    const bRank = displayPriorityRank(b);
    const aBucket = a.type === "official" ? 0 : a.type === "linktree" ? 1 : 2;
    const bBucket = b.type === "official" ? 0 : b.type === "linktree" ? 1 : 2;
    return aRank - bRank || aBucket - bBucket || labelForType(a.type).localeCompare(labelForType(b.type));
  });
}

function activeLinks(links) {
  return [...links]
    .filter(displayableLink)
    .sort((a, b) => displayPriorityRank(a) - displayPriorityRank(b) || labelForType(a.type).localeCompare(labelForType(b.type)) || (a.url || "").localeCompare(b.url || ""));
}

function displayableLink(link) {
  return link.confidence !== "rejected" && link.display !== false;
}

function displayPriorityRank(link) {
  return link.displayPriority === "primary" ? 0 : 1;
}

function resolveVenue(event) {
  const id = event.venueId || venueIdFor(event);
  const venue = venueStore.venues?.[id];
  if (venue?.mergedInto && venueStore.venues?.[venue.mergedInto]) return venueStore.venues[venue.mergedInto];
  return venue || { id, name: event.venue, displayName: event.venue, city: event.city || "", region: "" };
}

function eventLineFor(event) {
  const venue = resolveVenue(event);
  const venuePlace = [venue.city, venue.region].filter(Boolean).join(", ");
  const venueName = displayNameFor(venue) || event.venue;
  return [venuePlace ? `${venueName}, ${venuePlace}` : venueName, event.details].filter(Boolean).join(" | ");
}

function displayNameFor(venue) {
  return venue.displayName || venue.name || "";
}

function venueIdFor(event) {
  const anchor = (event.venueHref || "").match(/club\.html#([^/?#]+)/i)?.[1];
  return anchor ? slugify(anchor) : slugify(event.venue || "unknown-venue");
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
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
    liveNation: "Live Nation",
    localwiki: "LocalWiki",
    maps: "Maps",
    musicbrainz: "MusicBrainz",
    official: "Official",
    other: "Other",
    qobuz: "Qobuz",
    search: "Search",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    theList: "The List",
    tidal: "Tidal",
    ticketmaster: "Ticketmaster",
    tiktok: "TikTok",
    twitter: "X/Twitter",
    wikidata: "Wikidata",
    wikipedia: "Wikipedia",
    yelp: "Yelp",
    youtube: "YouTube",
    youtubeMusic: "YouTube Music"
  };
  return labels[type] || type || "Link";
}

render();
