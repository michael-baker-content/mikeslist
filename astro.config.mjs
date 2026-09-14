import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mikeslist.xyz',
  output: 'static',
  outDir: './dist',
  build: { format: 'file' },
});
