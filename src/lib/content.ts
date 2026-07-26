import pagesData from '../data/pages.json';

export interface ImageData {
  src: string | null;
  filename: string;
  title: string;
  altHtml: string;
  contentType: string;
  originalSize: string | null;
  focalPoint: {
    x: number | null;
    y: number | null;
    source: number | null;
  } | null;
}

export interface VideoData {
  url: string | null;
  playbackSpeed: number | null;
  filter: number | null;
  filterStrength: number | null;
  zoom: number | null;
  fallbackImage: ImageData | null;
}

export interface SeoData {
  description: string;
  canonical: string | null;
  noindex: boolean;
}

export interface IndexSection {
  slug: string;
  path: string;
  title: string;
  navigationTitle: string;
  descriptionHtml: string;
  contentHtml: string;
  homepage: boolean;
  type: string;
  backgroundSource: number | null;
  mainImage: ImageData | null;
  video: VideoData | null;
  seo: SeoData;
  indexSections: IndexSection[];
}

export interface PublicPage extends IndexSection {}

const publicPages = pagesData as PublicPage[];

export function listPublicPages(): PublicPage[] {
  return publicPages;
}

export function getPublicPageBySlug(slug: string): PublicPage | undefined {
  return publicPages.find((page) => page.slug === slug);
}
