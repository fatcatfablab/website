import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("theme and homepage hero regression contract", () => {
  it("boots, controls, and persists a two-state color theme", () => {
    const header = source("src/components/Header.astro");
    const layout = source("src/layouts/BaseLayout.astro");
    const script = source("public/scripts/navigation.js");
    const css = source("src/styles/global.css");

    expect(header).toContain("data-theme-toggle");
    expect(header).toContain('aria-pressed="false"');
    expect(layout).toContain("fcfl-theme");
    expect(layout).not.toContain("prefers-color-scheme: dark");
    expect(layout).toMatch(/storedTheme === "dark" \|\| storedTheme === "light"[\s\S]*\? storedTheme[\s\S]*: "light"/);
    expect(layout.indexOf("document.documentElement.dataset.theme")).toBeLessThan(layout.indexOf("</head>"));
    expect(script).toContain("localStorage.setItem");
    expect(script).toContain("aria-pressed");
    expect(css).toMatch(/html\[data-theme="dark"\]\s*\{[^}]*--fcfl-background:/s);
    expect(css).toContain(".theme-toggle");
    expect(css).toMatch(/html\[data-theme="dark"\]\s+#mainNavigation a[\s\S]*?color:\s*#fff/);
    expect(css).toMatch(/html\[data-theme="dark"\]\s+#mobileNavigation a[\s\S]*?color:\s*#fff/);
  });

  it("matches the original desktop hero height rather than a taller clone override", () => {
    const css = source("src/styles/pages.css");

    expect(css).toMatch(/\.home-page \.index-section:first-child\s*>\s*\.banner-thumbnail-wrapper\s*\{[^}]*height:\s*37\.8vw/s);
    expect(css.match(/height:\s*37\.8vw/g)).toHaveLength(1);
    expect(css).not.toMatch(/\.home-page\s+\.index-section:first-child[^}]*height:\s*50vw/s);
  });

  it("matches the original hero text color and first content-block geometry", () => {
    const globalCss = source("src/styles/global.css");
    const pageCss = source("src/styles/pages.css");

    expect(globalCss).toContain("--fcfl-hero-text: #76cdd0");
    expect(globalCss).toMatch(/html\s*\{[^}]*background:\s*var\(--fcfl-navy\)/s);
    expect(globalCss).toMatch(/\.desc-wrapper p \+ p\s*\{[^}]*color:\s*var\(--fcfl-hero-text\)/s);
    expect(globalCss).toMatch(/html\[data-theme="dark"\] \.banner-thumbnail-wrapper \.desc-wrapper,\s*html\[data-theme="dark"\] \.banner-thumbnail-wrapper \.desc-wrapper \*\s*\{[^}]*color:\s*#fff\s*!important/s);
    expect(pageCss).toMatch(/\.home-page \.index-section-wrapper\s*\{[^}]*box-sizing:\s*content-box/s);
    expect(pageCss).toMatch(/\.home-page \.index-section-wrapper \.content-inner\s*\{[^}]*padding:\s*0/s);
  });

  it("keeps standard banners content-sized and renders only real image or video banners", () => {
    const pageCss = source("src/styles/pages.css");
    const standardPage = source("src/templates/StandardPage.astro");
    const banner = source("src/components/PageBanner.astro");

    expect(pageCss).toMatch(/\.standard-page\s*>\s*\.banner-thumbnail-wrapper\s*\{[^}]*box-sizing:\s*content-box[^}]*height:\s*auto/s);
    expect(pageCss).toMatch(/\.standard-page #content\s*\{[^}]*padding:\s*96px 32px/s);
    expect(standardPage).toContain("Boolean(page.mainImage || page.video?.url?.trim())");
    expect(standardPage).toContain("allowBackgroundVideo={Boolean(page.video?.url?.trim())}");
    expect(banner).toContain("https://player.vimeo.com/video/${capturedVimeoId}");
    expect(banner).toContain("background=1");
  });

  it("uses object-fit cover locally and preserves 16:9 cover geometry for any remote embed", () => {
    const css = source("src/styles/pages.css");
    const banner = source("src/components/PageBanner.astro");

    expect(banner).toContain("/media/fcfl-home-hero.mp4");
    expect(banner).toContain('<video');
    expect(css).toMatch(/\.background-video-local\s*\{[^}]*object-fit:\s*cover/s);
    expect(css).toMatch(/\.background-video-embed\s*\{[^}]*width:\s*max\(100vw,\s*177\.7778vh\)/s);
    expect(css).toMatch(/\.background-video-embed\s*\{[^}]*height:\s*max\(56\.25vw,\s*100vh\)/s);
  });

  it("does not paint the unrelated group-photo fallback before the video", () => {
    const banner = source("src/components/PageBanner.astro");

    expect(banner).toMatch(/fallbackImage\?\.src\s*&&\s*!hasVideo\s*&&/);
    expect(banner).not.toContain("custom-fallback-image");
  });
});
