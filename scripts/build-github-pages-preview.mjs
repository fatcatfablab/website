import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOrigin = "http://127.0.0.1:4321";
const protectedPaths = new Set(["/member-portal", "/membership2"]);
const publicRedirects = new Map([["/classes", "/classes-events"]]);

export function normalizeBasePath(value = "") {
  const trimmed = String(value).trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

export function rewriteHtmlForProjectPages(html, basePath) {
  const base = normalizeBasePath(basePath);
  let rewritten = String(html);

  for (const [from, to] of publicRedirects) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(
      new RegExp(`(href\\s*=\\s*["'])${escaped}(["'])`, "gi"),
      `$1${to}$2`,
    );
  }

  for (const path of protectedPaths) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(
      new RegExp(`(href\\s*=\\s*["'])${escaped}(["'])`, "gi"),
      `$1https://fatcatfablab.org${path}$2`,
    );
  }

  if (base) {
    rewritten = rewritten.replace(
      /(\b(?:href|src|action|poster|data-image|data-src)\s*=\s*["'])\/(?!\/)/gi,
      `$1${base}/`,
    );
    rewritten = rewritten.replace(/\bsrcset\s*=\s*(["'])([\s\S]*?)\1/gi, (_match, quote, value) => {
      const adjusted = value.replace(/(^|,\s*)\/(?!\/)/g, `$1${base}/`);
      return `srcset=${quote}${adjusted}${quote}`;
    });
    rewritten = rewritten.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${base}/`);
  }

  if (!/<meta\s+name=["']robots["']/i.test(rewritten)) {
    rewritten = rewritten.replace(
      /<head(\s[^>]*)?>/i,
      (head) => `${head}\n<meta name="robots" content="noindex, nofollow, noarchive">`,
    );
  }

  return rewritten;
}

export function routeOutputPath(route) {
  const cleaned = route.replace(/^\/+|\/+$/g, "");
  return cleaned ? join(cleaned, "index.html") : "index.html";
}

async function readPublicRoutes() {
  const pages = JSON.parse(await readFile(join(root, "src/data/pages.json"), "utf8"));
  return [...new Set(["/", "/home", ...pages.map((page) => page.path)])]
    .filter((path) => path && !protectedPaths.has(path))
    .sort((left, right) => (left === "/" ? -1 : right === "/" ? 1 : left.localeCompare(right)));
}

async function fetchHtml(origin, route) {
  const response = await fetch(new URL(route, origin), {
    headers: { "user-agent": "fcfl-github-pages-preview-builder/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error(`${route} returned ${contentType || "no content type"}`);
  return response.text();
}

export async function buildPagesPreview({
  origin = process.env.PREVIEW_ORIGIN || defaultOrigin,
  basePath = process.env.PAGES_BASE_PATH || "/website",
  output = process.env.PREVIEW_OUTPUT || join(root, "dist-pages"),
} = {}) {
  const client = join(root, "dist/client");
  const routes = await readPublicRoutes();
  const normalizedBase = normalizeBasePath(basePath);

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(client, output, { recursive: true });

  const captured = [];
  for (const route of routes) {
    const html = rewriteHtmlForProjectPages(await fetchHtml(origin, route), normalizedBase);
    const destination = join(output, routeOutputPath(route));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html);
    captured.push(route);
  }

  await writeFile(join(output, ".nojekyll"), "");
  await writeFile(
    join(output, "preview-manifest.json"),
    `${JSON.stringify({
      basePath: normalizedBase,
      commit: process.env.PREVIEW_SOURCE_SHA || process.env.GITHUB_SHA || null,
      generatedAt: new Date().toISOString(),
      routes: captured,
    }, null, 2)}\n`,
  );

  process.stdout.write(`GitHub Pages preview: wrote ${captured.length} public routes to ${output}\n`);
  return { routes: captured, output, basePath: normalizedBase };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPagesPreview();
}
