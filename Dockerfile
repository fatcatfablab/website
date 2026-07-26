FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN test "$(npm --version)" = "10.9.8" && npm ci

FROM dependencies AS build
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN test "$(npm --version)" = "10.9.8" \
  && npm ci --omit=dev \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321
WORKDIR /app
RUN groupadd --system --gid 10001 astro \
  && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /app astro \
  && chown 10001:10001 /app
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --chown=10001:10001 package.json package-lock.json ./
COPY --chown=10001:10001 scripts/check-readiness.mjs ./scripts/check-readiness.mjs
USER 10001:10001
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT||'4321';fetch('http://127.0.0.1:'+port+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "./dist/server/entry.mjs"]
