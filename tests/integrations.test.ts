import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const syntheticEndpoint = "https://worker.invalid/customer-session";
const syntheticKey = "pk_test_synthetic_publishable_key";
const pricingId = "prctbl_synthetic_preserved_id";
const buyButtonId = "buy_btn_synthetic_preserved_id";
let browser: Browser;
let clientScript = "";

const gateMarkup = (mode: "pricing-table" | "buy-button", capturedId: string) => `
  <div
    class="fcfl-stripe-email-gate"
    data-fcfl-email-gate
    data-endpoint="${syntheticEndpoint}"
    data-publishable-key="${syntheticKey}"
    data-captured-id="${capturedId}"
    data-mode="${mode}"
  >
    <form class="fcfl-stripe-email-form" novalidate>
      <label>Email <input name="email" type="email" required autocomplete="email"></label>
      <button type="submit">Continue</button>
    </form>
    <p data-fcfl-email-status role="status" aria-live="polite"></p>
    <div data-fcfl-stripe-mount></div>
  </div>`;

const openGate = async (mode: "pricing-table" | "buy-button", capturedId: string) => {
  const page = await browser.newPage();
  await page.setContent(gateMarkup(mode, capturedId));
  await page.addScriptTag({ content: clientScript });
  return page;
};

beforeAll(async () => {
  clientScript = await readFile(resolve(root, "public/scripts/stripe-email-gate.js"), "utf8");
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

describe("captured Stripe descriptor integration", () => {
  it("normalizes exactly one typed Stripe descriptor on each intended public page", async () => {
    const pages = JSON.parse(await readFile(resolve(root, "src/data/pages.json"), "utf8")) as Array<{
      slug: string;
      contentHtml: string;
      stripeIntegration: { kind: "pricing-table" | "buy-button"; id: string } | null;
    }>;
    const expected = new Map([
      ["guest-pass", { kind: "pricing-table", prefix: "prctbl_" }],
      ["services-payment", { kind: "buy-button", prefix: "buy_btn_" }],
    ]);

    for (const [slug, descriptor] of expected) {
      const page = pages.find((candidate) => candidate.slug === slug);
      expect(page?.stripeIntegration?.kind).toBe(descriptor.kind);
      expect(page?.stripeIntegration?.id.startsWith(descriptor.prefix)).toBe(true);
      expect(page?.contentHtml.match(/<div\b[^>]*\bid=(?:["'])?fcfl-email-form(?:["'])?[^>]*><\/div>/gi)).toHaveLength(1);
      expect(page?.contentHtml).not.toMatch(/<script\b|fcflRenderEmailForm/i);
    }
  });

  it("uses typed metadata to place one gate while defensively stripping raw scripts", async () => {
    const source = await readFile(resolve(root, "src/components/SquarespaceContent.astro"), "utf8");
    const standardPage = await readFile(resolve(root, "src/templates/StandardPage.astro"), "utf8");
    expect(source).toContain("StripeEmailGate");
    expect(source).toContain("stripeIntegration.id");
    expect(source).toMatch(/replace\(SCRIPT_TAG_PATTERN,\s*["']{2}\)/);
    expect(source).not.toMatch(/set:html=\{contentHtml\}/);
    expect(standardPage.match(/stripeIntegration=\{page\.stripeIntegration\}/g)).toHaveLength(2);
    expect(standardPage).not.toMatch(/<StripeEmailGate\b/);
  });

  it("provides focused responsive styles for protected login and Stripe forms", async () => {
    const css = await readFile(resolve(root, "src/styles/pages.css"), "utf8");
    expect(css).toMatch(/\.protected-login\s*\{/);
    expect(css).toMatch(/\.fcfl-stripe-email-form\s*\{/);
    expect(css).toMatch(/\.fcfl-stripe-widget\s*\{/);
  });
});

describe("Stripe email gate browser behavior", () => {
  it("does not request a session for an invalid email", async () => {
    const page = await openGate("pricing-table", pricingId);
    let requests = 0;
    await page.route(syntheticEndpoint, async (route) => {
      requests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.locator('input[type="email"]').fill("not-an-email");
    await page.locator("form").evaluate((form: HTMLFormElement) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await page.waitForTimeout(50);

    expect(requests).toBe(0);
    expect(await page.locator('input[type="email"]').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
    await page.close();
  });

  it("posts explicit pricing-table fields and mounts the preserved ID with a customer session", async () => {
    const page = await openGate("pricing-table", pricingId);
    let posted = new URLSearchParams();
    await page.route(syntheticEndpoint, async (route) => {
      posted = new URLSearchParams(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: "synthetic_customer_session_secret" }),
      });
    });

    await page.locator('input[type="email"]').fill("member@example.test");
    await page.getByRole("button", { name: "Continue" }).click();
    const widget = page.locator("stripe-pricing-table");
    await widget.waitFor({ state: "attached" });

    expect(posted.get("email")).toBe("member@example.test");
    expect(posted.get("buy_button")).toBe("false");
    expect(await widget.getAttribute("pricing-table-id")).toBe(pricingId);
    expect(await widget.getAttribute("publishable-key")).toBe(syntheticKey);
    expect(await widget.getAttribute("customer-session-client-secret")).toBe("synthetic_customer_session_secret");
    expect(await widget.getAttribute("customer-email")).toBeNull();
    expect(await page.locator("[data-fcfl-stripe-mount] > *").count()).toBe(1);
    await page.close();
  });

  it("posts explicit buy-button fields and supports the validated email fallback", async () => {
    const page = await openGate("buy-button", buyButtonId);
    let posted = new URLSearchParams();
    await page.route(syntheticEndpoint, async (route) => {
      posted = new URLSearchParams(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "buyer@example.test" }),
      });
    });

    await page.locator('input[type="email"]').fill("buyer@example.test");
    await page.getByRole("button", { name: "Continue" }).click();
    const widget = page.locator("stripe-buy-button");
    await widget.waitFor({ state: "attached" });

    expect(posted.get("buy_button")).toBe("true");
    expect(await widget.getAttribute("buy-button-id")).toBe(buyButtonId);
    expect(await widget.getAttribute("customer-email")).toBe("buyer@example.test");
    expect(await widget.getAttribute("customer-session-client-secret")).toBeNull();
    await page.close();
  });

  it("recovers from HTTP and malformed JSON failures without logging the email", async () => {
    const page = await openGate("pricing-table", pricingId);
    const consoleMessages: string[] = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    let attempt = 0;
    await page.route(syntheticEndpoint, async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({ status: 502, contentType: "text/html", body: "upstream unavailable" });
      } else if (attempt === 2) {
        await route.fulfill({ status: 200, contentType: "application/json", body: "not-json" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ email: "retry@example.test" }),
        });
      }
    });

    const input = page.locator('input[type="email"]');
    const button = page.getByRole("button", { name: "Continue" });
    await input.fill("retry@example.test");
    for (let failedAttempt = 0; failedAttempt < 2; failedAttempt += 1) {
      await button.click();
      await expect.poll(() => button.isEnabled()).toBe(true);
      await expect.poll(() => page.locator("[data-fcfl-email-status]").textContent()).toMatch(/try again/i);
    }
    await button.click();
    await page.locator("stripe-pricing-table").waitFor({ state: "attached" });

    expect(attempt).toBe(3);
    expect(consoleMessages.join("\n")).not.toContain("retry@example.test");
    await page.close();
  });

  it("deduplicates overlapping submissions and never creates duplicate mounts", async () => {
    const page = await openGate("pricing-table", pricingId);
    let requests = 0;
    await page.route(syntheticEndpoint, async (route) => {
      requests += 1;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "once@example.test" }),
      });
    });

    await page.locator('input[type="email"]').fill("once@example.test");
    await page.locator("form").evaluate((form: HTMLFormElement) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await page.locator("stripe-pricing-table").waitFor({ state: "attached" });

    expect(requests).toBe(1);
    expect(await page.locator("stripe-pricing-table").count()).toBe(1);
    await page.close();
  });
});
