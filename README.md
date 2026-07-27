# Fat Cat Fab Lab Self-Hosted

A maintainable Astro/Node reconstruction of `fatcatfablab.org`. Shared layouts own the header, navigation, footer, SEO, and responsive behavior; migrated page records supply the content.

## Local development

```bash
npm ci
npm test
npm run dev
```

Production build:

```bash
npm run build
HOST=127.0.0.1 PORT=4321 npm start
```

`GET /healthz` is process liveness only. Protected deployment readiness is checked separately with `npm run readiness`.

## Public GitHub Pages preview

The Fat Cat Fab Lab organization repository rebuilds all 22 public URL surfaces from `main` after each change:

**https://fatcatfablab.github.io/website/**

Source and deployment history: **https://github.com/fatcatfablab/website**

The Pages artifact is generated from the production server and marked `noindex`. Protected routes, private content, authentication APIs, and deployment secrets are never included.

## Content migration

Authenticated Squarespace captures stay in ignored `research/`. Regenerate normalized content and local assets with:

```bash
node scripts/generate-site-content.mjs
```

The generator writes public records to `src/data/`, copies first-party assets to `public/assets/`, and keeps protected records only in ignored `private-content/`. Never commit `research/`, `private-content/`, `.env.deployment`, or any `.env` file.

## Hardened container deployment

Docker Compose 2.30.0+ is required because the scrypt password hash contains literal `$` bytes and is loaded through a required raw env file.

```bash
cp .env.example .env.deployment
# Generate deployment-only secrets using the non-echoing command in the guide.
mkdir -p private-content
npm run test:packaging
docker compose build --pull
docker compose up -d
docker compose exec -T web npm run readiness
curl --fail http://127.0.0.1:4321/healthz
```

Do not put placeholder or real secrets on command lines. Follow [`docs/deployment.md`](docs/deployment.md) for safe generation, UID/GID 10001 mount ownership, raw Compose verification, reverse-proxy header sanitization, preview controls, image inspection, cutover, and rollback.

## Production safety

- Keep port 4321 private and terminate HTTPS at one sanitizing reverse proxy.
- Do not change DNS during preview; use `curl --resolve`, VPN, or an authenticated tunnel.
- Enforce preview access control plus `private, no-store` and `noindex` at the proxy.
- Use isolated preview secrets and Stripe test/stub mode; never submit live payment actions during preview.
- Keep Squarespace active through cutover verification and leave mail/unrelated DNS records untouched.
- Protected content must remain server-side, in the read-only private mount, and outside image layers/public bundles.
