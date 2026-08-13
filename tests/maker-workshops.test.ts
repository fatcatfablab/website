import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Maker Workshops", () => {
  it("provides a three-step dark intake with optional email, N/A idea, refresh, and RSVP controls", () => {
    const page = source("src/pages/maker-workshops.astro");
    expect(page).toContain('data-step="1"');
    expect(page).toContain('data-step="2"');
    expect(page).toContain('data-step="3"');
    expect(page).toContain('type="email"');
    expect(page).toContain("Optional");
    expect(page).toContain("No idea right now");
    expect(page).toContain('id="refresh-button"');
    expect(page).toContain('id="save-rsvps"');
    expect(page).toContain("fcfl-maker-workshops-api.pages.dev");
  });

  it("keeps hidden steps hidden and renders attendee avatars plus persistent session resume", () => {
    const css = source("public/styles/maker-workshops.css");
    const client = source("public/scripts/maker-workshops.js");
    expect(css).toContain("[hidden] { display: none !important; }");
    expect(client).toContain('class="avatar"');
    expect(client).toContain("attendeeCount");
    expect(client).toContain('sessionStorage.getItem("fcfl-maker-participant")');
    expect(client).toContain("showStep(3)");
    expect(client).toContain("loadWorkshops()");
  });

  it("stores participants, workshop ideas, and RSVPs in D1 without exposing email in list responses", () => {
    const migration = source("worker/migrations/0001_initial.sql");
    const api = source("worker/src/index.js");
    expect(migration).toContain("CREATE TABLE participants");
    expect(migration).toContain("CREATE TABLE workshops");
    expect(migration).toContain("CREATE TABLE rsvps");
    expect(api).toContain('url.pathname === "/api/participants"');
    expect(api).toContain('url.pathname === "/api/workshops"');
    expect(api).toContain('url.pathname === "/api/rsvps"');
    expect(api).not.toMatch(/json_object\([^)]*email/);
  });

  it("includes the Maker Workshops route in the GitHub Pages snapshot", () => {
    expect(source("scripts/build-github-pages-preview.mjs")).toContain('"/maker-workshops"');
  });
});
