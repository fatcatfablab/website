import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
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
const sourceCaptureAvailable =
  existsSync(join(root, 'research/capture-report.json')) &&
  existsSync(join(root, 'research/assets/manifest.json')) &&
  publicSlugs.every((slug) =>
    existsSync(join(root, `research/admin-pages/${slug}/squarespace.json`)),
  ) &&
  protectedSlugs.every((slug) =>
    existsSync(join(root, `research/admin-pages/${slug}/squarespace.json`)),
  );
const privateArtifactAvailable = existsSync(join(root, 'private-content/protected-pages.json'));

interface PageRecord {
  slug: string;
  path: string;
  title: string;
  navigationTitle: string;
  descriptionHtml: string;
  contentHtml: string;
  stripeIntegration: { kind: 'pricing-table' | 'buy-button'; id: string } | null;
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

const htmlEntityMap: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
};

function decodeCommonEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.toLowerCase().startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return htmlEntityMap[code.toLowerCase()] ?? entity;
  });
}

function decodeCommonJsonEscapes(value: string): string {
  return value
    .replace(/\\u\{([\da-f]{1,6})\}/gi, (_escape, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([\da-f]{4})/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\x([\da-f]{2})/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\[nrtbf]/g, ' ')
    .replace(/\\([\\/"'])/g, '$1');
}

function normalizeProtectedText(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    decoded = decodeCommonEntities(decodeCommonJsonEscapes(decoded));
  }
  return decoded
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function gatherHtmlBearingValues(value: unknown, key?: string): string[] {
  if (typeof value === 'string') {
    return key === 'descriptionHtml' || key === 'contentHtml' ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => gatherHtmlBearingValues(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) =>
    gatherHtmlBearingValues(child, childKey),
  );
}

function substantialPhrases(value: string): string[] {
  const words = value.split(' ').filter(Boolean);
  const phrases: string[] = [];
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 12; end <= Math.min(words.length, start + 24); end += 1) {
      const phrase = words.slice(start, end).join(' ');
      if (phrase.length >= 80) {
        phrases.push(phrase);
        break;
      }
    }
  }
  return phrases;
}

function findProtectedContentLeak(
  publicRecords: unknown,
  protectedHtmlValues: string[],
): boolean {
  const publicText = gatherHtmlBearingValues(publicRecords)
    .map(normalizeProtectedText)
    .join(' ');

  return protectedHtmlValues.some((html) => {
    const protectedText = normalizeProtectedText(html);
    if (protectedText.length < 80) return false;
    return (
      publicText.includes(protectedText) ||
      substantialPhrases(protectedText).some((phrase) => publicText.includes(phrase))
    );
  });
}

function fingerprintGeneratedOutputs(projectRoot: string): string {
  const targets = [
    'src/data/pages.json',
    'src/data/navigation.json',
    'src/data/redirects.json',
    'src/data/site.json',
    'private-content/protected-pages.json',
    'public/assets',
  ];
  const hash = createHash('sha256');
  for (const target of targets) {
    const absolute = join(projectRoot, target);
    const files = statSync(absolute).isDirectory() ? walkFiles(absolute).sort() : [absolute];
    for (const file of files) {
      hash.update(relative(projectRoot, file));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
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

function renderableCollectionSource(
  collection: Record<string, unknown>,
  mainContent?: string,
): Record<string, unknown> {
  const children = Array.isArray(collection.collections)
    ? collection.collections.map((child) =>
        renderableCollectionSource(child as Record<string, unknown>),
      )
    : [];
  return {
    description: collection.description,
    mainContent: mainContent ?? collection.mainContent,
    mainImage: collection.mainImage,
    video: collection.video,
    seoDescription: (collection.seoData as { seoDescription?: unknown } | undefined)
      ?.seoDescription,
    collections: children,
  };
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

  it('removes captured scripts, event handlers, and editor/runtime data attributes before generation', () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const htmlValues = gatherHtmlBearingValues(pages);

    expect(htmlValues.length).toBeGreaterThan(0);
    for (const html of htmlValues) {
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/\sdata-(?!(?:instgrm-permalink|instgrm-version)\b)[\w:-]+\s*=/i);
      expect(html).not.toMatch(/(?:squarespace-cdn|static1\.squarespace)/i);
    }
  });

  it.skipIf(!sourceCaptureAvailable)(
    'preserves the home index child sections in source order',
    () => {
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
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'excludes every disabled, archived, non-JSON, and protected collection',
    () => {
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
    },
  );
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
      socialLogoAsset: '/assets/3777e916d67d-fcfl-tab-logo-square.png',
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
    if (sourceCaptureAvailable) {
      const report = readJson<{ site: { announcementBar: unknown } }>(
        'research/capture-report.json',
      );
      expect(site.announcementBar).toEqual(report.site.announcementBar);
      expect(site.provenance).toMatchObject({
        restrictedAssets: [
          {
            filename: '3f681ed1e8e1-format-google-calendar.js',
            contentType: 'text/javascript',
            reason: 'embedded-google-api-credential',
          },
        ],
      });
      expect(existsSync(join(root, 'public/assets/3f681ed1e8e1-format-google-calendar.js'))).toBe(
        false,
      );
    }
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
  it('detects a substantial protected phrase after structural and textual normalization', () => {
    const protectedBody = `
      <main>
        This private orientation explains how active members securely access shared workshop tools,
        coordinate after-hours responsibilities, and protect community equipment from accidental damage.
        Additional private instructions continue beyond the identifying phrase.
      </main>
    `;
    const publicRecords = [
      {
        descriptionHtml: '',
        contentHtml: '',
        indexSections: [
          {
            descriptionHtml:
              '<p>THIS PRIVATE ORIENTATION explains how active members securely access shared workshop tools,</p>' +
              '<p>coordinate after-hours responsibilities, and protect community equipment from accidental\\u0020damage.</p>',
            contentHtml: '',
            indexSections: [],
          },
        ],
      },
    ];

    expect(findProtectedContentLeak(publicRecords, [protectedBody])).toBe(true);
  });

  it.skipIf(!privateArtifactAvailable)(
    'writes exactly two protected records only to the ignored private artifact',
    () => {
      const protectedPages = readJson<Array<{ slug: string; contentHtml: string }>>(
        'private-content/protected-pages.json',
      );

      expect(protectedPages.map(({ slug }) => slug)).toEqual(protectedSlugs);
      expect(protectedPages.every(({ contentHtml }) => contentHtml.length > 0)).toBe(true);
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'flags an entire protected body injected into a public HTML-bearing field',
    () => {
      const pages = structuredClone(readJson<PageRecord[]>('src/data/pages.json'));
      const protectedBody = readJson<{ mainContent?: string }>(
        'research/admin-pages/member-portal/squarespace.json',
      ).mainContent;
      expect(protectedBody?.trim().length).toBeGreaterThan(0);
      pages[0].contentHtml = protectedBody!;

      expect(findProtectedContentLeak(pages, [protectedBody!])).toBe(true);
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'detects no normalized protected body or substantial phrase in generated public records',
    () => {
      const pages = readJson<PageRecord[]>('src/data/pages.json');
      const protectedBodies = protectedSlugs
        .map(
          (slug) =>
            readJson<{ mainContent?: string }>(
              `research/admin-pages/${slug}/squarespace.json`,
            ).mainContent,
        )
        .filter((body): body is string => Boolean(body?.trim()));

      if (findProtectedContentLeak(pages, protectedBodies)) {
        throw new Error('Protected page content leaked into generated public records');
      }
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'keeps protected content out of src and public client files',
    () => {
      const protectedBodies = protectedSlugs
        .map(
          (slug) =>
            readJson<{ mainContent?: string }>(
              `research/admin-pages/${slug}/squarespace.json`,
            ).mainContent,
        )
        .filter((body): body is string => Boolean(body?.trim()));
      const publicClientText = [join(root, 'src'), join(root, 'public')]
        .flatMap(walkFiles)
        .filter((file) => /\.(?:astro|css|html|js|json|mjs|ts|tsx)$/i.test(file))
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');

      if (findProtectedContentLeak([{ contentHtml: publicClientText }], protectedBodies)) {
        throw new Error('Protected page content leaked into src or public client files');
      }
    },
  );
});

describe('transactional content generation', () => {
  it.skipIf(!sourceCaptureAvailable)(
    'preserves every last-known-good generated byte when source asset validation fails',
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), 'fatcat-content-generation-'));
      try {
        mkdirSync(join(sandbox, 'scripts'), { recursive: true });
        cpSync(
          join(root, 'scripts/generate-site-content.mjs'),
          join(sandbox, 'scripts/generate-site-content.mjs'),
        );
        cpSync(join(root, 'research'), join(sandbox, 'research'), { recursive: true });
        cpSync(join(root, 'src/data'), join(sandbox, 'src/data'), { recursive: true });
        cpSync(join(root, 'public/assets'), join(sandbox, 'public/assets'), { recursive: true });
        cpSync(
          join(root, 'private-content'),
          join(sandbox, 'private-content'),
          { recursive: true },
        );

        const manifest = readJson<{ assets: Array<{ localPath: string }> }>(
          'research/assets/manifest.json',
        );
        rmSync(join(sandbox, manifest.assets[0].localPath));
        const before = fingerprintGeneratedOutputs(sandbox);

        const result = spawnSync(process.execPath, ['scripts/generate-site-content.mjs'], {
          cwd: sandbox,
          encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(fingerprintGeneratedOutputs(sandbox)).toBe(before);
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'rejects a protected-only binary asset before it can enter public output',
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), 'fatcat-protected-asset-'));
      try {
        mkdirSync(join(sandbox, 'scripts'), { recursive: true });
        cpSync(
          join(root, 'scripts/generate-site-content.mjs'),
          join(sandbox, 'scripts/generate-site-content.mjs'),
        );
        cpSync(join(root, 'research'), join(sandbox, 'research'), { recursive: true });
        cpSync(join(root, 'src/data'), join(sandbox, 'src/data'), { recursive: true });
        cpSync(join(root, 'public/assets'), join(sandbox, 'public/assets'), { recursive: true });
        cpSync(join(root, 'private-content'), join(sandbox, 'private-content'), { recursive: true });

        const manifest = readJson<{
          assets: Array<{ sourceUrl: string; localPath: string }>;
        }>('research/assets/manifest.json');
        const publicSources = publicSlugs
          .map((slug) =>
            readFileSync(join(root, `research/admin-pages/${slug}/squarespace.json`), 'utf8'),
          )
          .join('\n');
        const protectedOnlyCandidate = manifest.assets.find((asset) => {
          const pathname = new URL(asset.sourceUrl).pathname;
          return !publicSources.includes(asset.sourceUrl) && !publicSources.includes(pathname);
        });
        expect(protectedOnlyCandidate).toBeDefined();

        const protectedPath = join(
          sandbox,
          'research/admin-pages/member-portal/squarespace.json',
        );
        const protectedSource = JSON.parse(readFileSync(protectedPath, 'utf8')) as {
          mainContent: string;
        };
        protectedSource.mainContent += `<img src="${protectedOnlyCandidate!.sourceUrl}">`;
        writeFileSync(protectedPath, JSON.stringify(protectedSource));
        const before = fingerprintGeneratedOutputs(sandbox);

        const result = spawnSync(process.execPath, ['scripts/generate-site-content.mjs'], {
          cwd: sandbox,
          encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain('Protected-only assets');
        expect(fingerprintGeneratedOutputs(sandbox)).toBe(before);
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'validates restricted manifest assets before replacing generated output',
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), 'fatcat-restricted-asset-'));
      try {
        mkdirSync(join(sandbox, 'scripts'), { recursive: true });
        cpSync(
          join(root, 'scripts/generate-site-content.mjs'),
          join(sandbox, 'scripts/generate-site-content.mjs'),
        );
        cpSync(join(root, 'research'), join(sandbox, 'research'), { recursive: true });
        cpSync(join(root, 'src/data'), join(sandbox, 'src/data'), { recursive: true });
        cpSync(join(root, 'public/assets'), join(sandbox, 'public/assets'), { recursive: true });
        cpSync(join(root, 'private-content'), join(sandbox, 'private-content'), { recursive: true });

        const manifest = readJson<{ assets: Array<{ localPath: string }> }>(
          'research/assets/manifest.json',
        );
        const restrictedAsset = manifest.assets.find(({ localPath }) =>
          localPath.endsWith('format-google-calendar.js'),
        );
        expect(restrictedAsset).toBeDefined();
        rmSync(join(sandbox, restrictedAsset!.localPath));
        const before = fingerprintGeneratedOutputs(sandbox);

        const result = spawnSync(process.execPath, ['scripts/generate-site-content.mjs'], {
          cwd: sandbox,
          encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(fingerprintGeneratedOutputs(sandbox)).toBe(before);
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );
});

describe('local asset migration', () => {
  it('publishes exactly the assets referenced by generated public data', () => {
    const assets = readdirSync(join(root, 'public/assets')).sort();
    const generated = ['pages.json', 'site.json', 'navigation.json']
      .map((file) => readFileSync(join(root, 'src/data', file), 'utf8'))
      .join('\n');
    const references = [...generated.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)]
      .map((match) => match[1])
      .filter((filename, index, all) => all.indexOf(filename) === index)
      .sort();

    expect(assets).toEqual(references);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((asset: string) => !asset.startsWith('.generate-site-content-'))).toBe(true);
  });

  it.skipIf(!sourceCaptureAvailable)(
    'copies every published asset with byte-for-byte integrity',
    () => {
      const manifest = readJson<{
        assets: Array<{ localPath: string; sha256: string }>;
      }>('research/assets/manifest.json');
      const manifestByFilename = new Map(
        manifest.assets.map((asset) => [basename(asset.localPath), asset]),
      );
      const published = readdirSync(join(root, 'public/assets'));

      expect(published.length).toBeGreaterThan(0);
      for (const filename of published) {
        const asset = manifestByFilename.get(filename);
        expect(asset, `missing manifest provenance for ${filename}`).toBeDefined();
        const publicPath = join(root, 'public/assets', filename);
        const digest = createHash('sha256').update(readFileSync(publicPath)).digest('hex');
        expect(digest).toBe(asset!.sha256);
      }
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'rewrites every first-party Squarespace content image URL to its local asset',
    () => {
      const pages = readJson<PageRecord[]>('src/data/pages.json');
      const manifest = readJson<{
        assets: Array<{ sourceUrl: string; localPath: string }>;
      }>('research/assets/manifest.json');
      const generated = JSON.stringify(pages);

      expect(generated).not.toMatch(
        /https?:\\?\/\\?\/images\.squarespace-cdn\.com\\?\/content\\?\/v1/i,
      );

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
    },
  );

  it.skipIf(!sourceCaptureAvailable)(
    'rewrites every manifest-backed first-party asset reference emitted into public data',
    () => {
      const pages = readJson<PageRecord[]>('src/data/pages.json');
      const manifest = readJson<{
        assets: Array<{ sourceUrl: string; localPath: string }>;
      }>('research/assets/manifest.json');
      const generated = JSON.stringify({
        pages,
        site: readJson<Record<string, unknown>>('src/data/site.json'),
      });
      const emittedSourceStrings: string[] = [];

      for (const slug of publicSlugs) {
        const source = readJson<{
          mainContent?: string;
          collection: Record<string, unknown>;
          website: { logoImageUrl?: string; socialLogoImageUrl?: string };
        }>(`research/admin-pages/${slug}/squarespace.json`);
        emittedSourceStrings.push(
          JSON.stringify(renderableCollectionSource(source.collection, source.mainContent)),
        );
        if (slug === 'about') {
          emittedSourceStrings.push(source.website.logoImageUrl ?? '');
          emittedSourceStrings.push(source.website.socialLogoImageUrl ?? '');
        }
      }

      const emittedSource = emittedSourceStrings.join('\n');
      for (const asset of manifest.assets) {
        const sourceUrl = new URL(asset.sourceUrl);
        const references = [
          asset.sourceUrl,
          sourceUrl.pathname,
          decodeURIComponent(sourceUrl.pathname).replaceAll('+', ' '),
        ];
        if (references.some((reference) => emittedSource.includes(reference))) {
          expect(generated).toContain(`/assets/${basename(asset.localPath)}`);
          for (const reference of references) {
            expect(generated).not.toContain(reference);
          }
        }
      }
    },
  );

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

  it('does not expose mutable module state to helper callers', async () => {
    const pages = readJson<PageRecord[]>('src/data/pages.json');
    const { getPublicPageBySlug, listPublicPages } = await import('../src/lib/content');

    const listed = listPublicPages();
    listed[0].title = 'mutated title';
    listed[0].seo.description = 'mutated description';
    listed.pop();

    const fetched = getPublicPageBySlug('about')!;
    fetched.navigationTitle = 'mutated navigation title';
    fetched.indexSections.splice(0);

    expect(listPublicPages()).toEqual(pages);
    expect(getPublicPageBySlug('about')).toEqual(pages[0]);
  });
});
