import { getCollection } from 'astro:content';

export async function publishedPosts() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const posts = await getCollection('posts', ({ data }) => !data.draft && (!data.date || data.date <= today));
  return posts.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || a.id.localeCompare(b.id));
}

export const postUrl = (id: string) => `/mike-says/${encodeURIComponent(id)}.html`;
export const displayDate = (date?: string) => date
  ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  : 'Introductory note';
