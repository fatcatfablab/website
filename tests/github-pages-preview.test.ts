import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeBasePath,
  rewriteHtmlForProjectPages,
  routeOutputPath,
} from "../scripts/build-github-pages-preview.mjs";

const root = resolve(import.meta.dirname, "..");

describe("GitHub Pages public preview", () => {
  it("rewrites root-relative routes and assets beneath the project Pages base", () => {
    const html = `<!doctype html><html><head></head><body>
      <a href="/about">About</a>
      <img src="/assets/photo.jpg" data-image="/assets/photo.jpg" srcset="/assets/photo.jpg 1x, /assets/photo@2x.jpg 2x">
      <video poster='/media/poster.jpg'></video>
      <div style="background-image:url('/assets/background.jpg')"></div>
      <iframe src="//calendar.google.com/calendar/embed"></iframe>
    </body></html>`;
    const rewritten = rewriteHtmlForProjectPages(html, "/website/");

    expect(rewritten).toContain('href="/website/about"');
    expect(rewritten).toContain('src="/website/assets/photo.jpg"');
    expect(rewritten).toContain('data-image="/website/assets/photo.jpg"');
    expect(rewritten).toContain('srcset="/website/assets/photo.jpg 1x, /website/assets/photo@2x.jpg 2x"');
    expect(rewritten).toContain("poster='/website/media/poster.jpg'");
    expect(rewritten).toContain("url('/website/assets/background.jpg')");
    expect(rewritten).toContain('src="//calendar.google.com/calendar/embed"');
    expect(rewritten).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
  });

  it("does not expose protected routes in the static preview", () => {
    const rewritten = rewriteHtmlForProjectPages(
      '<head></head><a href="/member-portal">Portal</a><a href="/membership2">Join</a>',
      "/website",
    );
    expect(rewritten).toContain('href="https://fatcatfablab.org/member-portal"');
    expect(rewritten).toContain('href="https://fatcatfablab.org/membership2"');
    expect(rewritten).not.toContain('href="/website/member-portal"');
    expect(rewritten).not.toContain('href="/website/membership2"');
  });

  it("normalizes base and output paths deterministically", () => {
    expect(normalizeBasePath("website/ ")).toBe("/website");
    expect(normalizeBasePath("/")).toBe("");
    expect(routeOutputPath("/")).toBe("index.html");
    expect(routeOutputPath("/about")).toBe("about/index.html");
  });

  it("deploys only the generated public artifact through the official Pages actions", async () => {
    const workflow = await readFile(resolve(root, ".github/workflows/pages.yml"), "utf8");
    expect(workflow).toContain("permissions:\n  contents: read\n  pages: write\n  id-token: write");
    expect(workflow).toContain("uses: actions/configure-pages@v5");
    expect(workflow).toContain("uses: actions/upload-pages-artifact@v3");
    expect(workflow).toContain("uses: actions/deploy-pages@v4");
    expect(workflow).toContain("path: dist-pages");
    expect(workflow).not.toContain("private-content/");
  });
});
