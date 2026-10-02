# Build multi-stage: dependency → compile TS → image runtime kecil.
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Schema ikut disalin karena `npm ci` menjalankan `prisma generate` (postinstall).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
# Generate ulang (idempoten) supaya client pasti sesuai schema, lalu compile.
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

# Jalankan sebagai user non-root bawaan image (uid 1000).
USER node

# Health check ringan: memastikan artefak build ada di dalam image.
# (Bot tidak membuka port HTTP, jadi health check tidak bisa berupa probe jaringan.)
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD test -f dist/index.js || exit 1

CMD ["node", "dist/index.js"]
