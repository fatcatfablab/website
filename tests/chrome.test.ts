import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const qaDir = resolve(root, "test-results", "frontend-qa");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
let chromePort = 0;
let chromeUrl = "";

const reservePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        reject(new Error("Could not reserve a browser-test port"));
        return;
      }
      socket.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const stopServer = async (server: ChildProcess | undefined) => {
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 5_000);
    server.once("exit", () => {
      clearTimeout(forceKill);
      resolveStop();
    });
    server.kill("SIGTERM");
  });
};

const assertPortReleased = (port: number) =>
  new Promise<void>((resolveReleased, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolveReleased()));
    });
  });

const near = (actual: number, expected: number, tolerance = 1) => {
  expect(Math.abs(actual - expected), `${actual} should be within ${tolerance}px of ${expected}`).toBeLessThanOrEqual(
    tolerance,
  );
};

const files = {
  layout: "src/layouts/BaseLayout.astro",
  header: "src/components/Header.astro",
  navigation: "src/components/Navigation.astro",
  footer: "src/components/Footer.astro",
  social: "src/components/SocialLinks.astro",
  fonts: "src/styles/fonts.css",
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

  it("renders one logo plus accessible theme and menu controls", () => {
    const header = source(files.header);

    expect(header).toContain('id="header"');
    expect(header).toContain('class="header-inner"');
    expect(header).toContain('id="logoWrapper"');
    expect(header).toContain('id="logoImage"');
    expect(header).toContain('id="headerNav"');
    expect(header.match(/<img\b/g)).toHaveLength(1);
    expect(header.match(/<button\b/g)).toHaveLength(2);
    expect(header).toContain("data-theme-toggle");
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
    expect(css).toMatch(/--header-height:\s*85px/);
    expect(css).toMatch(/#header\s*\{[^}]*height:\s*var\(--header-height\)/s);
    expect(css).toMatch(/#header\s*\{[^}]*padding:\s*0\s+20px/s);
    expect(css).toMatch(/#header\s+\.header-inner\s*\{[^}]*padding:\s*0/s);
    expect(css).toMatch(/#logoImage\s+img\s*\{[^}]*width:\s*140px[^}]*margin:\s*-10px\s+0\s+0/s);
    expect(css).toMatch(/#mainNavWrapper\s*\{[^}]*margin:\s*20px\s+0\s+0/s);
    expect(css).toMatch(/#header\s+#mainNavigation\s+a\s*\{[^}]*padding:\s*10\.5px\s+14px[^}]*font-size:\s*14px/s);
    expect(css).toMatch(/#content[^}]*margin-top:\s*85px/s);
    expect(css).toMatch(/\.banner-thumbnail-wrapper[^}]*margin-top:\s*85px/s);
    expect(css).toMatch(/max-width:\s*640px[\s\S]*max-height:\s*150px/);
    expect(css).toMatch(/\.mobile-nav-toggle[^}]*top:\s*50%[^}]*right:\s*20px[^}]*width:\s*22px[^}]*height:\s*22px/s);
    expect(css).toMatch(/\.desc-wrapper\s+p\s*\+\s*p[^}]*display:\s*inline-block/s);
    expect(css).toMatch(/\.desc-wrapper\s+p\s*\+\s*p[^}]*padding:\s*5px\s+18px/s);
    expect(css).toMatch(/\.desc-wrapper\s+p\s*\+\s*p[^}]*background:\s*#000/s);
  });

  it("loads the captured Freight Sans faces with strong system fallbacks", () => {
    const css = source(files.global);
    const fonts = source(files.fonts);

    for (const weight of [300, 400, 500, 600, 700]) {
      expect(fonts).toMatch(new RegExp(`font-weight:${weight}`));
    }
    expect(css.trimStart()).toMatch(
      /^@import "\.\/legacy-squarespace\.css";\s*@import "\.\/fonts\.css";/,
    );
    expect(css).toMatch(/freight-sans-pro,\s*"Helvetica Neue",\s*Helvetica,\s*Arial,\s*sans-serif/);
  });

  it("implements fit-driven responsive navigation, 640px mobile layout, overflow protection, and stacked footer", () => {
    const css = source(files.global);
    const script = source(files.navigationScript);

    expect(css).toMatch(/@media[^\{]*max-width:\s*640px/);
    expect(css).toMatch(/#mainNavWrapper[^}]*display:\s*none/s);
    expect(css).toMatch(/min-width:\s*641px[\s\S]*force-mobile-nav[^}]*#mainNavWrapper[^}]*display:\s*none/s);
    expect(css).toMatch(/#mobileNavigation[^}]*width:\s*100%/s);
    expect(css).toMatch(/overflow-x:\s*(hidden|clip)/);
    expect(css).toMatch(/\.footer-navigation[^}]*flex-direction:\s*column/s);
    expect(script).toContain("desktopRequiredWidth");
    expect(script).toContain("capturedDesktopMinimum = 1190");
    expect(script).toContain('classList.toggle("force-mobile-nav"');
    expect(script).toContain('window.addEventListener("resize"');
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

  it("starts browser QA on the reserved port with strict no-fallback provenance and awaited teardown", () => {
    const testSource = source("tests/chrome.test.ts");

    expect(testSource).toContain("strictPort: true");
    expect(testSource).toContain("server.address.port");
    expect(testSource).toContain("FCFL_TEST_URL=");
    expect(testSource).toContain("await stopServer(server)");
  });
});

describe("shared site chrome browser geometry", () => {
  let server: ChildProcess | undefined;
  let browser: Browser;
  let serverOutput = "";

  beforeAll(async () => {
    mkdirSync(qaDir, { recursive: true });
    chromePort = await reservePort();
    chromeUrl = "";
    const program = `
      import { dev } from "astro";
      const requestedPort = ${chromePort};
      try {
        const server = await dev({
          root: process.cwd(),
          server: { host: "127.0.0.1", port: requestedPort },
          devToolbar: { enabled: false },
          vite: { server: { strictPort: true } },
        });
        if (server.address.port !== requestedPort) {
          await server.stop();
          throw new Error('Astro fell back from reserved port ' + requestedPort + ' to ' + server.address.port);
        }
        console.log('FCFL_TEST_URL=http://127.0.0.1:' + server.address.port);
        const stop = async () => { await server.stop(); process.exit(0); };
        process.on("SIGTERM", stop);
        process.on("SIGINT", stop);
        await new Promise(() => {});
      } catch (error) {
        console.error(error?.stack || error);
        process.exit(1);
      }
    `;
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ASTRO_DEV_BACKGROUND: "0",
      NODE_ENV: "development",
      NO_COLOR: "1",
    };
    delete serverEnv.VITEST;
    delete serverEnv.VITEST_WORKER_ID;
    server = spawn(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: root,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => (serverOutput += chunk.toString()));
    server.stderr?.on("data", (chunk) => (serverOutput += chunk.toString()));

    const deadline = Date.now() + 20_000;
    let lastProbe = "waiting for Astro URL";
    while (Date.now() < deadline) {
      if (server && server.exitCode !== null) throw new Error(`Astro exited before browser tests:\n${serverOutput}`);
      const announcedUrl = serverOutput.match(/FCFL_TEST_URL=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!announcedUrl) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        continue;
      }
      chromeUrl = announcedUrl;
      try {
        const response = await fetch(`${chromeUrl}/about`);
        const responseText = await response.text();
        lastProbe = `${response.status} ${responseText.slice(0, 300)}`;
        if (response.ok && responseText.includes('id="header"')) break;
      } catch (error) {
        lastProbe = String(error);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!chromeUrl || Date.now() >= deadline) {
      throw new Error(`Astro did not become ready (${lastProbe}):\n${serverOutput}`);
    }
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await stopServer(server);
    if (chromePort) await assertPortReleased(chromePort);
  });

  it("matches the captured 1280px desktop header geometry", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const value = document.querySelector(selector)!.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      };
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return {
        header: rect("#header"),
        headerPadding: [style("#header").paddingLeft, style("#header").paddingRight],
        inner: rect("#header .header-inner"),
        logo: rect("#logoImage img"),
        headerNav: rect("#headerNav"),
        firstLink: rect("#mainNavigation a"),
        firstLinkStyle: {
          display: style("#mainNavigation a").display,
          fontSize: style("#mainNavigation a").fontSize,
          lineHeight: style("#mainNavigation a").lineHeight,
          padding: `${style("#mainNavigation a").paddingTop} ${style("#mainNavigation a").paddingRight}`,
        },
        mainDisplay: style("#mainNavWrapper").display,
        toggleDisplay: style(".mobile-nav-toggle").display,
        logoCount: document.querySelectorAll("#logoImage img").length,
        toggleCount: document.querySelectorAll(".mobile-nav-toggle").length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    near(geometry.header.x, 0);
    near(geometry.header.width, 1280);
    near(geometry.header.height, 85);
    expect(geometry.headerPadding).toEqual(["20px", "20px"]);
    near(geometry.inner.x, 20);
    near(geometry.inner.width, 1240);
    near(geometry.logo.x, 20);
    near(geometry.logo.y, -10);
    near(geometry.logo.width, 139.992, 0.75);
    near(geometry.logo.height, 217.047, 0.75);
    near(geometry.headerNav.x, 160);
    near(geometry.headerNav.width, 1100);
    near(geometry.firstLink.x, 302.914, 2);
    near(geometry.firstLink.width, 77.359, 2);
    near(geometry.firstLink.height, 35, 0.75);
    expect(geometry.firstLinkStyle).toEqual({
      display: "block",
      fontSize: "14px",
      lineHeight: "14px",
      padding: "10.5px 14px",
    });
    expect(geometry.mainDisplay).not.toBe("none");
    expect(geometry.toggleDisplay).toBe("none");
    expect(geometry.logoCount).toBe(1);
    expect(geometry.toggleCount).toBe(1);
    expect(geometry.overflow).toBe(0);
    await page.close();
  }, 15_000);

  it("reserves enough width for the theme control at the desktop fit breakpoint", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const state = () =>
      page.evaluate(() => ({
        forceMobile: document.body.classList.contains("force-mobile-nav"),
        desktop: getComputedStyle(document.querySelector("#mainNavWrapper")!).display,
        toggle: getComputedStyle(document.querySelector(".mobile-nav-toggle")!).display,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }));

    expect(await state()).toEqual({ forceMobile: true, desktop: "none", toggle: "block", overflow: 0 });

    await page.setViewportSize({ width: 768, height: 800 });
    await expect.poll(() => state()).toEqual({ forceMobile: true, desktop: "none", toggle: "block", overflow: 0 });

    await page.setViewportSize({ width: 1189, height: 800 });
    await expect.poll(() => state()).toEqual({ forceMobile: true, desktop: "none", toggle: "block", overflow: 0 });

    await page.setViewportSize({ width: 1190, height: 800 });
    await expect.poll(() => state()).toEqual({ forceMobile: false, desktop: "block", toggle: "none", overflow: 0 });
    await page.close();
  });

  it("defaults to light, persists an explicit theme choice, and keeps dark navigation and image overlays white", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme: "dark",
    });
    await page.goto(`${chromeUrl}/`, { waitUntil: "domcontentloaded" });

    const themeState = () =>
      page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        stored: localStorage.getItem("fcfl-theme"),
        navColors: Array.from(document.querySelectorAll<HTMLElement>("#mainNavigation a"), (link) =>
          getComputedStyle(link).color,
        ),
        overlayColors: Array.from(new Set(
          Array.from(
            document.querySelectorAll<HTMLElement>(".banner-thumbnail-wrapper .desc-wrapper, .banner-thumbnail-wrapper .desc-wrapper *"),
          )
            .filter((element) => element.textContent?.trim())
            .map((element) => getComputedStyle(element).color),
        )),
      }));

    const initial = await themeState();
    expect(initial.theme).toBe("light");
    expect(initial.stored).toBeNull();
    expect(initial.navColors).not.toContain("rgb(255, 255, 255)");
    expect(initial.overlayColors).not.toEqual(["rgb(255, 255, 255)"]);

    await page.locator("[data-theme-toggle]").click();
    await expect.poll(() => themeState()).toEqual({
      theme: "dark",
      stored: "dark",
      navColors: Array(8).fill("rgb(255, 255, 255)"),
      overlayColors: ["rgb(255, 255, 255)"],
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => themeState()).toEqual({
      theme: "dark",
      stored: "dark",
      navColors: Array(8).fill("rgb(255, 255, 255)"),
      overlayColors: ["rgb(255, 255, 255)"],
    });
    await page.close();
  });

  it("matches the captured desktop footer width, type, spacing, and social colors", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const footer = await page.evaluate(() => {
      const rect = (selector: string) => {
        const value = document.querySelector(selector)!.getBoundingClientRect();
        return { x: value.x, width: value.width, height: value.height };
      };
      const inner = document.querySelector("#footer .footer-inner")!;
      const info = document.querySelector("#siteInfo")!;
      return {
        inner: rect("#footer .footer-inner"),
        innerPadding: [getComputedStyle(inner).paddingTop, getComputedStyle(inner).paddingRight],
        info: rect("#siteInfo"),
        infoFontSize: getComputedStyle(info).fontSize,
        colors: Array.from(document.querySelectorAll<HTMLElement>(".social-link")).map(
          (link) => getComputedStyle(link).color,
        ),
      };
    });

    near(footer.inner.x, 130);
    near(footer.inner.width, 1020);
    near(footer.inner.height, 278.547, 0.75);
    expect(footer.innerPadding).toEqual(["64px", "32px"]);
    near(footer.info.x, 162);
    near(footer.info.width, 956);
    near(footer.info.height, 28.797, 1);
    expect(footer.infoFontSize).toBe("16px");
    expect(footer.colors).toEqual(["rgb(232, 66, 102)", "rgb(72, 103, 170)", "rgb(85, 172, 238)"]);
    await page.close();
  });

  it("uses the captured 390px mobile header and shows only the mobile menu", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const mobile = await page.evaluate(() => {
      const rect = (selector: string) => {
        const value = document.querySelector(selector)!.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      };
      return {
        header: rect("#header"),
        inner: rect("#header .header-inner"),
        logo: rect("#logoImage img"),
        toggle: rect(".mobile-nav-toggle"),
        mainDisplay: getComputedStyle(document.querySelector("#mainNavWrapper")!).display,
        toggleDisplay: getComputedStyle(document.querySelector(".mobile-nav-toggle")!).display,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    near(mobile.header.width, 390);
    near(mobile.header.height, 85);
    near(mobile.inner.x, 20);
    near(mobile.inner.width, 350);
    near(mobile.inner.height, 140, 1);
    near(mobile.logo.x, 20);
    near(mobile.logo.y, -10);
    near(mobile.logo.width, 96.75, 0.75);
    near(mobile.logo.height, 150, 0.75);
    near(mobile.toggle.x, 348, 0.75);
    near(mobile.toggle.y, 34.5, 0.75);
    near(mobile.toggle.width, 22, 0.75);
    near(mobile.toggle.height, 22, 0.75);
    expect(mobile.mainDisplay).toBe("none");
    expect(mobile.toggleDisplay).not.toBe("none");
    expect(mobile.overflow).toBe(0);
    await page.close();
  });

  it("opens the mobile menu, traps keyboard focus, closes with Escape, and closes outside", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".mobile-nav-toggle");
    const wrapper = page.locator("#mobileNavWrapper");

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => wrapper.getAttribute("hidden")).toBeNull();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("#mobileNavigation") !== null)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("mobile-nav-toggle"))).toBe(true);

    await toggle.click();
    await page.mouse.click(380, 800);
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
    await page.close();
  });

  it("renders and navigates the seven captured folder sections on desktop", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("https://www.instagram.com/embed.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "window.instgrm={Embeds:{process(){}}};" }),
    );
    await page.goto(`${chromeUrl}/members`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const folder = await page.evaluate(() => {
      const rect = (selector: string) => {
        const value = document.querySelector(selector)!.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right };
      };
      return {
        nav: rect("#folderNav"),
        content: rect("#content"),
        precedingChromeBottom:
          document.querySelector(".banner-thumbnail-wrapper")?.getBoundingClientRect().bottom ??
          document.querySelector("#header")!.getBoundingClientRect().bottom,
        labels: Array.from(document.querySelectorAll("#folderNavigation a"), (link) => link.textContent?.trim()),
        current: document.querySelector("#folderNavigation [aria-current=page]")?.textContent?.trim(),
        toggleDisplay: getComputedStyle(document.querySelector(".folder-nav-toggle")!).display,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    expect(folder.labels).toEqual([
      "Digital Fabrication",
      "Electronics",
      "Electronics info",
      "Wood & Metalworking",
      "Textiles and Papercraft",
      "Photography",
      "Members",
    ]);
    expect(folder.current).toBe("Members");
    expect(folder.toggleDisplay).toBe("none");
    expect(folder.nav.y).toBeGreaterThanOrEqual(folder.precedingChromeBottom + 80);
    near(folder.nav.width, 255, 1);
    near(folder.content.x, folder.nav.right, 1);
    expect(folder.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "members-desktop-1440x1000.png"), fullPage: true });

    await page.getByRole("link", { name: "Wood & Metalworking", exact: true }).click();
    await page.waitForURL(`${chromeUrl}/second-day`);
    expect(await page.locator("#folderNavigation [aria-current=page]").textContent()).toContain("Wood & Metalworking");
    await page.screenshot({ path: resolve(qaDir, "second-day-desktop-1440x1000.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 20_000);

  it("uses the captured mobile folder disclosure and preserves click paths", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("https://www.instagram.com/embed.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "window.instgrm={Embeds:{process(){}}};" }),
    );
    await page.goto(`${chromeUrl}/members`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".folder-nav-toggle");
    const links = page.locator("#folderNavigation a");

    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await links.evaluateAll((values) => values.filter((link) => getComputedStyle(link.parentElement!).display !== "none").length)).toBe(1);
    await toggle.click();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await links.evaluateAll((values) => values.filter((link) => getComputedStyle(link.parentElement!).display !== "none").length)).toBe(7);
    await page.mouse.move(389, 843);
    await page.screenshot({ path: resolve(qaDir, "members-mobile-open-390x844.png"), fullPage: true });

    await page.getByRole("link", { name: "Photography", exact: true }).click();
    await page.waitForURL(`${chromeUrl}/photography`);
    expect(await page.locator("#folderNavigation [aria-current=page]").textContent()).toContain("Photography");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "photography-mobile-390x844.png"), fullPage: true });
    await page.close();
  }, 20_000);

  it("loads the grayscale About map at captured desktop aspect and 20px mobile inset", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let mapRequests = 0;
    await page.route("https://www.google.com/maps?**", async (route) => {
      mapRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><style>
          html,body{height:100%;margin:0;font:14px Arial;color:#555;overflow:hidden}
          body{background-color:#e5e5e5;background-image:linear-gradient(28deg,transparent 45%,#c9c9c9 46% 49%,transparent 50%),linear-gradient(115deg,transparent 45%,#d1d1d1 46% 49%,transparent 50%);background-size:95px 70px}
          .pin{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);padding:7px 10px;background:#555;color:#fff;border-radius:2px;box-shadow:0 1px 4px #777}
        </style><div class="pin">224 West 4th Street</div>`,
      });
    });
    await page.goto(`${chromeUrl}/about`, { waitUntil: "domcontentloaded" });
    await page.locator(".fcfl-location-map iframe").waitFor({ state: "visible" });
    await page.frameLocator(".fcfl-location-map iframe").locator(".pin").waitFor({ state: "visible" });

    const mapGeometry = () =>
      page.locator(".fcfl-location-map iframe").evaluate((frame) => {
        const rect = frame.getBoundingClientRect();
        return {
          x: rect.x,
          width: rect.width,
          height: rect.height,
          src: (frame as HTMLIFrameElement).src,
          filter: getComputedStyle(frame).filter,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
    const desktop = await mapGeometry();
    expect(desktop.width).toBeGreaterThanOrEqual(600);
    expect(desktop.width).toBeLessThanOrEqual(620);
    near(desktop.width / desktop.height, 2.398, 0.02);
    expect(desktop.src).toContain("40.7338569,-74.003074");
    expect(desktop.filter).toContain("grayscale(1)");
    expect(mapRequests).toBe(1);
    await page.screenshot({ path: resolve(qaDir, "about-map-desktop-1440x1000.png"), fullPage: true });
    await page.locator(".fcfl-location-map iframe").screenshot({
      path: resolve(qaDir, "about-map-desktop-element.png"),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await mapGeometry();
    near(mobile.x, 20, 1);
    near(mobile.width, 350, 1);
    near(mobile.width / mobile.height, 2.398, 0.02);
    expect(mobile.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "about-map-mobile-390x844.png"), fullPage: true });
    await page.locator(".fcfl-location-map iframe").screenshot({
      path: resolve(qaDir, "about-map-mobile-element.png"),
    });
    await page.close();
  }, 20_000);

  it("stages orange, an eager poster, and then a ready video without serif typography or blank media", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("https://www.instagram.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.instgrm={Embeds:{process(){}}};",
    }));
    await page.route("**/6534163451f2-IMG_6131.jpg", async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      await route.continue();
    });

    await page.goto(`${chromeUrl}/`, { waitUntil: "domcontentloaded" });
    const state = () => page.evaluate(() => {
      const banner = document.querySelector<HTMLElement>(
        ".home-page .index-section:first-child > .banner-thumbnail-wrapper",
      )!;
      const poster = banner.querySelector<HTMLImageElement>("[data-hero-video-poster]")!;
      const video = banner.querySelector<HTMLVideoElement>("[data-hero-video]")!;
      const title = banner.querySelector<HTMLElement>(".desc-wrapper strong")!;
      return {
        background: getComputedStyle(banner).backgroundColor,
        posterComplete: poster.complete && poster.naturalWidth > 0,
        posterOpacity: getComputedStyle(poster).opacity,
        posterVisibility: getComputedStyle(poster).visibility,
        posterHidden: poster.classList.contains("is-hidden"),
        videoOpacity: getComputedStyle(video).opacity,
        videoReadyState: video.readyState,
        videoPaused: video.paused,
        videoCurrentTime: video.currentTime,
        titleFontFamily: getComputedStyle(title).fontFamily,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    const initial = await state();
    expect(initial.background).toBe("rgb(245, 90, 0)");
    expect(initial.posterHidden).toBe(false);
    expect(initial.posterOpacity).toBe("1");
    expect(initial.videoOpacity).toBe("0");
    expect(initial.titleFontFamily).toContain("freight-sans-pro");
    expect(initial.titleFontFamily).toContain("Helvetica");
    expect(initial.titleFontFamily).toContain("sans-serif");
    expect(initial.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "home-cold-orange-1280x900.png"), fullPage: false });

    await page.locator("[data-hero-video-poster]").evaluate((image: HTMLImageElement) => image.decode());
    const posterState = await state();
    expect(posterState.posterComplete).toBe(true);
    expect(posterState.posterOpacity).toBe("1");
    expect(posterState.posterHidden).toBe(false);
    expect(posterState.videoOpacity).toBe("1");
    await page.screenshot({ path: resolve(qaDir, "home-cold-poster-1280x900.png"), fullPage: false });

    await page.waitForTimeout(1_500);
    expect((await state()).posterHidden).toBe(false);
    await page.waitForFunction(() => document.querySelector("[data-hero-video-poster]")?.classList.contains("is-hidden"));
    await page.waitForTimeout(200);
    const revealed = await state();
    expect(revealed.posterHidden).toBe(true);
    expect(revealed.posterOpacity).toBe("0");
    expect(revealed.posterVisibility).toBe("hidden");
    expect(revealed.videoOpacity).toBe("1");
    expect(revealed.videoReadyState).toBeGreaterThanOrEqual(2);
    expect(revealed.videoPaused).toBe(false);
    expect(revealed.videoCurrentTime).toBeGreaterThan(0);
    expect(revealed.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "home-cold-video-1280x900.png"), fullPage: false });
    await page.close();
  }, 15_000);

  it("keeps the decoded hero poster when the video cannot load", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route("**/fcfl-home-hero.mp4", (route) => route.abort());
    await page.goto(`${chromeUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-hero-video-poster]").evaluate((image: HTMLImageElement) => image.decode());
    await page.waitForTimeout(2_800);
    const state = await page.evaluate(() => {
      const poster = document.querySelector<HTMLElement>("[data-hero-video-poster]")!;
      const video = document.querySelector<HTMLVideoElement>("[data-hero-video]")!;
      return {
        posterHidden: poster.classList.contains("is-hidden"),
        posterOpacity: getComputedStyle(poster).opacity,
        videoPaused: video.paused,
      };
    });
    expect(state.posterHidden).toBe(false);
    expect(state.posterOpacity).toBe("1");
    expect(state.videoPaused).toBe(true);
    await context.close();
  }, 10_000);

  it("keeps the decoded hero poster and pauses motion when reduced motion is requested", async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(`${chromeUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-hero-video-poster]").evaluate((image: HTMLImageElement) => image.decode());
    await page.waitForTimeout(2_800);
    const state = await page.evaluate(() => {
      const poster = document.querySelector<HTMLElement>("[data-hero-video-poster]")!;
      const video = document.querySelector<HTMLVideoElement>("[data-hero-video]")!;
      return {
        posterHidden: poster.classList.contains("is-hidden"),
        posterOpacity: getComputedStyle(poster).opacity,
        videoPaused: video.paused,
      };
    });
    expect(state.posterHidden).toBe(false);
    expect(state.posterOpacity).toBe("1");
    expect(state.videoPaused).toBe(true);
    await context.close();
  }, 10_000);

  it("matches the original homepage hero crop at desktop and mobile widths", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`${chromeUrl}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const hero = await page.evaluate(() => {
      const banner = document.querySelector<HTMLElement>(
        ".home-page .index-section:first-child > .banner-thumbnail-wrapper",
      )!;
      const media = banner.querySelector<HTMLVideoElement>(".background-video-local")!;
      const bannerRect = banner.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return {
        banner: { y: bannerRect.y, width: bannerRect.width, height: bannerRect.height },
        media: {
          tag: media.tagName,
          width: mediaRect.width,
          height: mediaRect.height,
          objectFit: getComputedStyle(media).objectFit,
        },
        fallbackCount: banner.querySelectorAll(".background-video-poster").length,
        embedCount: banner.querySelectorAll("iframe").length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    near(hero.banner.y, 85, 1);
    near(hero.banner.width, 1280, 1);
    near(hero.banner.height, 483.84, 1);
    expect(hero.media.tag).toBe("VIDEO");
    near(hero.media.width, hero.banner.width, 1);
    near(hero.media.height, hero.banner.height, 1);
    expect(hero.media.objectFit).toBe("cover");
    expect(hero.fallbackCount).toBe(1);
    expect(hero.embedCount).toBe(0);
    expect(hero.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "home-desktop-1280x900.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const banner = document.querySelector<HTMLElement>(
        ".home-page .index-section:first-child > .banner-thumbnail-wrapper",
      )!;
      const media = banner.querySelector<HTMLVideoElement>(".background-video-local")!;
      const bannerRect = banner.getBoundingClientRect();
      return {
        bannerHeight: bannerRect.height,
        mediaObjectFit: getComputedStyle(media).objectFit,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    near(mobile.bannerHeight, 450, 1);
    expect(mobile.mediaObjectFit).toBe("cover");
    expect(mobile.overflow).toBe(0);
    await page.screenshot({ path: resolve(qaDir, "home-mobile-390x844.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 25_000);

  it("hydrates the trusted Instagram embed exactly once without captured script execution", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    let embedScriptRequests = 0;
    let embedFrameRequests = 0;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("https://www.instagram.com/embed.js", async (route) => {
      embedScriptRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `(() => {
          const block = document.querySelector('blockquote.instagram-media');
          if (!block || document.querySelector('iframe.instagram-media-rendered')) return;
          const frame = document.createElement('iframe');
          frame.className = 'instagram-media-rendered';
          frame.src = 'https://www.instagram.com/fatcatfablab/embed/';
          frame.title = 'Fat Cat Fab Lab on Instagram';
          block.replaceWith(frame);
        })();`,
      });
    });
    await page.route("https://www.instagram.com/fatcatfablab/embed/", async (route) => {
      embedFrameRequests += 1;
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>Fat Cat Fab Lab Instagram</p>" });
    });
    await page.goto(`${chromeUrl}/members`, { waitUntil: "domcontentloaded" });
    await page.locator("iframe.instagram-media-rendered").waitFor({ state: "attached" });

    expect(embedScriptRequests).toBe(1);
    expect(embedFrameRequests).toBe(1);
    expect(await page.locator("script[data-fcfl-instagram-embed]").count()).toBe(1);
    expect(await page.locator("#content script").count()).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 20_000);

  it("renders representative full pages without page or console errors", async () => {
    for (const route of ["/", "/about", "/members", "/membership", "/reservation-calendar"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      await page.route("https://www.instagram.com/embed.js", (request) =>
        request.fulfill({ status: 200, contentType: "application/javascript", body: "window.instgrm={Embeds:{process(){}}};" }),
      );
      await page.route("https://www.google.com/maps?**", (request) =>
        request.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>Map loaded</p>" }),
      );
      await page.route("https://calendar.google.com/**", (request) =>
        request.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>Calendar loaded</p>" }),
      );
      const response = await page.goto(`${chromeUrl}${route}`, { waitUntil: "domcontentloaded" });
      expect(response?.status(), route).toBe(200);
      expect(await page.locator("#header").count(), route).toBe(1);
      expect(await page.locator("#footer").count(), route).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), route).toBe(0);
      expect(errors, route).toEqual([]);
      await page.close();
    }
  }, 30_000);
});
