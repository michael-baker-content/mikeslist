import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('venue markers show details on hover, focus and click without bubbling a closing map click', async () => {
  const source = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
  const extract = name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const handlers = new Map();
  let opened = 0;
  let html = '';
  let coordinates;
  const map = {};
  const popup = {
    setLngLat(value) { coordinates = [...value]; return this; },
    setHTML(value) { html = value; return this; },
    addTo(value) { assert.equal(value, map); opened++; return this; }
  };
  const context = vm.createContext({ mapLibrePopup: popup, mapLibreMap: map });
  vm.runInContext(['bindVenueMarkerPopup', 'venueMapPopupContent', 'displayNameForVenue', 'escapeHtml'].map(extract).join('\n'), context);
  context.bindVenueMarkerPopup({ addEventListener: (type, handler) => handlers.set(type, handler) }, {
    id: 'plaza', displayName: 'Plaza Park', city: 'San Jose', region: 'South Bay', showCount: 2,
    geo: { latitude: 37.3324736, longitude: -121.8891456 }
  });
  handlers.get('mouseenter')();
  handlers.get('focus')();
  let stopped = false;
  handlers.get('click')({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(opened, 3);
  assert.deepEqual(coordinates, [-121.8891456, 37.3324736]);
  assert.match(html, /Plaza Park/);
  assert.match(html, /San Jose/);
  assert.match(html, /2 shows/);
  assert.match(html, /venue\.html\?id=plaza/);
});
