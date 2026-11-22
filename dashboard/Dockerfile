# Build multi-stage untuk dashboard Next.js.
# syntax=docker/dockerfile:1
#
# Konteks build adalah AKAR REPO. Struktur direktori di container sengaja
# dibuat sama dengan di mesin pengembangan: dashboard di /app/dashboard,
# src di /app/src, node_modules bot di /app/node_modules. Dengan begitu
# alias @bot/* (../src) dan resolusi modul bot (discord.js, zod, dll.)
# tetap bekerja tanpa penyesuaian.

FROM node:24-alpine AS deps
WORKDIR /app
# Dependensi bot + client Prisma.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci && npx prisma generate
# Dependensi dashboard.
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci

FROM deps AS build
# Sumber dashboard.
COPY dashboard/tsconfig.json dashboard/next.config.mjs ./dashboard/
COPY dashboard/app ./dashboard/app
COPY dashboard/components ./dashboard/components
COPY dashboard/lib ./dashboard/lib
# Sumber bot yang diimpor lewat @bot/*.
COPY src ./src
# Generate ulang client Prisma (idempoten), lalu build dashboard.
RUN npx prisma generate
WORKDIR /app/dashboard
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=build --chown=node:node /app/dashboard/.next ./dashboard/.next
COPY --from=build --chown=node:node /app/dashboard/package.json ./dashboard/package.json
COPY --from=build --chown=node:node /app/dashboard/next.config.mjs ./dashboard/next.config.mjs
COPY --from=build --chown=node:node /app/src ./src

USER node
EXPOSE 3000
CMD ["sh", "-c", "cd /app/dashboard && exec npx next start -p \"${DASHBOARD_PORT:-3000}\""]