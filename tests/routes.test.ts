import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const pages = JSON.parse(source("src/data/pages.json")) as Array<{
  slug: string;
  path: string;
  title: string;
  descriptionHtml: string;
  contentHtml: string;
  homepage: boolean;
  mainImage: { src: string | null } | null;
  video: { url: string | null; fallbackImage: { src: string | null } | null } | null;
  seo: { description: string; canonical: string | null; noindex: boolean };
  indexSections: Array<{ slug: string }>;
}>;

const ownedProductionFiles = [
  "src/components/PageBanner.astro",
  "src/components/SquarespaceContent.astro",
  "src/components/IndexSection.astro",
  "src/templates/StandardPage.astro",
  "src/templates/HomePage.astro",
  "src/pages/index.astro",
  "src/pages/[...slug].astro",
  "src/pages/classes.ts",
  "src/styles/pages.css",
] as const;

const expectedPublicSlugs = [
  "about",
  "equipment-list",
  "faqs",
  "classes-events",
  "reservation-calendar",
  "membership",
  "calendar",
  "contact",
  "home",
  "digital-fabrication",
  "electronics",
  "electronics-info",
  "second-day",
  "fabrics-arts-and-crafts",
  "photography",
  "members",
  "guest-pass",
  "services-payment",
  "laser-cutter",
  "cnc-router",
  "3d-printing",
];

const expectedHomeSections = [
  "digital-fabrication",
  "electronics",
  "electronics-info",
  "second-day",
  "fabrics-arts-and-crafts",
  "photography",
  "members",
];

describe("public route inventory", () => {
  it("implements every public route artifact in the owned template surface", () => {
    for (const file of ownedProductionFiles) {
      expect(existsSync(resolve(root, file)), `${file} should exist`).toBe(true);
    }
  });

  it("renders exactly the 21 enabled public records from the generated content source", () => {
    expect(pages).toHaveLength(21);
    expect(pages.map(({ slug }) => slug)).toEqual(expectedPublicSlugs);
    expect(pages.filter(({ homepage }) => homepage).map(({ slug }) => slug)).toEqual(["home"]);
  });

  it("uses content.ts as the route-level public content API", () => {
    const indexRoute = source("src/pages/index.astro");
    const slugRoute = source("src/pages/[...slug].astro");

    expect(indexRoute).toContain("getPublicPageBySlug");
    expect(indexRoute).toContain('getPublicPageBySlug("home")');
    expect(slugRoute).toContain("getPublicPageBySlug");
    expect(`${indexRoute}\n${slugRoute}`).not.toMatch(/data\/pages\.json/);
    expect(`${indexRoute}\n${slugRoute}`).not.toMatch(/private-content|protected-pages/i);
  });

  it("maps both root and /home to the home template while routing all other public slugs", () => {
    const indexRoute = source("src/pages/index.astro");
    const slugRoute = source("src/pages/[...slug].astro");

    expect(indexRoute).toContain("<HomePage");
    expect(slugRoute).toContain('slug === "home"');
    expect(slugRoute).toContain("page.homepage");
    expect(slugRoute).toContain("<HomePage");
    expect(slugRoute).toContain("<StandardPage");
  });

  it("sets 404 for unknown, nested, disabled, and protected slugs without naming protected content", () => {
    const slugRoute = source("src/pages/[...slug].astro");

    expect(slugRoute).toMatch(/Astro\.response\.status\s*=\s*404/);
    expect(slugRoute).toMatch(/slug\.includes\(["']\/["']\)/);
    expect(slugRoute).not.toMatch(/member-portal|membership2|protected-pages|private-content/i);
  });
});

describe("legacy public template contracts", () => {
  it("passes exact page SEO fields plus page and body classes through BaseLayout", () => {
    const templates = `${source("src/templates/StandardPage.astro")}\n${source("src/templates/HomePage.astro")}`;

    expect(templates).toContain("title={page.title}");
    expect(templates).toContain("description={page.seo.description}");
    expect(templates).toContain("canonical={page.seo.canonical");
    expect(templates).toContain("noindex={page.seo.noindex}");
    expect(templates).toContain("pageClass=");
    expect(templates).toContain("bodyClass=");
  });

  it("marks only the captured utility/payment pages noindex", () => {
    expect(pages.filter(({ seo }) => seo.noindex).map(({ slug }) => slug)).toEqual([
      "guest-pass",
      "services-payment",
    ]);
  });

  it("recreates the captured banner structure with local focal images and raw descriptions", () => {
    const banner = source("src/components/PageBanner.astro");

    expect(banner).toContain("banner-thumbnail-wrapper");
    expect(banner).toContain("color-overlay");
    expect(banner).toMatch(/<figure\b/);
    expect(banner).toContain("content-fill");
    expect(banner).toContain("thumbnail");
    expect(banner).toContain("object-position");
    expect(banner).toContain("fallbackImage.src");
    expect(banner).toContain("desc-wrapper");
    expect(banner).toContain("set:html={descriptionHtml}");
  });

  it("renders captured block HTML verbatim beneath #content.main-content", () => {
    const blocks = source("src/components/SquarespaceContent.astro");

    expect(blocks).toMatch(/id\s*=\s*["']content["']/);
    expect(blocks).toContain("main-content");
    expect(blocks).toContain("set:html={contentHtml}");
  });

  it("renders all seven home sections in captured order with stable section IDs", () => {
    const home = pages.find(({ slug }) => slug === "home");
    const homeTemplate = source("src/templates/HomePage.astro");
    const section = source("src/components/IndexSection.astro");

    expect(home?.indexSections.map(({ slug }) => slug)).toEqual(expectedHomeSections);
    expect(homeTemplate).toMatch(/page\.indexSections\.map\s*\(/);
    expect(section).toContain("id={section.slug}");
    expect(section).toContain("data-url-id={section.slug}");
    expect(section).toContain("index-section");
    expect(section).toContain("index-section-wrapper");
    expect(section).toContain("content-inner");
  });

  it("uses privacy-enhanced YouTube backgrounds only for captured video URLs with a fallback image", () => {
    const banner = source("src/components/PageBanner.astro");
    const section = source("src/components/IndexSection.astro");

    expect(section).toContain("section.video");
    expect(banner).toContain("youtube-nocookie.com/embed/");
    expect(banner).toMatch(/autoplay=1/);
    expect(banner).toMatch(/mute=1/);
    expect(banner).toMatch(/controls=0/);
    expect(banner).toMatch(/loop=1/);
    expect(banner).toContain("fallbackImage");
  });

  it("preserves captured scripts and embeds by raw rendering rather than reconstructing content", () => {
    const blocks = source("src/components/SquarespaceContent.astro");
    const captured = pages.map(({ contentHtml }) => contentHtml).join("\n");

    expect(captured).toMatch(/<script\b/i);
    expect(captured).toMatch(/<iframe\b/i);
    expect(blocks).toContain("set:html={contentHtml}");
    expect(blocks).not.toMatch(/sanitize|strip|replace\s*\(/i);
  });
});

describe("redirect and safety contracts", () => {
  it("returns a permanent redirect from /classes to /classes-events", () => {
    const redirect = source("src/pages/classes.ts");

    expect(redirect).toContain('Location: "/classes-events"');
    expect(redirect).toMatch(/status:\s*301/);
  });

  it("contains no first-party Squarespace content/v1 URLs in public data or route templates", () => {
    const publicSurface = [source("src/data/pages.json"), ...ownedProductionFiles.map(source)].join("\n");

    expect(publicSurface).not.toMatch(
      /https?:\\?\/\\?\/(?:images\.squarespace-cdn\.com|[^/\s"']*fatcatfablab[^/\s"']*)\\?\/content\\?\/v1/i,
    );
  });

  it("does not create a second #page owner", () => {
    const production = ownedProductionFiles.map(source).join("\n");

    expect(production).not.toMatch(/id=["']page["']/);
    expect((source("src/layouts/BaseLayout.astro").match(/id=["']page["']/g) ?? [])).toHaveLength(1);
  });

  it("adds responsive containment for grids, iframes, tables, and long links", () => {
    const css = source("src/styles/pages.css");

    expect(css).toMatch(/\.standard-page\s*\{[^}]*max-width:\s*none[^}]*padding:\s*0/s);
    expect(css).toMatch(/\.standard-page\s*>\s*\.banner-thumbnail-wrapper\s*\{[^}]*width:\s*100vw/s);
    expect(css).toMatch(/\.banner-thumbnail-wrapper\s+\.desc-wrapper\s*\{[^}]*opacity:\s*1/s);
    expect(css).toMatch(/overflow-x:\s*(auto|clip|hidden)/);
    expect(css).toMatch(/iframe[^}]*max-width:\s*100%/s);
    expect(css).toMatch(/table[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
    expect(css).toMatch(/@media[^\{]*max-width:\s*640px/);
    expect(css).toMatch(/\.sqs-col-[^}]*width:\s*100%/s);
  });
});
