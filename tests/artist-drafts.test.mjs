import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/artist-drafts.js', import.meta.url), 'utf8');
function setup(storage = new Map()) {
  const nodes = {};
  const container = () => ({ children: [], replaceChildren() { this.children = []; }, append(row) { this.children.push(row); } });
  const fields = { links: container(), rejectedLinks: container(), rejectedCount: {}, rejectedSection: {}, saveStatus: {} };
  for (const name of ['confidence', 'displayName', 'locality', 'genres', 'imageUrl', 'imageSource', 'spotifyLookupDisabled', 'summary', 'note']) {
    fields[name] = { type: name === 'spotifyLookupDisabled' ? 'checkbox' : 'text', value: '', checked: false };
  }
  function createLinkRow(link) {
    const controls = Object.fromEntries(Object.entries({ type: link.type, label: link.label, url: link.url, confidence: link.confidence, priority: link.displayPriority })
      .map(([key, value]) => [`.link-${key}`, { value }]));
    controls['.link-display'] = { checked: link.display };
    return { dataset: { linkSource: link.source }, querySelector: selector => controls[selector] };
  }
  const canonical = { id: 'one', name: 'Artist', summary: 'Saved summary' };
  const context = vm.createContext({
    fields, createLinkRow, state: { selectedId: 'one', query: '', fromDate: '' },
    artistStore: { artists: { one: canonical } },
    form: { querySelectorAll: () => [...fields.links.children, ...fields.rejectedLinks.children] },
    document: { querySelector: selector => nodes[selector] ||= { textContent: '' } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: () => { throw new Error('Draft protection must not call a network API'); }
  });
  vm.runInContext(source, context);
  return { context, fields, canonical, nodes, storage, createLinkRow };
}

test('typing backs up only to draft localStorage without mutating canonical data', () => {
  const { context, fields, canonical, storage } = setup();
  context.restoreArtistDraft(canonical);
  fields.summary.value = 'Unfinished summary';
  fields.spotifyLookupDisabled.checked = true;
  context.captureArtistDraft();
  assert.equal(canonical.summary, 'Saved summary');
  assert.equal(canonical.spotifyLookupDisabled, undefined);
  assert.ok(storage.has('mikes-list-artist-form-draft-v1:one'));
  assert.equal(storage.has('bay-area-show-explorer-artists'), false);
});

test('reload restores text, blank link rows, and explicit display choices', () => {
  const first = setup();
  first.context.restoreArtistDraft(first.canonical);
  first.fields.note.value = 'Research in progress';
  const row = first.createLinkRow({ type: 'official', label: '', url: '', confidence: 'candidate', display: false, displayPriority: 'secondary', source: 'manual' });
  row.dataset.displayOverride = 'true';
  first.fields.links.append(row);
  first.context.captureArtistDraft();
  const second = setup(first.storage);
  second.context.restoreArtistDraft(second.canonical);
  assert.equal(second.fields.note.value, 'Research in progress');
  assert.equal(second.fields.links.children[0].querySelector('.link-url').value, '');
  assert.equal(second.fields.links.children[0].dataset.displayOverride, 'true');
  assert.equal(second.canonical.summary, 'Saved summary');
});

test('a changed saved record produces a conflict warning without replacing it', () => {
  const first = setup();
  first.context.restoreArtistDraft(first.canonical);
  first.fields.summary.value = 'Draft summary';
  first.context.captureArtistDraft();
  const second = setup(first.storage);
  second.canonical.summary = 'Changed elsewhere';
  second.context.restoreArtistDraft(second.canonical);
  assert.match(second.nodes['#draftStatus'].textContent, /saved artist has changed/);
  assert.equal(second.fields.summary.value, 'Draft summary');
  assert.equal(second.canonical.summary, 'Changed elsewhere');
  assert.equal(second.context.requireSavedArtistDraft(), false);
});

async function wireSave(context, fetch) {
  const review = await readFile(new URL('../assets/review.js', import.meta.url), 'utf8');
  const save = review.match(/^async function saveCurrentArtist\(\) \{[^]*?^\}/m)[0];
  Object.assign(context, {
    structuredClone, fetch, window: { confirm: () => true },
    splitTaxonomyList: value => value.split(',').filter(Boolean),
    cleanImageSource: value => value,
    readLinkEditor: () => [], supportPriorityForLinks: () => [],
    markManuallyReviewed: artist => { artist.manuallyReviewed = true; },
    selectArtist: () => {}, updateSummary: () => {}
  });
  vm.runInContext(save, context);
}

test('explicit save includes only the chosen artist draft, not another browser draft', async () => {
  const env = setup();
  env.context.restoreArtistDraft(env.canonical);
  env.fields.summary.value = 'First artist private draft';
  env.context.captureArtistDraft();
  const other = { id: 'two', name: 'Second artist', summary: 'Saved second summary' };
  env.context.artistStore.artists.two = other;
  env.context.state.selectedId = 'two';
  env.fields.summary.value = other.summary;
  env.context.restoreArtistDraft(other);
  env.fields.summary.value = 'Explicitly saved second summary';
  const latest = { artists: { one: env.canonical, two: other } };
  let posted;
  await wireSave(env.context, async (_url, options) => {
    if (options.method === 'POST') { posted = JSON.parse(options.body); return { ok: true }; }
    return { ok: true, text: async () => `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify(latest)};` };
  });
  await env.context.saveCurrentArtist();
  assert.equal(posted.artists.one.summary, 'Saved summary');
  assert.equal(posted.artists.two.summary, 'Explicitly saved second summary');
  assert.ok(env.storage.has('mikes-list-artist-form-draft-v1:one'));
});

test('failed save leaves canonical data unchanged and keeps the browser draft', async () => {
  const env = setup();
  env.context.restoreArtistDraft(env.canonical);
  env.fields.summary.value = 'Do not lose this';
  await wireSave(env.context, async () => { throw new Error('Offline'); });
  await env.context.saveCurrentArtist();
  assert.equal(env.canonical.summary, 'Saved summary');
  assert.ok(env.storage.has('mikes-list-artist-form-draft-v1:one'));
  assert.equal(env.storage.has('bay-area-show-explorer-artists'), false);
});
