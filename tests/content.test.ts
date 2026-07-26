import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;

const publicSlugs = [
  'about',
  'equipment-list',
  'faqs',
  'classes-events',
  'reservation-calendar',
  'membership',
  'calendar',
  'contact',
  'home',
  'digital-fabrication',
  'electronics',
  'electronics-info',
  'second-day',
  'fabrics-arts-and-crafts',
  'photography',
  'members',
  'guest-pass',
  'services-payment',
  'laser-cutter',
  'cnc-router',
  '3d-printing',
] as const;

const protectedSlugs = ['member-portal', 'membership2'] as const;

interface PageRecord {
  slug: string;
  path: string;
  title: string;
  navigationTitle: string;
  descriptionHtml: string;
  contentHtml: string;
  homepage: boolean;
  type: string;
  backgroundSource: unknown;
  mainImage: unknown;
  video: unknown;
  seo: {
    description: string;
    canonical: string | null;
    noindex: boolean;
  };
  indexSections: Array<{
    slug: string;
    path: string;
    title: string;
    navigationTitle: string;
    descriptionHtml: string;
    contentHtml: string;
    type: string;
    backgroundSource: unknown;
    mainImage: unknown;
    video: unknown;
  }>;
}

interface NavigationItem {
  label: string;
  href: string;
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

function archivedAssetForUrl(
  url: string,
  assets: Array<{ sourceUrl: string; localPath: string }>,
): string | undefined {
  let candidate: URL;
  try {
    candidate = new URL(url.replaceAll('&amp;', '&'));
  } catch {
    return undefined;
  }

  return assets.find(({ sourceUrl }) => {
    const archived = new URL(sourceUrl);
    return (
      decodeURIComponent(candidate.pathname) === decodeURIComponent(archived.pathname) ||
      decodeURIComponent(candidate.pathname).replaceAll('+', ' ') ===
        decodeURIComponent(archived.pathname).replaceAll('+', ' ')
    );
  })?.localPath;
}

describe('generated public content', () => {
  it('contains exactly the 21 enabled, public JSON collections with unique slugs', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const slugs = pages.map(({ slug }) => slug);

    expect(pages).toHaveLength(21);
    expect(new Set(slugs).size).toBe(21);
    expect(slugs).toEqual(publicSlugs);
    expect(slugs).not.toContain('member-portal');
    expect(slugs).not.toContain('membership2');
  });

  it('preserves the normalized rendering and SEO fields for every page', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');

    for (const page of pages) {
      expect(page.path).toBe(page.homepage ? '/' : `/${page.slug}`);
      expect(typeof page.title).toBe('string');
      expect(typeof page.navigationTitle).toBe('string');
      expect(typeof page.descriptionHtml).toBe('string');
      expect(typeof page.contentHtml).toBe('string');
      expect(typeof page.homepage).toBe('boolean');
      expect(typeof page.type).toBe('string');
      expect(page).toHaveProperty('backgroundSource');
      expect(page).toHaveProperty('mainImage');
      expect(page).toHaveProperty('video');
      expect(typeof page.seo.description).toBe('string');
      expect(page.seo.canonical === null || typeof page.seo.canonical === 'string').toBe(true);
      expect(typeof page.seo.noindex).toBe('boolean');
      expect(Array.isArray(page.indexSections)).toBe(true);
    }
  });

  it('preserves the home index child sections in source order', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const source = readJson<{ collection: { collections: Array<{ urlId: string }> } }>(
      'research/admin-pages/home/squarespace.json',
    );
    const home = pages.find(({ slug }) => slug === 'home');

    expect(home?.homepage).toBe(true);
    expect(home?.indexSections.length).toBeGreaterThan(0);
    expect(home?.indexSections.map(({ slug }) => slug)).toEqual(
      source.collection.collections.map(({ urlId }) => urlId),
    );
  });

  it('excludes every disabled, archived, non-JSON, and protected collection', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const report = readJson<{
      pages: Array<{
        slug: string;
        enabled: boolean;
        passwordProtected: boolean;
        captureKind: string;
      }>;
    }>('research/capture-report.json');
    const excluded = report.pages
      .filter(
        (page) => !page.enabled || page.passwordProtected || page.captureKind !== 'json',
      )
      .map(({ slug }) => slug);

    expect(pages.every(({ slug }) => !excluded.includes(slug))).toBe(true);
  });
});

describe('navigation, site settings, and redirects', () => {
  it('uses the exact main and footer navigation order', () => {
    const navigation = readJson<{ main: NavigationItem[]; footer: NavigationItem[] }>(
      'src/data/navigation.json',
    );

    expect(navigation.main).toEqual([
      { label: 'About', href: '/about' },
      { label: 'Equipment', href: '/equipment-list' },
      { label: 'FAQs', href: '/faqs' },
      { label: 'Wiki', href: 'https://wiki.fatcatfablab.org/wiki/Main_Page' },
      { label: 'Classes & Events', href: '/classes-events' },
      { label: 'Reservation Calendar', href: '/reservation-calendar' },
      { label: 'Member Portal', href: '/member-portal' },
      { label: 'Join', href: '/membership' },
    ]);
    expect(navigation.footer).toEqual([
      { label: 'Member portal', href: '/member-portal' },
      { label: 'Equipment', href: '/equipment-list' },
      { label: 'Calendar', href: '/calendar' },
      { label: 'Contact', href: '/contact' },
    ]);
  });

  it('preserves required site identity, contact, social, analytics, and template data', () => {
    const site = readJson<Record<string, unknown>>('src/data/site.json');

    expect(site).toMatchObject({
      title: 'fat cat FAB LAB',
      fullTitle: 'Fat Cat Fab Lab - NYC Hackerspace',
      email: 'info@fatcatfablab.org',
      locale: 'en-US',
      timezone: 'America/New_York',
      logoAsset: '/assets/e07c9f0e7006-Fat-Cat-Fab-Lab---Logo-Final.png',
      faviconAsset: '/assets/097091c1b730-favicon.ico',
      address: {
        line1: '224 West 4th Street',
        line2: 'New York, NY, 10014',
      },
      socialUrls: [
        'http://instagram.com/fatcatfablab',
        'https://www.facebook.com/fatcatFABLAB',
        'https://twitter.com/fatcatFABLAB',
      ],
      analyticsIds: ['UA-83126816-1'],
      template: { family: 'Bedford', variant: 'Anya & Deven', version: '7.0' },
    });
    expect(typeof site.description).toBe('string');
    expect((site.description as string).length).toBeGreaterThan(0);
  });

  it('records the legacy classes redirect and the empty Squarespace mapping source', () => {
    const redirects = readJson<{
      redirects: Array<{ from: string; to: string; status: number }>;
      squarespaceUrlMappings: unknown[];
    }>('src/data/redirects.json');

    expect(redirects.redirects).toContainEqual({
      from: '/classes',
      to: '/classes-events',
      status: 301,
    });
    expect(redirects.squarespaceUrlMappings).toEqual([]);
  });
});

describe('protected content isolation', () => {
  it('writes exactly two protected records only to the ignored private artifact', () => {
    const protectedPages = readJson<Array<{ slug: string; contentHtml: string }>>(
      'private-content/protected-pages.json',
    );

    expect(protectedPages.map(({ slug }) => slug)).toEqual(protectedSlugs);
    expect(protectedPages.every(({ contentHtml }) => contentHtml.length > 0)).toBe(true);
  });

  it('does not copy protected page bodies or substantial protected phrases under src or public', () => {
    const protectedSources = protectedSlugs.map((slug) =>
      readJson<{ mainContent?: string }>(`research/admin-pages/${slug}/squarespace.json`),
    );
    const publicText = walkFiles(join(root, 'src'))
      .concat(walkFiles(join(root, 'public')))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    for (const source of protectedSources) {
      const body = source.mainContent?.trim();
      if (!body) continue;
      if (publicText.includes(body)) throw new Error('Protected page body leaked into public files');

      const phrases = body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .match(/.{80,160}(?:\s|$)/g) ?? [];
      if (phrases.some((phrase) => publicText.includes(phrase.trim()))) {
        throw new Error('Protected page phrase leaked into public files');
      }
    }
  });
});

describe('local asset migration', () => {
  it('copies every archived asset with byte-for-byte integrity', () => {
    const manifest = readJson<{
      assets: Array<{ localPath: string; sha256: string }>;
    }>('research/assets/manifest.json');

    expect(manifest.assets.length).toBeGreaterThan(0);
    for (const asset of manifest.assets) {
      const publicPath = join(root, 'public/assets', basename(asset.localPath));
      expect(existsSync(publicPath)).toBe(true);
      const digest = createHash('sha256').update(readFileSync(publicPath)).digest('hex');
      expect(digest).toBe(asset.sha256);
    }
  });

  it('rewrites every first-party Squarespace content image URL to its local asset', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const manifest = readJson<{
      assets: Array<{ sourceUrl: string; localPath: string }>;
    }>('research/assets/manifest.json');
    const generated = JSON.stringify(pages);

    expect(generated).not.toMatch(/https?:\\?\/\\?\/images\.squarespace-cdn\.com\\?\/content\\?\/v1/i);

    for (const slug of publicSlugs) {
      const sourceText = readFileSync(
        join(root, `research/admin-pages/${slug}/squarespace.json`),
        'utf8',
      );
      const urls =
        sourceText.match(
          /https?:\\?\/\\?\/images\.squarespace-cdn\.com\\?\/content\\?\/v1\\?\/[^"'<>\\\s]+/gi,
        ) ?? [];
      for (const rawUrl of urls) {
        const url = rawUrl.replaceAll('\\/', '/').replace(/[),;]+$/, '');
        const localPath = archivedAssetForUrl(url, manifest.assets);
        expect(localPath, `missing archived mapping for a public image on ${slug}`).toBeDefined();
        expect(generated).toContain(`/assets/${basename(localPath!)}`);
      }
    }
  });

  it('ensures every local asset referenced by public generated data exists', () => {
    const generated = ['pages.json', 'site.json']
      .map((file) => readFileSync(join(root, 'src/data', file), 'utf8'))
      .join('\n');
    const references = [...generated.matchAll(/\/assets\/[^"'()<>\\\s]+/g)].map(
      ([asset]) => asset,
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of new Set(references)) {
      expect(existsSync(join(root, 'public', reference))).toBe(true);
    }
  });
});

describe('typed content helpers', () => {
  it('lists the generated pages and fetches one by slug without a second data source', async () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const { getPublicPageBySlug, listPublicPages } = await import('../src/lib/content');

    expect(listPublicPages()).toEqual(pages);
    expect(getPublicPageBySlug('about')).toEqual(pages[0]);
    expect(getPublicPageBySlug('does-not-exist')).toBeUndefined();
  });
});
