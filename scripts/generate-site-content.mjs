#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
];

const protectedSlugs = ['member-portal', 'membership2'];

const readJson = (relativePath) =>
  JSON.parse(readFileSync(join(root, relativePath), 'utf8'));

const writeJson = (relativePath, value, mode) => {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (mode) chmodSync(path, mode);
};

const report = readJson('research/capture-report.json');
const assetManifest = readJson('research/assets/manifest.json');
const reportBySlug = new Map(report.pages.map((page) => [page.slug, page]));

const assetByPathname = new Map(
  assetManifest.assets.map((asset) => {
    const url = new URL(asset.sourceUrl);
    return [decodeURIComponent(url.pathname).replaceAll('+', ' '), asset];
  }),
);

function localAssetForUrl(sourceUrl) {
  const normalized = sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl;
  const url = new URL(normalized.replaceAll('&amp;', '&'));
  const key = decodeURIComponent(url.pathname).replaceAll('+', ' ');
  const asset = assetByPathname.get(key);
  if (!asset) throw new Error('A first-party public image is missing from the asset archive');
  return `/assets/${basename(asset.localPath)}`;
}

const firstPartyImagePattern =
  /(?:https?:)?\/\/images\.squarespace-cdn\.com\/content\/v1\/[^"'<>\\\s)]+/gi;

function rewriteFirstPartyImages(value) {
  if (typeof value !== 'string' || value.length === 0) return value ?? '';
  return value.replace(firstPartyImagePattern, (url) => localAssetForUrl(url));
}

function normalizeMainImage(image) {
  if (!image) return null;
  return {
    src: image.assetUrl ? rewriteFirstPartyImages(image.assetUrl) : null,
    filename: image.filename ?? '',
    title: image.title ?? '',
    altHtml: rewriteFirstPartyImages(image.body ?? ''),
    contentType: image.contentType ?? '',
    originalSize: image.originalSize ?? null,
    focalPoint: image.mediaFocalPoint
      ? {
          x: image.mediaFocalPoint.x ?? null,
          y: image.mediaFocalPoint.y ?? null,
          source: image.mediaFocalPoint.source ?? null,
        }
      : null,
  };
}

function normalizeVideo(video) {
  if (!video) return null;
  return {
    url: video.url ?? null,
    playbackSpeed: video.playbackSpeed ?? null,
    filter: video.filter ?? null,
    filterStrength: video.filterStrength ?? null,
    zoom: video.zoom ?? null,
    fallbackImage: normalizeMainImage(video.videoFallbackContentItem),
  };
}

function seoDescriptionFor(collection, publicCapture) {
  const description =
    collection.seoData?.seoDescription ??
    publicCapture?.meta?.description ??
    collection.description ??
    '';
  return rewriteFirstPartyImages(description).trim();
}

function normalizeCollection(collection, mainContent, publicCapture, pathOverride) {
  const slug = collection.urlId;
  return {
    slug,
    path: pathOverride ?? (collection.homepage ? '/' : `/${slug}`),
    title: collection.title ?? '',
    navigationTitle: collection.navigationTitle ?? collection.title ?? '',
    descriptionHtml: rewriteFirstPartyImages(collection.description ?? ''),
    contentHtml: rewriteFirstPartyImages(mainContent ?? collection.mainContent ?? ''),
    homepage: Boolean(collection.homepage),
    type: collection.typeName ?? 'page',
    backgroundSource: collection.backgroundSource ?? null,
    mainImage: normalizeMainImage(collection.mainImage),
    video: normalizeVideo(collection.video),
    seo: {
      description: seoDescriptionFor(collection, publicCapture),
      canonical:
        publicCapture?.canonical ??
        (collection.homepage
          ? 'https://fatcatfablab.org'
          : `https://fatcatfablab.org/${slug}`),
      noindex: Boolean(collection.seoData?.seoHidden),
    },
    indexSections: [],
  };
}

function loadCapturedPage(slug) {
  return readJson(`research/admin-pages/${slug}/squarespace.json`);
}

function validatePublicSource(slug, source) {
  const capture = reportBySlug.get(slug);
  if (
    !capture ||
    !capture.enabled ||
    capture.passwordProtected ||
    capture.captureKind !== 'json' ||
    !source.collection?.enabled ||
    source.collection?.passwordProtected
  ) {
    throw new Error(`Public collection eligibility check failed for ${slug}`);
  }
  if (source.collection.urlId !== slug) {
    throw new Error(`Captured collection slug mismatch for ${slug}`);
  }
}

const pages = publicSlugs.map((slug) => {
  const source = loadCapturedPage(slug);
  validatePublicSource(slug, source);
  const capture = reportBySlug.get(slug)?.public;
  const page = normalizeCollection(
    source.collection,
    source.mainContent,
    capture,
    slug === 'home' ? '/' : undefined,
  );

  if (slug === 'home') {
    page.indexSections = (source.collection.collections ?? []).map((section) =>
      normalizeCollection(section, section.mainContent, undefined),
    );
  }

  return page;
});

if (pages.length !== 21 || new Set(pages.map(({ slug }) => slug)).size !== 21) {
  throw new Error('The generated public page set must contain 21 unique records');
}

const navigation = {
  main: [
    { label: 'About', href: '/about' },
    { label: 'Equipment', href: '/equipment-list' },
    { label: 'FAQs', href: '/faqs' },
    { label: 'Wiki', href: 'https://wiki.fatcatfablab.org/wiki/Main_Page' },
    { label: 'Classes & Events', href: '/classes-events' },
    { label: 'Reservation Calendar', href: '/reservation-calendar' },
    { label: 'Member Portal', href: '/member-portal' },
    { label: 'Join', href: '/membership' },
  ],
  footer: [
    { label: 'Member portal', href: '/member-portal' },
    { label: 'Equipment', href: '/equipment-list' },
    { label: 'Calendar', href: '/calendar' },
    { label: 'Contact', href: '/contact' },
  ],
};

const firstPublicSource = loadCapturedPage('about');
const website = firstPublicSource.website;
const location = website.location;
const analyticsIds = [
  ...new Set(report.pages.flatMap((page) => page.public?.analyticsIds ?? [])),
];

const site = {
  title: website.siteTitle,
  fullTitle: loadCapturedPage('home').collection.title,
  description: website.siteDescription,
  primaryDomain: website.primaryDomain,
  address: {
    title: location.addressTitle,
    line1: location.addressLine1,
    line2: location.addressLine2,
    country: location.addressCountry,
    latitude: location.markerLat,
    longitude: location.markerLng,
  },
  email: firstPublicSource.websiteSettings.contactEmail || 'info@fatcatfablab.org',
  socialUrls: website.socialAccounts
    .filter((account) => account.iconEnabled)
    .map((account) => account.profileUrl),
  logoAsset: localAssetForUrl(website.logoImageUrl),
  faviconAsset: `/assets/${basename(
    assetManifest.assets.find((asset) => basename(asset.localPath).endsWith('-favicon.ico'))
      ?.localPath ?? '',
  )}`,
  locale: website.language,
  timezone: website.timeZone,
  analyticsIds,
  template: {
    family: report.site.template.family,
    variant: report.site.template.variant,
    version: report.site.template.version,
  },
  provenance: {
    platform: 'Squarespace',
    siteId: report.site.id,
    internalUrl: report.site.internalUrl,
    templateFamily: report.site.template.family,
    templateVariant: report.site.template.variant,
    templateVersion: report.site.template.version,
  },
};

const redirects = {
  redirects: [{ from: '/classes', to: '/classes-events', status: 301 }],
  squarespaceUrlMappings: report.urlMappings,
};

const protectedPages = protectedSlugs.map((slug) => {
  const source = loadCapturedPage(slug);
  const capture = reportBySlug.get(slug);
  if (
    !capture?.passwordProtected ||
    !source.collection?.passwordProtected ||
    !source.mainContent
  ) {
    throw new Error(`Protected collection isolation check failed for ${slug}`);
  }
  return normalizeCollection(source.collection, source.mainContent, undefined);
});

const publicAssetsDirectory = join(root, 'public/assets');
rmSync(publicAssetsDirectory, { recursive: true, force: true });
mkdirSync(publicAssetsDirectory, { recursive: true });

for (const asset of assetManifest.assets) {
  const source = join(root, asset.localPath);
  const destination = join(publicAssetsDirectory, basename(asset.localPath));
  if (asset.status !== 200 || !statSync(source).isFile()) {
    throw new Error('An archived asset is unavailable');
  }
  const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
  if (digest !== asset.sha256) throw new Error('An archived asset failed integrity validation');
  copyFileSync(source, destination);
}

if (readdirSync(publicAssetsDirectory).length !== assetManifest.assets.length) {
  throw new Error('The public asset migration must contain every archived file');
}

writeJson('src/data/pages.json', pages);
writeJson('src/data/navigation.json', navigation);
writeJson('src/data/redirects.json', redirects);
writeJson('src/data/site.json', site);
writeJson('private-content/protected-pages.json', protectedPages, 0o600);

console.log(
  `Generated ${pages.length} public pages, ${protectedPages.length} isolated protected records, and ${assetManifest.assets.length} local assets.`,
);
