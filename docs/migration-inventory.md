# Migration Inventory

Captured from the authenticated Squarespace site on 2026-07-26. This document contains structure only; protected page bodies and credentials are intentionally excluded.

## Scope

- 42 Squarespace collections inventoried
- 21 enabled public pages normalized for the replacement site
- 2 enabled password-protected pages isolated in ignored server-only content
- 19 disabled or archived collections retained in the local migration archive but excluded from generated routes
- 26 first-party images, PDFs, favicons, and helper assets copied locally with provenance and hashes
- 25 current public/browser states captured at desktop and mobile widths

## Shared navigation

Main navigation:

1. About
2. Equipment
3. FAQs
4. Wiki
5. Classes & Events
6. Reservation Calendar
7. Member Portal
8. Join

Footer navigation:

1. Member portal
2. Equipment
3. Calendar
4. Contact

## Public routes

`/`, `/home`, `/about`, `/equipment-list`, `/faqs`, `/classes-events`, `/reservation-calendar`, `/membership`, `/calendar`, `/contact`, `/digital-fabrication`, `/electronics`, `/electronics-info`, `/second-day`, `/fabrics-arts-and-crafts`, `/photography`, `/members`, `/guest-pass`, `/services-payment`, `/laser-cutter`, `/cnc-router`, `/3d-printing`

The legacy internal link `/classes` currently returns a Squarespace 404. The replacement site will redirect it to `/classes-events`.

## Protected routes

- `/member-portal`
- `/membership2`

These routes must remain server-rendered and unavailable in public bundles before authentication. The replacement password is deployment configuration, not source code.

## External integrations to preserve

- Luma calendar on Classes & Events
- Google Calendar embeds on Calendar and Reservation Calendar
- Stripe email-first pricing table/buy-button flow through the existing FCFL Worker
- Docuseal waiver links
- FCFL Slack links
- Fat Cat Fab Lab wiki
- Meetup
- Instagram, Facebook, and X/Twitter
- Google Analytics/legacy analytics metadata where still intentionally retained

## Reference artifacts

All raw captures are local-only beneath ignored `research/`. Public generated content is under `src/data/` and public assets are under `public/assets/`. Protected content is beneath ignored `private-content/` and must be mounted read-only in production.
