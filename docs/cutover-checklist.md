# Cutover Checklist

Do not use this checklist until the private replacement has passed browser QA and received explicit approval.

## Current boundaries

- Authoritative DNS is on Cloudflare (`leah.ns.cloudflare.com`, `logan.ns.cloudflare.com`).
- Root and `www` are Cloudflare-proxied.
- Google mail delivery and verification/SPF TXT records exist and must remain untouched.
- `wiki.fatcatfablab.org` points to Miraheze and is outside this migration.
- `rez.fatcatfablab.org` points to the existing reservation application and is outside this migration.
- The complete pre-cutover public DNS snapshot is stored locally in ignored `research/dns-snapshot.json`.

## Before changing DNS

- [ ] Production container is running on the selected self-host target.
- [ ] Private preview passes all desktop/mobile route checks.
- [ ] Protected routes return no protected copy without authentication.
- [ ] Stripe, Luma, Google Calendar, Docuseal, Slack, wiki, Meetup, email, and social links work.
- [ ] `/classes` redirects to `/classes-events`.
- [ ] Sitemap, robots, canonical URLs, Open Graph metadata, and noindex routes are correct.
- [ ] TLS and health monitoring work on the target origin.
- [ ] Existing Cloudflare web-record values and settings are backed up.
- [ ] Rollback commands/values are written down.
- [ ] Final preview approval is recorded.

## DNS change boundary

Change only the root/`www` web-hosting origin records required for the new site. Do not modify:

- MX records
- SPF or verification TXT records
- Nameservers
- `wiki`
- `rez`
- Any unrelated subdomain

## Immediate verification

- [ ] Root and `www` resolve through Cloudflare to the new origin.
- [ ] HTTPS certificate is valid.
- [ ] `/healthz` returns HTTP 200 JSON.
- [ ] Homepage hard-refresh renders without cached Squarespace assets.
- [ ] All enabled routes return the intended status.
- [ ] Protected login works from a fresh browser context.
- [ ] Payment flow reaches Stripe using a controlled test address.
- [ ] Mobile navigation, images, embeds, and downloads work.
- [ ] Browser console has no uncaught errors on representative routes.
- [ ] Cloudflare cache behavior does not cache authenticated responses.

## Observation and rollback

Keep Squarespace active during the observation window. If a launch-blocking regression appears, restore the exact backed-up root/`www` records, purge only affected Cloudflare cache entries, and verify the original site before further changes.

Revoke temporary Squarespace administrator access only after the replacement has remained stable through the agreed observation window.
