# syntax=docker/dockerfile:1

# Node 20 reached end-of-life in April 2026; SPEC asks for Node 20+, so run on the current LTS (D-022).
ARG NODE_IMAGE=node:24-alpine

# ---- build: compile the server and the Vite web UI with dev dependencies ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build

# ---- deps: production dependencies only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Served at / and /assets by src/shared/web.ts (resolved as ../../web/dist from dist/shared).
COPY --from=build --chown=node:node /app/web/dist ./web/dist
# The migration runner resolves db/migrations relative to dist/shared/migrate.js.
COPY --chown=node:node db/migrations ./db/migrations
COPY --chown=node:node package.json ./

# The official image ships an unprivileged "node" user (uid 1000).
USER node
EXPOSE 3000

# Liveness only: /health does not touch the database. Uses Node's fetch (no curl/wget needed).
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Apply pending migrations (advisory-locked, safe with several instances), then exec node so it
# receives SIGTERM directly and can drain the click buffer (graceful shutdown).
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/main.js"]
