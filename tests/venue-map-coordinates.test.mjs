import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesFromMapsLink, applyVerifiedMapCoordinates } from '../scripts/venue-map-coordinates.mjs';

const url = 'https://www.google.com/maps/place/Bricabrac/@37.7125849,-122.4090369,17z/data=!8m2!3d37.7125849!4d-122.4068482';
test('uses the place marker rather than the map camera', () => {
  assert.deepEqual(coordinatesFromMapsLink(url), { latitude: 37.7125849, longitude: -122.4068482 });
});
test('rejects camera-only, unrelated, ambiguous, and invalid coordinates', () => {
  for (const value of [
    'https://www.google.com/maps/@37.7,-122.4,17z',
    url.replace('www.google.com', 'example.com'),
    `${url}!3d38!4d-123`, url.replace('!3d37.7125849', '!3d137.7')
  ]) assert.equal(coordinatesFromMapsLink(value), null);
});
test('requires verified links and preserves existing coordinates', () => {
  const venue = { geo: null, links: [{ type: 'maps', confidence: 'candidate', url }] };
  assert.equal(applyVerifiedMapCoordinates(venue), false);
  venue.links[0].confidence = 'verified';
  assert.equal(applyVerifiedMapCoordinates(venue), true);
  venue.geo = { latitude: 38, longitude: -123 };
  assert.equal(applyVerifiedMapCoordinates(venue), false);
  assert.equal(venue.geo.latitude, 38);
});
