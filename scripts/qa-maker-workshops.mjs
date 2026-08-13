import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:4321";
const output = new URL("../test-results/maker-workshops/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const runId = Date.now();
const title = `QA Laser Safety ${runId}`;
const errors = [];

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`${origin}/maker-workshops`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${output}/desktop-step-1.png`, fullPage: true });

  await page.getByLabel("First name").fill("Wren QA");
  await page.getByLabel("Email Optional").fill("qa@example.com");
  await page.locator("#identity-form").getByRole("button", { name: /Next/ }).click();
  await page.getByText("Step 2 of 3").waitFor();
  await page.getByLabel("Your idea").fill(title);
  await page.locator("#idea-form").getByRole("button", { name: /Next/ }).click();
  await page.getByText("Step 3 of 3").waitFor();
  await page.getByText(title).waitFor();
  await page.getByText(title).click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.getByText("RSVPs saved.").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/desktop-list-saved.png`, fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Which would you attend?" }).waitFor();
  const selectedAfterReload = await page.getByText(title).locator("xpath=ancestor::label").getAttribute("class");
  if (!selectedAfterReload?.includes("is-selected")) throw new Error("RSVP did not survive reload");
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  mobilePage.on("console", (message) => {
    if (message.type() === "error") errors.push(`mobile console: ${message.text()}`);
  });
  mobilePage.on("pageerror", (error) => errors.push(`mobile pageerror: ${error.message}`));
  await mobilePage.goto(`${origin}/maker-workshops`, { waitUntil: "networkidle" });
  await mobilePage.evaluate(() => sessionStorage.clear());
  await mobilePage.reload({ waitUntil: "networkidle" });
  await mobilePage.getByLabel("First name").fill("Mobile QA");
  await mobilePage.locator("#identity-form").getByRole("button", { name: /Next/ }).click();
  await mobilePage.getByText("Step 2 of 3").waitFor();
  await mobilePage.getByText("No idea right now").click();
  await mobilePage.locator("#idea-form").getByRole("button", { name: /Next/ }).click();
  await mobilePage.getByText("Step 3 of 3").waitFor();
  await mobilePage.getByText(title).waitFor();
  await mobilePage.waitForTimeout(700);
  await mobilePage.screenshot({ path: `${output}/mobile-list.png`, fullPage: true });
  const metrics = await mobilePage.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    step: document.querySelector("#step-label")?.textContent,
  }));
  if (metrics.scrollWidth > metrics.innerWidth) throw new Error(`Mobile horizontal overflow: ${JSON.stringify(metrics)}`);
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ title, screenshots: ["desktop-step-1.png", "desktop-list-saved.png", "mobile-list.png"], errors, ok: true }));
} finally {
  await browser.close();
}
