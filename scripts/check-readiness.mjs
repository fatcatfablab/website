import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

const MAX_PRIVATE_CONTENT_BYTES = 5 * 1024 * 1024;
const EXPECTED_SLUGS = new Set(["member-portal", "membership2"]);
const errors = [];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNullableString = (value) => value === null || typeof value === "string";
const isNullableNumber = (value) => value === null || typeof value === "number";
const isImage = (value) => {
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
      (isObject(focal) && isNullableNumber(focal.x) && isNullableNumber(focal.y) && isNullableNumber(focal.source)))
  );
};
const isNullableImage = (value) => value === null || isImage(value);
const isVideo = (value) =>
  isObject(value) &&
  isNullableString(value.url) &&
  isNullableNumber(value.playbackSpeed) &&
  isNullableNumber(value.filter) &&
  isNullableNumber(value.filterStrength) &&
  isNullableNumber(value.zoom) &&
  isNullableImage(value.fallbackImage);
const isSeo = (value) =>
  isObject(value) &&
  typeof value.description === "string" &&
  isNullableString(value.canonical) &&
  typeof value.noindex === "boolean";
function isIndexSection(value) {
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
}
const isProtectedPage = (value) =>
  isIndexSection(value) && EXPECTED_SLUGS.has(value.slug) && value.path === `/${value.slug}` && value.homepage === false;

const hash = process.env.FCFL_PROTECTED_PASSWORD_HASH ?? "";
if (!/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43}$/.test(hash)) {
  errors.push("FCFL_PROTECTED_PASSWORD_HASH is missing or unsupported");
}

const sessionSecret = process.env.FCFL_SESSION_SECRET ?? "";
if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
  errors.push("FCFL_SESSION_SECRET must contain at least 32 bytes");
}

const privatePath = process.env.FCFL_PRIVATE_CONTENT_PATH ?? "";
if (!privatePath || !isAbsolute(privatePath)) {
  errors.push("FCFL_PRIVATE_CONTENT_PATH must be an absolute path");
} else {
  try {
    const parent = await stat(dirname(privatePath));
    const metadata = await lstat(privatePath);
    const canonicalParent = await realpath(dirname(privatePath));
    const canonicalFile = await realpath(privatePath);
    if (!parent.isDirectory()) throw new Error("parent is not a directory");
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("target is not a regular file");
    if (metadata.size <= 0 || metadata.size > MAX_PRIVATE_CONTENT_BYTES) throw new Error("file size is invalid");
    if (!canonicalFile.startsWith(`${canonicalParent}/`)) throw new Error("target escapes its mount directory");

    const parsed = JSON.parse(await readFile(privatePath, "utf8"));
    if (!Array.isArray(parsed) || parsed.length !== EXPECTED_SLUGS.size || !parsed.every(isProtectedPage)) {
      throw new Error("content schema is invalid");
    }
    if (new Set(parsed.map((page) => page.slug)).size !== EXPECTED_SLUGS.size) {
      throw new Error("required pages are not unique");
    }
  } catch {
    errors.push("FCFL_PRIVATE_CONTENT_PATH is unavailable or has an invalid mount shape");
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`readiness: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("readiness: ok\n");
}
