import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

const files = {
  layout: "src/layouts/BaseLayout.astro",
  header: "src/components/Header.astro",
  navigation: "src/components/Navigation.astro",
  footer: "src/components/Footer.astro",
  social: "src/components/SocialLinks.astro",
  global: "src/styles/global.css",
  legacy: "src/styles/legacy-squarespace.css",
  navigationScript: "public/scripts/navigation.js",
} as const;

describe("shared site chrome source contract", () => {
  it("defines every shared chrome artifact", () => {
    for (const path of Object.values(files)) {
      expect(() => source(path), `${path} should exist`).not.toThrow();
    }
  });

  it("renders the legacy public header structure with exactly one logo and one accessible menu button", () => {
    const header = source(files.header);

    expect(header).toContain('id="header"');
    expect(header).toContain('class="header-inner"');
    expect(header).toContain('id="logoWrapper"');
    expect(header).toContain('id="logoImage"');
    expect(header).toContain('id="headerNav"');
    expect(header.match(/<img\b/g)).toHaveLength(1);
    expect(header.match(/<button\b/g)).toHaveLength(1);
    expect(header).toContain('aria-controls="mobileNavigation"');
    expect(header).toContain('aria-expanded="false"');
  });

  it("renders desktop and mobile navigation from the one main navigation data source", () => {
    const header = source(files.header);
    const navigation = source(files.navigation);

    expect(header).toMatch(/navigation\.(main|mainNavigation)/);
    expect(header).toContain("<Navigation");
    expect(navigation).toContain('id="mainNavWrapper"');
    expect(navigation).toContain('id="mainNavigation"');
    expect(navigation).toContain('id="mobileNavigation"');
    expect(navigation).toMatch(/items\.map\s*\(/);
    expect(navigation).toContain('aria-current="page"');
    expect(`${header}\n${navigation}`).not.toMatch(/\[\s*\{[^\]]*About/s);
  });

  it("renders footer navigation and social profiles from data rather than duplicated arrays", () => {
    const footer = source(files.footer);
    const social = source(files.social);

    expect(footer).toMatch(/navigation\.(footer|footerNavigation)/);
    expect(footer).toContain("<SocialLinks");
    expect(footer).toContain("site.fullTitle");
    expect(footer).toContain("site.address.line1");
    expect(footer).toContain("site.address.line2");
    expect(footer).toContain("site.email");
    expect(social).toMatch(/socialLinks\.map\s*\(/);
    expect(social).toContain("<svg");
    expect(`${footer}\n${social}`).not.toMatch(/const\s+\w*(links|navigation)\w*\s*=\s*\[/i);
  });

  it("owns canonical metadata, indexing, body classes, analytics hook, and universal chrome in BaseLayout", () => {
    const layout = source(files.layout);

    for (const prop of ["title", "description", "canonical", "noindex", "pageClass", "bodyClass"]) {
      expect(layout).toContain(prop);
    }
    expect(layout).toContain('rel="canonical"');
    expect(layout).toContain('property="og:title"');
    expect(layout).toContain('property="og:description"');
    expect(layout).toContain('property="og:url"');
    expect(layout).toContain('name="robots"');
    expect(layout).toContain('rel="icon"');
    expect(layout).toContain('name="analytics"');
    expect(layout).toContain("<Header");
    expect(layout).toContain("<Footer");
    expect(layout).toContain("/scripts/navigation.js");
  });

  it("keeps the header visible without a legacy runtime loaded-state class", () => {
    const css = source(files.global);

    expect(css).toMatch(/#header\s+\.header-inner\s*\{[^}]*opacity:\s*1/s);
  });

  it("preserves the captured Squarespace stylesheet byte-for-byte", () => {
    expect(source(files.legacy)).toBe(source("research/styles/site.css"));
  });

  it("does not minify the legacy stylesheet because its original LESS output contains browser-ignored selectors", () => {
    const config = source("astro.config.mjs");

    expect(config).toMatch(/cssMinify:\s*false/);
  });

  it("imports legacy styling before local overrides and preserves the exact custom geometry", () => {
    const css = source(files.global);

    expect(css.trimStart().startsWith('@import "./legacy-squarespace.css";')).toBe(true);
    expect(css).toMatch(/#header\s*\{[^}]*height:\s*85px/s);
    expect(css).toMatch(/#header\s+\.header-inner\s*\{[^}]*padding:\s*0/s);
    expect(css).toMatch(/#logoImage\s+img\s*\{[^}]*max-height:\s*230px[^}]*margin-top:\s*-10px/s);
    expect(css).toMatch(/#mainNavWrapper\s*\{[^}]*margin-top:\s*20px/s);
    expect(css).toMatch(/#content[^}]*margin-top:\s*85px/s);
    expect(css).toMatch(/\.banner-thumbnail-wrapper[^}]*margin-top:\s*85px/s);
    expect(css).toMatch(/max-width:\s*640px[\s\S]*max-height:\s*150px/);
    expect(css).toMatch(/\.mobile-nav-toggle[^}]*top:\s*45px[^}]*right:\s*30px/s);
    expect(css).toMatch(/\.desc-wrapper\s+p\s*\+\s*p[^}]*display:\s*inline-block[^}]*background:\s*#000[^}]*padding:\s*5px\s+18px/s);
  });

  it("implements an 800px responsive menu, horizontal overflow protection, and stacked mobile footer", () => {
    const css = source(files.global);

    expect(css).toMatch(/@media[^\{]*max-width:\s*799px/);
    expect(css).toMatch(/#mainNavWrapper[^}]*display:\s*none/s);
    expect(css).toMatch(/#mobileNavigation[^}]*width:\s*100%/s);
    expect(css).toMatch(/overflow-x:\s*(hidden|clip)/);
    expect(css).toMatch(/\.footer-navigation[^}]*flex-direction:\s*column/s);
  });

  it("implements focus-safe mobile navigation without a framework dependency", () => {
    const script = source(files.navigationScript);

    expect(script).toContain('setAttribute("aria-expanded"');
    expect(script).toContain('classList.add("is-open")');
    expect(script).toContain('classList.remove("is-open")');
    expect(script).toContain('event.key === "Escape"');
    expect(script).toMatch(/document\.addEventListener\("click"/);
    expect(script).toContain("toggle.focus()");
    expect(script).not.toMatch(/jquery|react|vue|squarespace/i);
  });
});
