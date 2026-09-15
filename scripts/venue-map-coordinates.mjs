export function coordinatesFromMapsLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname)) return null;
    if (!url.pathname.startsWith('/maps')) return null;
    // Place markers, not the @lat,lng map-camera position.
    const pairs = [...decodeURIComponent(url.pathname).matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)]
      .map(match => ({ latitude: Number(match[1]), longitude: Number(match[2]) }));
    if (!pairs.length || pairs.some(point => Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)) return null;
    const unique = new Map(pairs.map(point => [`${point.latitude},${point.longitude}`, point]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  } catch {
    return null;
  }
}

export function preferredMapsLinks(venue) {
  const links = (venue.links || []).filter(link => {
    if (link.type !== 'maps' || link.confidence === 'rejected') return false;
    try {
      const url = new URL(link.url);
      return url.protocol === 'https:' && (
        (['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname) && url.pathname.startsWith('/maps')) ||
        ['maps.app.goo.gl', 'goo.gl'].includes(url.hostname)
      );
    } catch { return false; }
  });
  const manual = links.filter(link => link.source === 'manual');
  return manual.length ? manual : links.filter(link => link.confidence === 'verified');
}

export function addressFromMapsLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname)) return null;
    const place = url.pathname.match(/^\/maps\/place\/([^/]+)/)?.[1];
    if (!place) return null;
    const address = decodeURIComponent(place.replaceAll('+', ' ')).replace(/\s+/g, ' ').trim();
    // Only accept an explicit street address, not a venue name or map position.
    if (!/^\d+[A-Za-z]?(?:-\d+)?\s+[^,]+,\s*[^,]+,\s*(?:CA|California)(?:\s+\d{5}(?:-\d{4})?)?(?:,\s*(?:USA|United States))?$/i.test(address)) return null;
    return address;
  } catch {
    return null;
  }
}

export function applySavedMapLocation(venue) {
  const coordinatesChanged = applyVerifiedMapCoordinates(venue);
  if (venue.address?.trim()) return coordinatesChanged;
  const matches = preferredMapsLinks(venue)
    .map(link => ({ link, address: addressFromMapsLink(link.url) }))
    .filter(match => match.address);
  const addresses = new Set(matches.map(({ address }) => address.toLowerCase()));
  if (addresses.size !== 1) return coordinatesChanged;
  venue.address = matches[0].address;
  venue.evidence ||= [];
  venue.evidence.push({ url: matches[0].link.url, note: 'Address extracted from the saved Google Maps place URL.' });
  return true;
}

export function applyVerifiedMapCoordinates(venue) {
  if (Number.isFinite(venue.geo?.latitude) && Number.isFinite(venue.geo?.longitude)) return false;
  const matches = preferredMapsLinks(venue)
    .map(link => ({ link, geo: coordinatesFromMapsLink(link.url) }))
    .filter(match => match.geo);
  if (!matches.length) return false;
  const points = new Set(matches.map(({ geo }) => `${geo.latitude},${geo.longitude}`));
  if (points.size !== 1) return false;
  venue.geo = matches[0].geo;
  venue.evidence ||= [];
  venue.evidence.push({ url: matches[0].link.url, note: 'Coordinates extracted from the place marker in the saved Google Maps link.' });
  return true;
}
