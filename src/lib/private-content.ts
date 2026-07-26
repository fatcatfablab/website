import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ImageData, IndexSection, PublicPage, SeoData, VideoData } from "./content";

const PROTECTED_SLUGS = new Set(["member-portal", "membership2"]);
const MAX_PRIVATE_CONTENT_BYTES = 5 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown) => value === null || typeof value === "string";
const isNullableNumber = (value: unknown) => value === null || typeof value === "number";

const isImage = (value: unknown): value is ImageData => {
  if (!isObject(value)) return false;
  const focal = value.focalPoint;
  return (
    isNullableString(value.src) &&
    typeof value.filename === "string" &&
    typeof value.title === "string" &&
    typeof value.altHtml === "string" &&
    typeof value.contentType === "string" &&
    isNullableString(value.originalSize) &&
    (focal === null ||
      (isObject(focal) &&
        isNullableNumber(focal.x) &&
        isNullableNumber(focal.y) &&
        isNullableNumber(focal.source)))
  );
};

const isNullableImage = (value: unknown): value is ImageData | null => value === null || isImage(value);

const isVideo = (value: unknown): value is VideoData =>
  isObject(value) &&
  isNullableString(value.url) &&
  isNullableNumber(value.playbackSpeed) &&
  isNullableNumber(value.filter) &&
  isNullableNumber(value.filterStrength) &&
  isNullableNumber(value.zoom) &&
  isNullableImage(value.fallbackImage);

const isSeo = (value: unknown): value is SeoData =>
  isObject(value) &&
  typeof value.description === "string" &&
  isNullableString(value.canonical) &&
  typeof value.noindex === "boolean";

const isIndexSection = (value: unknown): value is IndexSection => {
  if (!isObject(value)) return false;
  return (
    typeof value.slug === "string" &&
    typeof value.path === "string" &&
    typeof value.title === "string" &&
    typeof value.navigationTitle === "string" &&
    typeof value.descriptionHtml === "string" &&
    typeof value.contentHtml === "string" &&
    typeof value.homepage === "boolean" &&
    typeof value.type === "string" &&
    isNullableNumber(value.backgroundSource) &&
    isNullableImage(value.mainImage) &&
    (value.video === null || isVideo(value.video)) &&
    isSeo(value.seo) &&
    Array.isArray(value.indexSections) &&
    value.indexSections.every(isIndexSection)
  );
};

const isProtectedPage = (value: unknown): value is PublicPage => {
  if (!isIndexSection(value)) return false;
  return PROTECTED_SLUGS.has(value.slug) && value.path === `/${value.slug}` && value.homepage === false;
};

const configuredPath = () =>
  process.env.FCFL_PRIVATE_CONTENT_PATH || resolve(process.cwd(), "private-content/protected-pages.json");

export async function loadPrivatePage(slug: "member-portal" | "membership2"): Promise<PublicPage> {
  const path = configuredPath();
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PRIVATE_CONTENT_BYTES) {
    throw new Error("Protected content is unavailable");
  }

  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== PROTECTED_SLUGS.size || !parsed.every(isProtectedPage)) {
    throw new Error("Protected content is unavailable");
  }
  if (new Set(parsed.map(({ slug: candidateSlug }) => candidateSlug)).size !== PROTECTED_SLUGS.size) {
    throw new Error("Protected content is unavailable");
  }

  const page = parsed.find(({ slug: candidateSlug }) => candidateSlug === slug);
  if (!page) throw new Error("Protected content is unavailable");
  return page;
}
