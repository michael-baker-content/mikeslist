import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('repeated artist imports preserve Spotify images, opt-outs and manual review metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikeslist-artist-import-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'data'));
    for (const file of ['build-artist-store.mjs', 'build-public-artist-store.mjs', 'file-io.mjs']) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(root, 'scripts', file));
    }
    const reviewed = {
      id: 'reviewed', name: 'Reviewed', links: [], genres: [],
      spotifyImageUrl: 'https://i.scdn.co/image/saved-image',
      spotifyMatch: { id: 'saved-match', source: 'manual-link' },
      manuallyReviewed: true, manuallyReviewedAt: '2026-09-14T00:00:00Z',
      reviewNotes: 'Keep this review', customReviewField: 'preserve future fields'
    };
    const disabled = { id: 'disabled', name: 'Disabled', links: [], spotifyLookupDisabled: true };
    const absent = { id: 'absent', name: 'Absent', links: [], spotifyImageUrl: 'https://i.scdn.co/image/absent' };
    await writeFile(join(root, 'data/artists.js'), `window.SHOW_EXPLORER_ARTISTS = ${JSON.stringify({ artists: { reviewed, disabled, absent } })};`);
    await writeFile(join(root, 'data/imported-events.js'), `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify([
      { id: 'show', date: '2026-09-20', venue: 'Venue', artists: [{ name: 'Reviewed' }, { name: 'Disabled' }] }
    ])};`);
    for (let pass = 0; pass < 2; pass++) execFileSync(process.execPath, [join(root, 'scripts/build-artist-store.mjs')]);
    const readStore = async file => JSON.parse((await readFile(join(root, 'data', file), 'utf8')).split(' = ')[1].trim().replace(/;$/, ''));
    const store = await readStore('artists.js');
    for (const key of ['spotifyImageUrl', 'spotifyMatch', 'manuallyReviewed', 'manuallyReviewedAt', 'reviewNotes', 'customReviewField']) {
      assert.deepEqual(store.artists.reviewed[key], reviewed[key]);
    }
    assert.equal(store.artists.disabled.spotifyLookupDisabled, true);
    assert.equal(store.artists.absent.spotifyImageUrl, absent.spotifyImageUrl);
    execFileSync(process.execPath, [join(root, 'scripts/build-public-artist-store.mjs')]);
    const publicStore = await readStore('public-artists.js');
    assert.equal(publicStore.artists.reviewed.spotifyImageUrl, reviewed.spotifyImageUrl);
    assert.equal(publicStore.artists.disabled.spotifyImageUrl, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
