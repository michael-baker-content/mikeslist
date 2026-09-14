import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Evaluate function declarations without running import scripts against real data.
async function functionsFrom(file, globals = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const declarations = [...source.matchAll(/^(?:async )?function \w+\([^]*?^\}/gm)].map(match => match[0]);
  const context = vm.createContext({ structuredClone, URL, ...globals });
  vm.runInContext(declarations.join('\n'), context);
  return context;
}

const manual = () => ({
  id: 'manual-test', manuallyCreated: true, date: '2026-09-20', venue: 'Hall',
  showType: 'artist', title: 'My title', details: 'My notes',
  artists: [{ name: 'Stay Out', links: [] }], sources: []
});
const imported = () => ({
  ...manual(), id: 'import-test', manuallyCreated: undefined,
  infoUrl: 'https://example.com/tickets',
  source: { name: 'The List', url: 'https://jon.luini.com/thelist/date.html' }
});

test('venue suggestions include likely and verified names and aliases', async () => {
  const api = await functionsFrom('assets/event-review.js');
  const names = api.venueSuggestionNames({
    bric: { name: 'Bric-a-Brac', confidence: 'likely' },
    hall: { name: 'Hall', displayName: 'The Hall', aliases: ['Hall Alias'], confidence: 'verified' },
    rejected: { name: 'Rejected', confidence: 'rejected' },
    merged: { name: 'Merged', confidence: 'likely', mergedInto: 'hall' }
  });
  assert.deepEqual(Array.from(names), ['Bric-a-Brac', 'Hall', 'Hall Alias', 'The Hall']);
});

test('Mike attribution survives normalization, merge, and imports', async () => {
  const api = await functionsFrom('assets/event-review.js');
  const target = api.normalizeEventRecord(manual());
  api.mergeEventData(target, imported());
  assert.equal(target.source.name, 'Mike');
  assert.ok(target.sources.some(source => source.name === 'Mike' && source.url === ''));
  assert.ok(target.sources.some(source => source.name === 'The List'));
  for (const importer of ['import-thelist.mjs', 'import-kalx.mjs']) {
    const importerApi = await functionsFrom(`scripts/${importer}`);
    const [retained] = importerApi.mergeEvents([target], []);
    assert.equal(retained.source.name, 'Mike');
    assert.ok(retained.sources.some(source => source.name === 'Mike'));
  }
});

for (const importer of ['import-thelist.mjs', 'import-kalx.mjs']) {
  test(`${importer} keeps a matching manual show separate, including repeated imports`, async () => {
    const api = await functionsFrom(`scripts/${importer}`);
    const result = api.mergeEvents([manual()], [imported()]);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'manual-test');
    assert.equal(result[0].infoUrl, undefined);
    assert.equal(api.mergeEvents(result, [imported()]).length, 2);
  });
}

test('manual merge preserves authored text and fills missing data', async () => {
  const api = await functionsFrom('assets/event-review.js');
  const target = manual();
  const incoming = { ...imported(), title: 'Imported title', details: 'Imported notes',
    artists: [{ name: 'Stay out', links: [] }, { name: 'Support', links: [] }] };
  api.mergeEventData(target, incoming);
  assert.equal(target.title, 'My title');
  assert.equal(target.details, 'My notes');
  assert.equal(target.artists[0].name, 'Stay Out');
  assert.equal(target.artists.length, 2);
  assert.equal(target.infoUrl, incoming.infoUrl);
  assert.equal(target.sources.length, 1);
});

test('suppression retains saved canonical shows but respects explicit deletion', async () => {
  const exactIds = new Set(['import-test']);
  const exactOverrides = new Map([['manual-test', {}]]);
  const api = await functionsFrom('scripts/apply-sqlite-decisions.mjs', { exactIds, exactOverrides });
  assert.equal(api.isSuppressed(manual()), false);
  assert.equal(api.isSuppressed(imported()), true);
  exactIds.add('manual-test');
  assert.equal(api.isSuppressed(manual()), true);
});
