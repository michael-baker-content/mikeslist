import { copyFile, cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Astro owns dist. Copy only the existing site's public assets, never source,
// SQLite databases, private backups, or Markdown drafts.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
await mkdir(join(output, 'data'), { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html') && !entry.name.startsWith('mike-says')) {
    await copyFile(join(root, entry.name), join(output, entry.name));
  }
}
await cp(join(root, 'assets'), join(output, 'assets'), { recursive: true });
for (const file of ['artists.js', 'public-artists.js', 'venues.js', 'imported-events.js', 'review-suggestions.js']) {
  await copyFile(join(root, 'data', file), join(output, 'data', file));
}
console.log('Added existing Mike’s List pages and data to the Astro build.');
