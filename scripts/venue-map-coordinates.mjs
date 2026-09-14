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

export function applyVerifiedMapCoordinates(venue) {
  if (Number.isFinite(venue.geo?.latitude) && Number.isFinite(venue.geo?.longitude)) return false;
  const matches = (venue.links || [])
    .filter(link => link.type === 'maps' && link.confidence === 'verified')
    .map(link => ({ link, geo: coordinatesFromMapsLink(link.url) }))
    .filter(match => match.geo);
  if (!matches.length) return false;
  const points = new Set(matches.map(({ geo }) => `${geo.latitude},${geo.longitude}`));
  if (points.size !== 1) return false;
  venue.geo = matches[0].geo;
  venue.evidence ||= [];
  venue.evidence.push({ url: matches[0].link.url, note: 'Coordinates extracted from the place marker in the verified Google Maps link.' });
  return true;
}
