import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const originalOrigin = process.env.ORIGINAL_ORIGIN ?? "https://fatcatfablab.org";
const cloneOrigin = process.env.CLONE_ORIGIN ?? "http://127.0.0.1:4331";
const cdpPort = Number(process.env.ORIGINAL_CDP_PORT ?? 9223);
const cloneCdpPort = process.env.CLONE_CDP_PORT ? Number(process.env.CLONE_CDP_PORT) : null;
const viewport = {
  width: Number(process.env.VIEWPORT_WIDTH ?? 1910),
  height: Number(process.env.VIEWPORT_HEIGHT ?? 1099),
};
const outputRoot = resolve(root, process.env.VISUAL_PARITY_OUTPUT ?? "test-results/visual-parity");
const requestedRoutes = new Set(
  (process.env.ROUTES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const pages = JSON.parse(await readFile(resolve(root, "src/data/pages.json"), "utf8"));
const routes = pages
  .map(({ slug, path, title, seo }) => ({ slug, path, title, noindex: Boolean(seo?.noindex) }))
  .filter(({ path }) => !requestedRoutes.size || requestedRoutes.has(path));

if (!routes.length) throw new Error("No public routes matched the requested route filter.");

await mkdir(resolve(outputRoot, "original"), { recursive: true });
await mkdir(resolve(outputRoot, "clone"), { recursive: true });

const metricsExpression = `(() => {
  const rect = (element) => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, right: value.right, bottom: value.bottom, left: value.left };
  };
  const textMetric = (element) => {
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      text: (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
      rect: rect(element),
      color: style.color,
      background: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      margin: style.margin,
      padding: style.padding,
    };
  };
  const candidates = [...document.querySelectorAll('#page h1, #page h2, #page h3, #page p')]
    .filter((element) => {
      const value = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return value.width > 0 && value.height > 0 && value.bottom > 0 && value.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .slice(0, 16)
    .map(textMetric);
  const firstBanner = document.querySelector('.banner-thumbnail-wrapper');
  const firstContent = document.querySelector('.index-section-wrapper, .folder-page-shell, .standard-page-shell, #content');
  return {
    href: location.href,
    title: document.title,
    challenge: document.body.innerText.includes('Performing security verification'),
    theme: document.documentElement.dataset.theme || null,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    body: {
      className: document.body.className,
      color: getComputedStyle(document.body).color,
      background: getComputedStyle(document.body).backgroundColor,
    },
    pageClassName: document.querySelector('#page')?.className || null,
    header: rect(document.querySelector('#header')),
    page: rect(document.querySelector('#page')),
    banner: rect(firstBanner),
    bannerMarkup: firstBanner ? {
      className: firstBanner.className,
      parentClassName: firstBanner.parentElement?.className || null,
      style: firstBanner.getAttribute('style'),
    } : null,
    bannerStyle: firstBanner ? {
      color: getComputedStyle(firstBanner).color,
      background: getComputedStyle(firstBanner).backgroundColor,
      boxSizing: getComputedStyle(firstBanner).boxSizing,
      height: getComputedStyle(firstBanner).height,
      minHeight: getComputedStyle(firstBanner).minHeight,
      maxHeight: getComputedStyle(firstBanner).maxHeight,
      padding: getComputedStyle(firstBanner).padding,
      margin: getComputedStyle(firstBanner).margin,
      aspectRatio: getComputedStyle(firstBanner).aspectRatio,
    } : null,
    firstContent: rect(firstContent),
    firstText: candidates,
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    largeVisibleWhiteSurfaces: [...document.querySelectorAll('body *')]
      .filter((element) => {
        const value = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return value.width > innerWidth * 0.7 && value.height > 120 && value.top < innerHeight && value.bottom > 0 && style.backgroundColor === 'rgb(255, 255, 255)';
      })
      .slice(0, 12)
      .map((element) => ({ tag: element.tagName, id: element.id, className: String(element.className).slice(0, 160), rect: rect(element) })),
  };
})()`;

class CdpTarget {
  constructor(port, target) {
    this.port = port;
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    this.onceHandlers = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        return;
      }
      if (!message.method) return;
      const onceHandler = this.onceHandlers.get(message.method);
      if (onceHandler) {
        this.onceHandlers.delete(message.method);
        onceHandler.resolve(message.params);
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    };
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.onopen = resolveOpen;
      this.socket.onerror = rejectOpen;
    });
  }

  send(method, params = {}) {
    return new Promise((resolveSend, rejectSend) => {
      const id = ++this.id;
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeout = 45_000) {
    return new Promise((resolveOnce, rejectOnce) => {
      const timer = setTimeout(() => {
        this.onceHandlers.delete(method);
        rejectOnce(new Error(`Timed out waiting for ${method}`));
      }, timeout);
      this.onceHandlers.set(method, {
        resolve: (params) => {
          clearTimeout(timer);
          resolveOnce(params);
        },
      });
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async close() {
    this.socket.close();
    await fetch(`http://127.0.0.1:${this.port}/json/close/${this.target.id}`).catch(() => {});
  }
}

async function createCdpTarget(url, port = cdpPort) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP target creation failed: HTTP ${response.status}`);
  const target = new CdpTarget(port, await response.json());
  await target.open();
  return target;
}

async function captureOriginal(route) {
  const url = new URL(route.path, originalOrigin).toString();
  const target = await createCdpTarget(url);
  let documentResponse = null;
  try {
    target.on("Network.responseReceived", ({ response, type }) => {
      if (type === "Document" && new URL(response.url).pathname === route.path) {
        documentResponse = { status: response.status, mimeType: response.mimeType };
      }
    });
    await target.send("Page.enable");
    await target.send("Network.enable");
    await target.send("Runtime.enable");
    await target.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const loaded = target.once("Page.loadEventFired").catch(() => null);
    await target.send("Page.navigate", { url });
    await loaded;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_500));
    await target.send("Runtime.evaluate", {
      expression: "(async()=>{await document.fonts?.ready; document.scrollingElement.scrollTop=0; scrollTo(0,0); return true})()",
      awaitPromise: true,
      returnByValue: true,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const metrics = await target.send("Runtime.evaluate", { expression: metricsExpression, returnByValue: true });
    const screenshot = await target.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(resolve(outputRoot, "original", `${route.slug}.png`), Buffer.from(screenshot.data, "base64"));
    return { route, response: documentResponse, metrics: metrics.result.value };
  } finally {
    await target.close();
  }
}

async function captureCloneWithCdp(route) {
  const url = new URL(route.path, cloneOrigin).toString();
  const target = await createCdpTarget(url, cloneCdpPort);
  let documentResponse = null;
  try {
    target.on("Network.responseReceived", ({ response, type }) => {
      if (type === "Document" && new URL(response.url).pathname === route.path) {
        documentResponse = { status: response.status, mimeType: response.mimeType };
      }
    });
    await target.send("Page.enable");
    await target.send("Network.enable");
    await target.send("Runtime.enable");
    await target.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const loaded = target.once("Page.loadEventFired").catch(() => null);
    await target.send("Page.navigate", { url });
    await loaded;
    const stored = await target.send("Runtime.evaluate", {
      expression: "(()=>{const value=localStorage.getItem('fcfl-theme');localStorage.removeItem('fcfl-theme');return value})()",
      returnByValue: true,
    });
    if (stored.result.value) {
      const reloaded = target.once("Page.loadEventFired").catch(() => null);
      await target.send("Page.reload", { ignoreCache: true });
      await reloaded;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, route.path === "/membership" ? 7_000 : 2_500));
    await target.send("Runtime.evaluate", {
      expression: "(async()=>{await document.fonts?.ready; document.scrollingElement.scrollTop=0; scrollTo(0,0); return true})()",
      awaitPromise: true,
      returnByValue: true,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const metrics = await target.send("Runtime.evaluate", { expression: metricsExpression, returnByValue: true });
    const screenshot = await target.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(resolve(outputRoot, "clone", `${route.slug}.png`), Buffer.from(screenshot.data, "base64"));
    return { route, response: documentResponse, metrics: metrics.result.value, errors: [] };
  } finally {
    await target.close();
  }
}

const cloneBrowser = cloneCdpPort ? null : await chromium.launch({ headless: true });
const cloneContext = cloneBrowser
  ? await cloneBrowser.newContext({ viewport, colorScheme: "dark", deviceScaleFactor: 1 })
  : null;

async function captureClone(route) {
  const page = await cloneContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  try {
    const response = await page.goto(new URL(route.path, cloneOrigin).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.evaluate(async () => {
      await document.fonts?.ready;
      document.scrollingElement.scrollTop = 0;
      scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(metricsExpression);
    await page.screenshot({
      path: resolve(outputRoot, "clone", `${route.slug}.png`),
      fullPage: false,
      animations: "disabled",
    });
    return {
      route,
      response: response ? { status: response.status(), mimeType: response.headers()["content-type"] ?? null } : null,
      metrics,
      errors,
    };
  } finally {
    await page.close();
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  viewport,
  originalOrigin,
  cloneOrigin,
  pages: [],
};

try {
  for (const [index, route] of routes.entries()) {
    process.stdout.write(`[${index + 1}/${routes.length}] ${route.path} original... `);
    const original = await captureOriginal(route);
    process.stdout.write("clone... ");
    const clone = cloneCdpPort ? await captureCloneWithCdp(route) : await captureClone(route);
    report.pages.push({ route, original, clone });
    console.log(`done (${original.response?.status ?? "?"}/${clone.response?.status ?? "?"})`);
  }
} finally {
  if (cloneBrowser) await cloneBrowser.close();
}

await writeFile(resolve(outputRoot, "metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Captured ${report.pages.length} matched route pairs at ${viewport.width}x${viewport.height}.`);
console.log(resolve(outputRoot, "metrics.json"));
