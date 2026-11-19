import type { MetadataRoute } from 'next';
import { site } from '@/config/site';

const pages = ['', '/privacy', '/terms', '/support', '/delete-account', '/press'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: path === '' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : 0.4
  }));
}
