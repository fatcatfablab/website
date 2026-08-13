# Maker Workshops

Public intake and RSVP flow: `https://fatcatfablab.github.io/website/maker-workshops/`

## Data

The page writes to a Cloudflare Pages Function backed by the D1 database `fcfl-maker-workshops`.

Tables:
- `participants`: first name, optional email, timestamps
- `workshops`: submitted workshop/class ideas and submitter
- `rsvps`: participant-to-workshop selections

Export all captured data as CSV from a machine authenticated to the Fat Cat Cloudflare account:

```bash
cd worker
npx wrangler d1 execute fcfl-maker-workshops --remote --command \
  "SELECT p.first_name, p.email, w.title AS workshop, r.created_at AS rsvp_created_at FROM rsvps r JOIN participants p ON p.id = r.participant_id JOIN workshops w ON w.id = r.workshop_id ORDER BY r.created_at DESC" \
  --json
```

List every participant, including people who submitted no RSVP:

```bash
npx wrangler d1 execute fcfl-maker-workshops --remote --command \
  "SELECT first_name, email, created_at FROM participants ORDER BY created_at DESC" \
  --json
```

## API deployment

```bash
cd worker
npm ci
npm run db:remote
npm run deploy
curl --fail https://fcfl-maker-workshops-api.pages.dev/health
```

CORS is restricted to the Fat Cat GitHub Pages origin plus local development origins.
