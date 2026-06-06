import { readFile, writeFile } from "node:fs/promises";

const ARTISTS_PATH = new URL("../data/artists.js", import.meta.url);

async function readWindowData(path, globalName, fallback) {
  try {
    const text = await readFile(path, "utf8");
    const match = text.match(new RegExp(`window\\.${globalName}\\s*=\\s*([\\s\\S]*);\\s*$`));
    return match ? JSON.parse(match[1]) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function hasTrustedLinkOfType(artist, type) {
  return (artist.links || []).some((link) => {
    return link.type === type && (link.confidence === "likely" || link.confidence === "verified");
  });
}

function isNumericAppleMusicRedirect(link) {
  return link.type === "appleMusic" && /music\.apple\.com\/[^/]+\/artist\/\d+\/?$/i.test(link.url || "");
}

function hasCanonicalAppleMusicLink(artist) {
  return (artist.links || []).some((link) => {
    return link.type === "appleMusic" && /music\.apple\.com\/[^/]+\/artist\/[^/]+\/\d+\/?$/i.test(link.url || "");
  });
}

function confidenceRank(confidence = "candidate") {
  return { rejected: 0, research: 1, candidate: 2, likely: 3, verified: 4 }[confidence] || 1;
}

function discogsId(link) {
  return (link.url || "").match(/discogs\.com\/artist\/(\d+)/i)?.[1] || "";
}

function shouldRejectNoisyCandidate(link) {
  if (link.confidence !== "candidate" || link.source !== "verified-page") return false;
  const url = link.url || "";

  if (link.type === "bandcamp") {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "bandcamp.com" || parsed.hostname === "www.bandcamp.com") return true;
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts.length > 0 && parts[0] !== "music";
    } catch {
      return false;
    }
  }

  if (link.type === "spotify") {
    return !/open\.spotify\.com\/artist\//i.test(url);
  }

  if (link.type === "appleMusic") {
    return !/music\.apple\.com\/[^/]+\/artist\/[^/]+\/\d+\/?$/i.test(url);
  }

  if (link.type === "youtube") {
    return !/(youtube\.com\/@|youtube\.com\/channel\/UC|youtu\.be\/)/i.test(url);
  }

  return false;
}

function shouldDropPlatformSpillover(artist, link) {
  if (link.confidence !== "candidate" || link.source !== "verified-page") return false;
  if (link.sourcePage && !isPlatformPage(link.sourcePage)) return false;

  if (link.type === "spotify") {
    return !hasVerifiedSameNormalizedUrl(artist, link);
  }

  if (link.type === "appleMusic") {
    const artistSlug = normalizeForPath(artist.name);
    const path = (() => {
      try {
        return new URL(link.url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    return !path.includes(`/artist/${artistSlug}/`) || hasVerifiedSameNormalizedUrl(artist, link);
  }

  if (link.type === "youtube") {
    return /^https:\/\/www\.youtube\.com\/?$/i.test(link.url || "") || /youtube\.com\/(about|creators|ads|t\/|new|howyoutubeworks)/i.test(link.url || "");
  }

  return false;
}

function isPlatformPage(url = "") {
  try {
    const host = new URL(url).hostname;
    return /open\.spotify\.com|music\.apple\.com|youtube\.com|music\.youtube\.com/i.test(host);
  } catch {
    return false;
  }
}

function normalizeForPath(text = "") {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hasVerifiedSameNormalizedUrl(artist, link) {
  const key = normalizedUrl(link.url || "");
  return (artist.links || []).some((item) => item !== link && item.confidence === "verified" && normalizedUrl(item.url || "") === key);
}

function isAutoRejectedNoise(link) {
  return link.confidence === "rejected" && (
    link.reviewNote === "Noisy platform/navigation link from a verified page, not an artist profile candidate." ||
    link.reviewNote === "Duplicate URL candidate; a stronger/canonical link is already stored." ||
    link.reviewNote === "Bandcamp subpage is superseded by the verified Bandcamp artist page." ||
    link.reviewNote === "Rejected Wikipedia navigation or related-article link; a canonical Wikipedia artist link is already stored."
  );
}

function isWikipediaUrl(url = "") {
  try {
    const host = new URL(url).hostname;
    return host === "wikipedia.org" || host.endsWith(".wikipedia.org");
  } catch {
    return false;
  }
}

function isWikimediaNoiseUrl(url = "") {
  try {
    const host = new URL(url).hostname;
    return host === "wikimedia.org" || host.endsWith(".wikimedia.org");
  } catch {
    return false;
  }
}

function canonicalWikipediaArticleUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (!isWikipediaUrl(parsed.href)) return "";
    if (parsed.hostname !== "en.wikipedia.org") return "";
    if (!parsed.pathname.startsWith("/wiki/")) return "";
    const title = decodeURIComponent(parsed.pathname.slice("/wiki/".length));
    if (!title || wikipediaNamespace(title)) return "";
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = "en.wikipedia.org";
    return parsed.href;
  } catch {
    return "";
  }
}

function wikipediaNamespace(title = "") {
  return title.match(/^([^:]+):/)?.[1] || "";
}

function hasAcceptedWikipediaLink(artist) {
  return (artist.links || []).some((link) => {
    return link.confidence !== "rejected" && isWikipediaUrl(link.url || "");
  });
}

function shouldDropRejectedWikipediaNoise(artist, link) {
  if (link.confidence !== "rejected") return false;
  if (isWikimediaNoiseUrl(link.url || "")) return true;
  if (!isWikipediaUrl(link.url || "")) return false;
  if (!hasAcceptedWikipediaLink(artist)) return false;
  const canonical = canonicalWikipediaArticleUrl(link.url || "");
  if (!canonical) return true;
  return !sameWikipediaArticle(canonical, acceptedWikipediaUrls(artist));
}

function acceptedWikipediaUrls(artist) {
  return (artist.links || [])
    .filter((link) => link.confidence !== "rejected")
    .map((link) => canonicalWikipediaArticleUrl(link.url || ""))
    .filter(Boolean);
}

function sameWikipediaArticle(url, urls = []) {
  const normalized = normalizedUrl(url);
  return urls.some((item) => normalizedUrl(item) === normalized);
}

function canonicalCandidateUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if (parsed.hostname.startsWith("www.")) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    if (parsed.hostname.includes("open.spotify.com")) {
      parsed.search = "";
    }

    if (parsed.hostname === "instagram.com") {
      const username = parsed.pathname.split("/").filter(Boolean)[0];
      if (username) parsed.pathname = `/${username}/`;
      parsed.search = "";
    }

    if (parsed.hostname === "facebook.com") {
      const slug = parsed.pathname.split("/").filter(Boolean)[0];
      if (slug) parsed.pathname = `/${slug}/`;
      parsed.search = "";
    }

    if (parsed.hostname === "twitter.com") {
      parsed.hostname = "x.com";
    }

    if (parsed.hostname === "x.com") {
      const username = parsed.pathname.split("/").filter(Boolean)[0];
      if (username) parsed.pathname = `/${username}`;
      parsed.search = "";
    }

    if (parsed.hostname === "tiktok.com") {
      const username = parsed.pathname.split("/").filter(Boolean)[0];
      if (username?.startsWith("@")) parsed.pathname = `/${username}`;
      parsed.search = "";
    }

    return parsed.href;
  } catch {
    return url;
  }
}

function normalizedUrl(url = "") {
  return canonicalCandidateUrl(url).replace(/\/$/, "").toLowerCase();
}

function hasVerifiedSameBandcampHost(artist, link) {
  if (link.type !== "bandcamp" || link.confidence !== "candidate") return false;
  try {
    const candidateHost = new URL(link.url).hostname;
    return (artist.links || []).some((item) => {
      return item.type === "bandcamp" && item.confidence === "verified" && new URL(item.url).hostname === candidateHost;
    });
  } catch {
    return false;
  }
}

function inferredVideoType(url = "") {
  const lower = url.toLowerCase();
  if (lower.includes("music.youtube.com")) return "youtubeMusic";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  return "";
}

function isYouTubeChannelId(link) {
  return link.type === "youtube" && /youtube\.com\/channel\/UC/i.test(link.url || "");
}

function hasYouTubeHandle(artist) {
  return (artist.links || []).some((link) => {
    return link.type === "youtube" && link.confidence !== "rejected" && /youtube\.com\/@[^/?#]+/i.test(link.url || "");
  });
}

const store = await readWindowData(ARTISTS_PATH, "SHOW_EXPLORER_ARTISTS", { artists: {} });
let changed = 0;

for (const artist of Object.values(store.artists || {})) {
  const strongestDiscogsById = new Map();
  const strongestByNormalizedUrl = new Map();
  const rejectedNormalizedUrls = new Set((artist.links || [])
    .filter((link) => link.confidence === "rejected")
    .map((link) => normalizedUrl(link.url || "")));

  for (const link of artist.links || []) {
    const key = normalizedUrl(link.url || "");
    if (key && link.confidence !== "rejected") {
      const previous = strongestByNormalizedUrl.get(key);
      if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence) || (link.url.length < previous.url.length && confidenceRank(link.confidence) === confidenceRank(previous.confidence))) {
        strongestByNormalizedUrl.set(key, link);
      }
    }

    const id = discogsId(link);
    if (!id || link.confidence === "rejected") continue;
    const previous = strongestDiscogsById.get(id);
    if (!previous || confidenceRank(link.confidence) > confidenceRank(previous.confidence) || (link.url.length > previous.url.length && confidenceRank(link.confidence) === confidenceRank(previous.confidence))) {
      strongestDiscogsById.set(id, link);
    }
  }

  for (const link of artist.links || []) {
    if (isWikipediaUrl(link.url || "") && link.type !== "wikipedia") {
      link.type = "wikipedia";
      link.label = "Wikipedia";
      changed += 1;
    }

    if (link.source === "verified-page" && link.confidence === "candidate") {
      const canonical = canonicalCandidateUrl(link.url || "");
      if (canonical !== link.url) {
        link.url = canonical;
        changed += 1;
      }
    }

    if (link.confidence !== "rejected" && rejectedNormalizedUrls.has(normalizedUrl(link.url || ""))) {
      link.drop = true;
      changed += 1;
    }

    const videoType = inferredVideoType(link.url);
    if (videoType && link.type !== videoType) {
      link.type = videoType;
      link.label = videoType === "youtubeMusic" ? "YouTube Music" : "YouTube";
      changed += 1;
    }

    if (link.type === "search" && link.confidence === "candidate") {
      link.confidence = "research";
      changed += 1;
    }

    if (link.source === "imported" && link.confidence === "candidate" && hasTrustedLinkOfType(artist, link.type)) {
      link.confidence = "rejected";
      link.reviewNote = "Superseded by a structured likely/verified link of the same type.";
      changed += 1;
    }

    if (isNumericAppleMusicRedirect(link) && hasCanonicalAppleMusicLink(artist)) {
      link.confidence = "rejected";
      link.reviewNote = "Numeric Apple Music URL redirects to an existing canonical Apple Music link.";
      changed += 1;
    }

    if (isYouTubeChannelId(link) && hasYouTubeHandle(artist)) {
      link.confidence = "rejected";
      link.reviewNote = "YouTube channel ID link is superseded by a human-readable YouTube handle link.";
      changed += 1;
    }

    if (shouldRejectNoisyCandidate(link)) {
      link.drop = true;
      changed += 1;
    }

    if (shouldDropPlatformSpillover(artist, link)) {
      link.drop = true;
      changed += 1;
    }

    if (hasVerifiedSameBandcampHost(artist, link)) {
      link.drop = true;
      changed += 1;
    }

    if (shouldDropRejectedWikipediaNoise(artist, link)) {
      link.reviewNote = "Rejected Wikipedia navigation or related-article link; a canonical Wikipedia artist link is already stored.";
      link.drop = true;
      changed += 1;
    }

    const normalized = normalizedUrl(link.url || "");
    const strongestNormalized = normalized ? strongestByNormalizedUrl.get(normalized) : null;
    if (strongestNormalized && strongestNormalized !== link && link.confidence !== "rejected") {
      link.drop = true;
      changed += 1;
    }

    const id = discogsId(link);
    const strongest = id ? strongestDiscogsById.get(id) : null;
    if (strongest && strongest !== link && link.confidence !== "rejected") {
      link.confidence = "rejected";
      link.reviewNote = "Duplicate Discogs artist ID; a stronger/canonical link is already stored.";
      changed += 1;
    }
  }

  const rejectedUrls = new Set((artist.links || []).filter((link) => link.confidence === "rejected").map((link) => link.url));
  const originalEvidenceCount = artist.evidence?.length || 0;
  artist.evidence = (artist.evidence || []).filter((item) => !rejectedUrls.has(item.url));
  if (artist.evidence.length !== originalEvidenceCount) changed += originalEvidenceCount - artist.evidence.length;

  const originalLinkCount = artist.links?.length || 0;
  artist.links = (artist.links || []).filter((link) => !link.drop && !isAutoRejectedNoise(link));
  if (artist.links.length !== originalLinkCount) changed += originalLinkCount - artist.links.length;

  artist.supportPriority = supportPriorityForLinks(artist.links || []);
}

store.generatedAt = new Date().toISOString();
await writeFile(ARTISTS_PATH, `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(store, null, 2)};\n`, "utf8");
console.log(`Normalized ${changed} artist-store links.`);

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
