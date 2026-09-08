const homeEvents = [...(window.SHOW_EXPLORER_EVENTS || [])].sort((a, b) => {
  return (a.date || "").localeCompare(b.date || "") || (a.venue || "").localeCompare(b.venue || "");
});
const homeArtists = window.SHOW_EXPLORER_ARTISTS?.artists || {};
const homeVenues = window.SHOW_EXPLORER_VENUES?.venues || {};
const homePicks = document.querySelector("#homePicks");

function todayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

function enrichArtist(artist = {}) {
  const enrichment = homeArtists[slugify(artist.name || "")] || {};
  return {
    ...artist,
    ...enrichment
  };
}

function enrichVenue(event) {
  const venue = homeVenues[event.venueId || venueIdFor(event)];
  if (venue?.mergedInto && homeVenues[venue.mergedInto]) return homeVenues[venue.mergedInto];
  return venue || {
    name: event.venue,
    displayName: event.venue,
    imageUrl: "",
    city: event.city || "",
    region: ""
  };
}

function displayNameForArtist(artist = {}) {
  return artist.displayName || artist.name || "";
}

function displayNameForVenue(venue = {}) {
  return venue.displayName || venue.name || "";
}

function imageForPick(event) {
  const firstArtist = enrichArtist(event.artists?.[0] || {});
  const venue = enrichVenue(event);
  return preferredImage([
    { url: event.imageUrl, priority: 0 },
    { url: firstArtist.imageUrl, priority: 1 },
    { url: firstArtist.spotifyImageUrl, priority: 2 },
    { url: venue.imageUrl, priority: 3 }
  ]);
}

function preferredImage(candidates) {
  return candidates
    .filter((candidate) => candidate.url)
    .sort((a, b) => imageUrlRank(a.url) - imageUrlRank(b.url) || a.priority - b.priority)[0]?.url || "";
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

function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function venueIdFor(event) {
  const anchor = (event.venueHref || "").match(/club\.html#([^/?#]+)/i)?.[1];
  return anchor ? slugify(anchor) : slugify(event.venue || "unknown-venue");
}

function renderPickTile(event) {
  const firstArtist = enrichArtist(event.artists?.[0] || { name: event.details || "Artist show" });
  const venue = enrichVenue(event);
  const imageUrl = imageForPick(event);
  const link = document.createElement("a");
  link.className = "home-pick-tile";
  link.href = `show-explorer.html#${encodeURIComponent(event.id)}`;
  link.setAttribute("aria-label", `${displayNameForArtist(firstArtist)} at ${displayNameForVenue(venue) || event.venue}`);

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    link.append(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "home-pick-image-fallback";
    fallback.textContent = "Mike's List";
    link.append(fallback);
  }

  const text = document.createElement("span");
  text.className = "home-pick-text";

  const venueName = document.createElement("span");
  venueName.className = "home-pick-venue";
  venueName.textContent = displayNameForVenue(venue) || event.venue || "Bay Area venue";

  const artistName = document.createElement("strong");
  artistName.className = "home-pick-artist";
  artistName.textContent = displayNameForArtist(firstArtist) || event.details || "Artist show";

  text.append(venueName, artistName);
  link.append(text);
  return link;
}

function renderHomePicks() {
  if (!homePicks) return;
  const today = todayString();
  const seenArtists = new Set();
  const picks = homeEvents
    .filter((event) => (event.date || "") >= today)
    .filter((event) => showTypeForEvent(event) === "artist")
    .filter((event) => isMikesPick(event))
    .filter((event) => {
      const firstArtist = enrichArtist(event.artists?.[0] || {});
      const key = slugify(displayNameForArtist(firstArtist) || firstArtist.name || event.details || event.id);
      if (!key || seenArtists.has(key)) return false;
      seenArtists.add(key);
      return true;
    })
    .slice(0, 6);

  homePicks.replaceChildren();
  if (!picks.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No upcoming Mike's Picks are selected yet.";
    homePicks.append(empty);
    return;
  }

  picks.forEach((event) => homePicks.append(renderPickTile(event)));
}

renderHomePicks();
