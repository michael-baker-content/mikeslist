import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './content/mike-says' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().default(''),
    ogImage: z.string().refine(value => /^\/(?!\/)/.test(value) || /^https:\/\//.test(value), 'Use a site-root path or HTTPS URL').optional(),
    ogImageAlt: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
      const parsed = new Date(`${value}T12:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Use a valid YYYY-MM-DD date').optional(),
    draft: z.boolean().default(true),
    spotifyPlaylist: z.string().regex(/^https:\/\/open\.spotify\.com\/(?:embed\/)?playlist\/[a-zA-Z0-9]+\/?(?:\?[^\s]*)?$/).optional(),
  }),
});

export const collections = { posts };
