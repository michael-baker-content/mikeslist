import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesFromMapsLink, applyVerifiedMapCoordinates, preferredMapsLinks, addressFromMapsLink, applySavedMapLocation } from '../scripts/venue-map-coordinates.mjs';

const url = 'https://www.google.com/maps/place/Bricabrac/@37.7125849,-122.4090369,17z/data=!8m2!3d37.7125849!4d-122.4068482';
const addressUrl = 'https://www.google.com/maps/place/1+Paseo+de+San+Antonio,+San+Jose,+CA+95113/@37.3324736,-121.8917259,17z/data=!8m2!3d37.3324736!4d-121.8891456';

test('fills the Plaza address even when coordinates are already saved', () => {
  const geo = { latitude: 37.3324736, longitude: -121.8891456 };
  const venue = { geo, address: '', links: [{ type: 'maps', source: 'manual', url: addressUrl }] };
  assert.equal(applySavedMapLocation(venue), true);
  assert.equal(venue.address, '1 Paseo de San Antonio, San Jose, CA 95113');
  assert.deepEqual(venue.geo, geo);
  assert.equal(venue.evidence[0].url, addressUrl);
  assert.equal(applySavedMapLocation(venue), false);
  assert.equal(venue.evidence.length, 1);
  venue.address = 'My corrected address';
  assert.equal(applySavedMapLocation(venue), false);
  assert.equal(venue.address, 'My corrected address');
});

test('decodes addresses but rejects venue names, non-Google links and malformed URLs', () => {
  assert.equal(addressFromMapsLink(addressUrl.replaceAll('+', '%20')), '1 Paseo de San Antonio, San Jose, CA 95113');
  for (const value of [url, addressUrl.replace('www.google.com', 'example.com'), 'https://maps.app.goo.gl/example', 'invalid', 'https://www.google.com/maps/place/%ZZ']) {
    assert.equal(addressFromMapsLink(value), null);
  }
});

test('manual addresses take priority and conflicting or rejected addresses are not used', () => {
  const manual = { type: 'maps', source: 'manual', url: addressUrl };
  const other = { type: 'maps', confidence: 'verified', url: addressUrl.replace('1+Paseo', '2+Paseo') };
  const venue = { links: [manual, other] };
  applySavedMapLocation(venue);
  assert.equal(venue.address, '1 Paseo de San Antonio, San Jose, CA 95113');
  for (const links of [[manual, { ...other, source: 'manual' }], [{ ...manual, confidence: 'rejected' }]]) {
    const conflicting = { links };
    applySavedMapLocation(conflicting);
    assert.equal(conflicting.address, undefined);
  }
});
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

test('manual Plaza link takes priority over a previous verified match', () => {
  const plazaUrl = 'https://www.google.com/maps/place/1+Paseo+de+San+Antonio,+San+Jose,+CA+95113/@37.3324736,-121.8917259,17z/data=!3m1!4b1!4m6!3m5!1s0x808fccbb21a50083:0x111e9bca34225304!8m2!3d37.3324736!4d-121.8891456!16s%2Fg%2F11t6ky0btp?entry=ttu';
  const manual = { type: 'maps', source: 'manual', confidence: 'candidate', url: plazaUrl };
  const venue = { links: [{ type: 'maps', confidence: 'verified', url }, manual] };
  assert.deepEqual(preferredMapsLinks(venue), [manual]);
  assert.equal(applyVerifiedMapCoordinates(venue), true);
  assert.deepEqual(venue.geo, { latitude: 37.3324736, longitude: -121.8891456 });
  assert.equal(venue.evidence[0].url, plazaUrl);
});

test('unresolved manual locations still block competing name searches', () => {
  for (const savedUrl of ['https://maps.app.goo.gl/example', 'https://www.google.com/maps/place/Plaza+Park', `${url}!3d38!4d-123`]) {
    const venue = { links: [{ type: 'maps', source: 'manual', url: savedUrl }] };
    assert.equal(preferredMapsLinks(venue).length, 1);
    assert.equal(applyVerifiedMapCoordinates(venue), false);
    assert.equal(venue.geo, undefined);
  }
});

test('rejected or unrelated manual links do not supply a location', () => {
  for (const link of [
    { type: 'maps', source: 'manual', confidence: 'rejected', url },
    { type: 'maps', source: 'manual', url: url.replace('www.google.com', 'example.com') }
  ]) {
    const venue = { links: [link] };
    assert.deepEqual(preferredMapsLinks(venue), []);
    assert.equal(applyVerifiedMapCoordinates(venue), false);
  }
});
