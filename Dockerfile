# syntax=docker/dockerfile:1

# ---- production dependencies only (better-sqlite3 ships a prebuilt binary for linux-x64 glibc) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped on purpose: better-sqlite3 13 ships its prebuilt binaries inside the package, and
# without this npm tries to compile it with node-gyp, which the slim image cannot do.
RUN npm ci --omit=dev --ignore-scripts
# Trim what the runtime never uses: the SQLite sources and the prebuilt binaries of other platforms.
RUN ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"  && cd node_modules/better-sqlite3  && rm -rf deps src binding.gyp  && find prebuilds -type f ! -name "linux-${ARCH}.node" -delete

# ---- build: full dependencies, compile TypeScript to dist/ ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/torneos.db \
    IMAGES_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY migrations ./migrations
# The SQLite database lives in /data (a volume in compose). Created here so a new named volume inherits
# node ownership and the non-root user can write to it.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
