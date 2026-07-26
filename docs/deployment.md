# Deployment

## Supported runtime and release gates

- Docker Engine with Docker Compose **2.30.0 or newer** (required for `env_file.format: raw`).
- The image is pinned to Node 22 Bookworm Slim by digest and verifies npm `10.9.8` during the build.
- The service runs as fixed UID/GID `10001:10001`, has a read-only root filesystem, a bounded `/tmp` tmpfs, no Linux capabilities, and `no-new-privileges`.
- The protected content directory is a read-only bind mount. Secrets are runtime environment values and are never copied into the image.
- `GET /healthz` is **liveness only**. `npm run readiness` separately validates the auth configuration and private mount schema without printing values.
- HTTPS terminates at one explicitly trusted reverse proxy. Port 4321 remains bound to loopback.

Do not deploy until every gate below passes.

## Create deployment inputs without exposing values

Never put real values in `.env.example`, shell history, command arguments, Compose YAML, tickets, or logs. Create a deployment-only raw env file and generate both values into it. The password is read silently and piped over stdin; the generator emits no secret to stdout or stderr.

```bash
umask 077
cp .env.example .env.deployment
IFS= read -r -s -p 'Protected-site password: ' FCFL_PASSWORD
printf '\n'
printf '%s' "$FCFL_PASSWORD" | node scripts/generate-deployment-secrets.mjs --env-file .env.deployment
unset FCFL_PASSWORD
chmod 0600 .env.deployment
```

The generator uses the application's exact `scrypt$16384$8$1$<salt>$<digest>` format and creates an independent 48-byte random session secret. Run it separately for preview and production; never copy either environment's secrets to the other.

Compose loads `.env.deployment` with long syntax and `format: raw`. This is mandatory: ordinary Compose interpolation treats `$...` inside a scrypt hash as substitutions. `npm run test:packaging` renders Compose with a synthetic 83-character hash and verifies that Compose's canonical `$$` escaping round-trips byte-for-byte to the original `$` value. No real secret is used.

## Prepare the private mount

The host directory must already exist; Compose deliberately sets `create_host_path: false` so a typo cannot become an empty directory. Give only container UID/GID 10001 access:

```bash
install -d -m 0500 private-content
# Place the real file without printing it, then:
chown -R 10001:10001 private-content
chmod 0400 private-content/protected-pages.json
```

On rootless Docker or user-namespace-remapped hosts, map container UID/GID 10001 to the corresponding host IDs before applying ownership. Do not make the file world-readable as a workaround. Confirm the mapping with `docker inspect` and an in-container `id`; deployment is blocked until UID 10001 can read the file.

## Build, config, readiness, and liveness

```bash
docker compose version
npm run test:packaging
docker compose config --quiet
docker compose build --pull

docker compose up -d
docker compose exec -T web npm run readiness
docker compose ps
a=$(curl --silent --show-error --fail http://127.0.0.1:4321/healthz)
test "$a" = '{"ok":true}'
docker compose logs --no-color web
```

A failing readiness command blocks protected traffic even if `/healthz` is healthy. Do not put the readiness command in the Docker health check: malformed private content or rotated credentials should fail the deployment gate without turning process liveness into a secret-dependent restart loop.

The health check reads `process.env.PORT`; it does not hard-code a different internal check port. Compose publishes only `127.0.0.1:4321`. Keep that loopback binding or replace it with a private container network reachable only by the proxy.

## Reverse proxy trust boundary

The supported topology is exactly:

```text
client -> TLS reverse proxy -> 127.0.0.1:4321 (Astro)
```

The proxy must **overwrite**, never append or pass through, all forwarded headers:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_pass http://127.0.0.1:4321;
```

Set `FCFL_TRUST_PROXY=true` only for this topology, after firewalling direct application access. If a CDN/load balancer exists in front, do not reuse this setting blindly: restrict the edge proxy to the provider's authenticated source ranges, sanitize there, and repeat the tests below for every hop. The app must never trust an arbitrary client-supplied forwarded chain.

Before release, temporarily route the proxy upstream to a loopback-only request-header inspector and use `curl --resolve` (not DNS) to send forged `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and multi-hop `X-Forwarded-For` values. Capture the inspector output and prove the upstream receives exactly the configured public host, `https`, and the proxy-observed client address—none of the forged values. Restore the Astro upstream, then verify:

```bash
# Replace addresses locally; --resolve makes no DNS change.
curl --resolve preview.example.test:443:SERVER_IP \
  -H 'X-Forwarded-Host: attacker.invalid' \
  -H 'X-Forwarded-Proto: http' \
  -H 'X-Forwarded-For: 198.51.100.8, 203.0.113.9' \
  -I https://preview.example.test/member-portal
```

Reject release if any redirect/canonical URL uses `attacker.invalid` or `http`, if the backend port is reachable from another host, or if the proxy evidence shows appended client-controlled headers.

### Application host handling

The application emits canonical and social metadata from the fixed `fatcatfablab.org` site configuration rather than request headers. Astro does not consume `X-Forwarded-Host` here. Keep the application port loopback-only, and make the reverse proxy overwrite `Host` plus all forwarded headers as shown above. Re-run the forged-header topology test for the eventual preview and production hostnames.

## Private preview (no DNS changes)

1. Create a preview-only `.env.deployment` and password with the generator; never reuse production credentials or session secrets.
2. Keep public DNS unchanged. Reach the preview through `curl --resolve`, a local hosts entry, VPN-only name, or an authenticated tunnel.
3. Enforce access control at the reverse proxy (VPN/mTLS, IP allowlist, or separately generated HTTP Basic Auth). The protected-page password is not sufficient preview perimeter control.
4. Force `Cache-Control: private, no-store, max-age=0` and `X-Robots-Tag: noindex, nofollow, noarchive` on **every** preview response at the proxy. Verify those headers on a public page, protected login, successful protected page, redirect, 404, and asset response.
5. Use Stripe test-mode keys or a local stub only. Block live Stripe credentials and live submission endpoints from the preview environment. With browser Network tools open, exercise the UI through the point immediately before submission; verify test/stub hosts and IDs, then cancel. Do not submit a charge, SetupIntent, subscription, or live payment method. If no safe test/stub path exists, payment QA is blocked—not waived.
6. Exercise desktop/mobile pages, redirects, protected login/logout, Luma/calendar embeds, assets, console errors, liveness, and readiness through the exact proxy topology.
7. Obtain explicit approval before any production DNS change.

## Image and runtime inspection

After building, verify the effective controls and look for accidental secret material without printing deployment values:

```bash
docker compose up -d
test "$(docker compose exec -T web id -u)" = 10001
test "$(docker compose exec -T web id -g)" = 10001
docker compose exec -T web sh -c 'test ! -w /app && test -r /app/private-content/protected-pages.json'
docker inspect "$(docker compose ps -q web)" --format '{{json .HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}'

image_id=$(docker compose images -q web)
docker history --no-trunc "$image_id"
docker save "$image_id" -o /tmp/fcfl-image.tar
# Search only for known variable names / forbidden private filenames, never values.
tar -tf /tmp/fcfl-image.tar | grep -E 'deployment\.env|private-content|protected-pages\.json' && exit 1 || true
rm -f /tmp/fcfl-image.tar
```

Also scan the final image with the organization's approved vulnerability/secret scanner. A name-only tar check is a guardrail, not a substitute for a layer-aware scanner.

## Cutover, shutdown, and rollback

The service has a 20-second stop grace period. During cutover, keep the current Squarespace site available, save existing web DNS records, and follow [`cutover-checklist.md`](cutover-checklist.md). Rollback restores only prior web records/image/config. Never alter MX, SPF, DKIM, DMARC, or unrelated service records.

Stop and remove the deployment without deleting host content or secrets:

```bash
docker compose down
```
