# Fat Cat Fab Lab Self-Hosted Rebuild Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Reproduce the current fatcatfablab.org website faithfully on a self-hosted, maintainable codebase with shared navigation, footer, layout, and page templates.

**Architecture:** Use Astro in Node server mode. Public routes render from normalized local content and assets; shared components own all universal chrome. Password-protected pages remain server-only and read their content and password from ignored/mounted private data, preventing protected copy from entering public bundles. Existing external integrations—Luma, Google Calendar, Docuseal, Slack, Stripe, social links, and the wiki—remain functional without Squarespace runtime dependencies.

**Tech Stack:** Astro, `@astrojs/node`, TypeScript, CSS, Vitest, Playwright, Docker/Node 22.

**Source references:**
- `research/admin-page-inventory.json`: 42 Squarespace collection records.
- `research/admin-pages/`: authenticated JSON snapshots, including disabled and protected pages.
- `research/pages/`: 25 public route captures with desktop/mobile screenshots and rendered HTML.
- `research/assets/manifest.json`: 22 original first-party content assets with hashes.
- `research/styles/{site.css,custom.css}`: current compiled template CSS and 660-byte custom override.

**Observable completion criteria:**
- Shared header, mobile navigation, footer, logo, typography, colors, banner treatment, and responsive behavior match the current site.
- All current enabled routes resolve with the same content and intended SEO/indexing behavior.
- The stale `/classes` URL is preserved as a redirect to `/classes-events` rather than a broken internal link.
- Member Portal and Join2 content never appears in public HTML, generated static assets, or client JavaScript before authentication.
- Stripe email-gated checkout, Luma, Google Calendar, Docuseal, Slack, wiki, and social links work.
- Playwright checks every enabled route at desktop and mobile widths, records screenshots, checks console/page errors, and verifies internal links/assets.
- A private deployment is exercised before any DNS change.

---

### Task 1: Bootstrap the Astro server project

**Objective:** Create the smallest production-ready Astro Node server with test and build commands.

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/env.d.ts`
- Create: `src/pages/healthz.ts`
- Create: `tests/health.test.ts`
- Modify: `.gitignore`

**Steps:**
1. Add a failing Vitest assertion that `GET /healthz` returns JSON `{ "ok": true }`.
2. Install Astro, `@astrojs/node`, Vitest, and Playwright.
3. Configure `output: "server"` with standalone Node mode.
4. Implement `/healthz` without additional framework code.
5. Run `npm test` and `npm run build`.
6. Commit `chore: bootstrap Astro server`.

### Task 2: Normalize captured Squarespace content and local assets

**Objective:** Generate stable, reviewed content records rather than reading raw Squarespace exports at runtime.

**Files:**
- Create: `scripts/generate-site-content.mjs`
- Create: `src/data/pages.json`
- Create: `src/data/navigation.json`
- Create: `src/data/redirects.json`
- Create: `src/data/site.json`
- Create: `src/lib/content.ts`
- Create: `public/assets/*`
- Create: `tests/content.test.ts`
- Create ignored runtime file: `private-content/protected-pages.json`

**Steps:**
1. Write tests for the exact main/footer navigation order, unique routes, active/disabled separation, protected-page separation, and complete source-asset rewriting.
2. Parse `research/admin-pages/*/squarespace.json` and the admin inventory.
3. Normalize enabled public collections into `src/data/pages.json`; keep disabled collections out of generated routes.
4. Write Member Portal and Join2 only to `private-content/protected-pages.json`.
5. Copy the 22 hashed original assets into `public/assets/` and rewrite Squarespace CDN URLs to local paths.
6. Preserve route metadata: title, description, banner data, noindex status, canonical path, and raw block HTML.
7. Generate `/classes -> /classes-events` and any other verified legacy redirects.
8. Run tests and verify no protected-page phrases appear beneath `src/` or `public/`.
9. Commit `feat: normalize Squarespace content and assets`.

### Task 3: Implement universal site chrome

**Objective:** Reproduce the Bedford/Anya-era header, desktop/mobile navigation, footer, and shared document metadata once.

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/Header.astro`
- Create: `src/components/Navigation.astro`
- Create: `src/components/Footer.astro`
- Create: `src/components/SocialLinks.astro`
- Create: `src/styles/global.css`
- Create: `public/scripts/navigation.js`
- Create: `tests/chrome.test.ts`

**Steps:**
1. Write structural tests for one logo, one main navigation data source, one footer navigation data source, focusable mobile toggle, and current-page state.
2. Implement the white 85px desktop header, oversized teal shield logo, teal hamburger, and overlay mobile menu.
3. Implement the accepted custom CSS geometry: 230px desktop logo, 150px mobile logo, 85px content/banner offset, and mobile toggle placement.
4. Implement the shared footer with member/equipment/calendar/contact links, address, email, and social links.
5. Add keyboard, focus-visible, Escape, and outside-click behavior to mobile navigation.
6. Run tests and build.
7. Commit `feat: add shared site chrome`.

### Task 4: Implement reusable page and index templates

**Objective:** Render all public content through a small number of template types instead of copied page files.

**Files:**
- Create: `src/components/Banner.astro`
- Create: `src/components/SquarespaceBlocks.astro`
- Create: `src/layouts/StandardPage.astro`
- Create: `src/layouts/IndexPage.astro`
- Create: `src/pages/index.astro`
- Create: `src/pages/[...slug].astro`
- Create: `src/styles/content.css`
- Create: `tests/routes.test.ts`

**Steps:**
1. Write tests that every enabled public route is generated and every disabled route is absent.
2. Implement standard page banners using captured background images/video fallbacks, centered title, and description treatment.
3. Implement the Home index as ordered child sections from the captured index collection.
4. Render preserved block HTML while removing Squarespace editor/runtime attributes and scripts.
5. Port only the required Bedford grid/content selectors into maintainable local CSS.
6. Preserve exact desktop/mobile text measure, spacing, heading weights, button borders, horizontal rules, and image geometry.
7. Run tests and build.
8. Commit `feat: render migrated pages from shared templates`.

### Task 5: Restore integrations and protected routes

**Objective:** Replace Squarespace-dependent behavior with narrow, verified local equivalents.

**Files:**
- Create: `src/middleware.ts`
- Create: `src/pages/member-portal.astro`
- Create: `src/pages/membership2.astro`
- Create: `src/pages/api/protected-login.ts`
- Create: `src/components/StripeEmailGate.astro`
- Create: `public/scripts/stripe-email-gate.js`
- Create: `.env.example`
- Create: `tests/protected-routes.test.ts`
- Create: `tests/integrations.test.ts`

**Steps:**
1. Write tests proving protected content is unavailable without a valid signed session and absent from public bundles.
2. Implement an environment-backed password gate with secure, HTTP-only, same-site cookies and rate-limited login attempts.
3. Load protected page HTML only on the server from the ignored/mounted private content file.
4. Reimplement the existing email-first Stripe pricing-table/buy-button flow using the current Worker endpoint, existing public Stripe IDs, and Stripe’s official buy-button script.
5. Preserve Luma and Google Calendar iframes with their captured dimensions and responsive wrappers.
6. Preserve Docuseal, Slack, wiki, Meetup, social, and mail links exactly.
7. Preserve `noindex` on payment, protected, and utility pages.
8. Run focused tests and the production build.
9. Commit `feat: restore integrations and protected pages`.

### Task 6: Add deterministic browser QA

**Objective:** Prove visual and functional parity on the actual rendered site.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/site.spec.ts`
- Create: `scripts/compare-reference-screenshots.mjs`
- Create: `scripts/check-built-site.mjs`

**Steps:**
1. Start the built server on a strict local port.
2. Visit every enabled route at 1440×1000 and 390×844.
3. Assert no page-level horizontal overflow, missing images, broken internal links, client console errors, or uncaught page errors.
4. Exercise mobile menu open/close, keyboard navigation, Stripe email form rendering, and external embed presence.
5. Capture screenshots for every route and compare geometry against `research/pages/*/{desktop,mobile}.png`; maintain a bounded allowlist for dynamic embeds/video frames.
6. Inspect contact sheets of homepage, representative content pages, calendar/embed pages, payment page, and protected login page.
7. Run `npm test`, `npm run build`, and Playwright.
8. Commit `test: add route and visual parity gates`.

### Task 7: Package and privately deploy

**Objective:** Produce a reversible self-hosted release and verify it before DNS changes.

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `README.md`
- Create: `docs/deployment.md`

**Steps:**
1. Build a non-root Node 22 production container with healthcheck.
2. Mount `private-content/` read-only and inject secrets only through environment variables.
3. Run the container locally and verify `/healthz`, public routes, protected login, payment integration, and desktop/mobile screenshots.
4. Deploy privately to the selected self-host target without changing production DNS.
5. Verify the private URL from a real browser and record rollback steps.
6. Commit `ops: package self-hosted release`.

### Task 8: Cut over only after approval

**Objective:** Preserve production continuity and SEO during the final domain move.

**Files:**
- Modify: `docs/deployment.md`
- Create: `docs/cutover-checklist.md`

**Steps:**
1. Inventory existing DNS, Cloudflare, analytics, redirects, and email-related records without modifying them.
2. Lower only the relevant web-record TTL when the cutover window is approved.
3. Back up existing DNS values and document exact rollback records.
4. Obtain final approval on the private preview.
5. Change only web-hosting DNS records; leave mail and unrelated records untouched.
6. Verify TLS, canonical URLs, redirects, sitemap, robots, analytics, protected routes, payment flow, and real desktop/mobile rendering.
7. Keep Squarespace active through the observation window.
8. Revoke temporary Squarespace administrator access after successful cutover.
