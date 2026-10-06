# Build multi-stage untuk dashboard Next.js.
# syntax=docker/dockerfile:1
#
# Konteks build adalah AKAR REPO, bukan dashboard/ — sengaja.
# Dashboard mengimpor modul bot lewat alias `@bot/*` (validasi,
# tipe, katalog bahasa, kanal invalidasi) dan memakai client
# Prisma hasil generate milik bot (src/generated/prisma). Membangun
# dari dashboard/ saja berarti harus menyalin modul-modul itu, dan
# salinan adalah cara paling pasti untuk membuat paritas /config
# basi tanpa ada tes yang gagal (lihat tests/fieldParity.test.ts).

FROM node:22-alpine AS deps
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
# Schema + konfigurasi CLI wajib hadir sebelum `npm ci`: seperti
# milik bot, `prisma generate` dijalankan eksplisit, bukan diserahkan
# ke postinstall, supaya client pasti sesuai schema yang disalin.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci && npx prisma generate

FROM deps AS build
COPY dashboard/tsconfig.json dashboard/next.config.mjs ./
COPY dashboard/app ./app
COPY dashboard/components ./components
COPY dashboard/lib ./lib
# Sumber modul `@bot/*`. `src/generated/prisma` hasil tahap
# `deps` tetap ada: COPY menggabungkan isi direktori, tidak
# menimpa berkas yang sudah ada.
COPY src ./src
# Generate ulang (idempoten) supaya client pasti sesuai schema
# yang baru disalin, lalu build dan buang devDependencies —
# CLI prisma, TypeScript, dan vitest tidak ikut ke image runtime.
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs

# Jalankan sebagai user non-root bawaan image (uid 1000).
USER node

EXPOSE 3000

# `next start` membaca port dari flag, bukan dari DASHBOARD_PORT
# milik dashboard — wrapper ini menjembatani keduanya supaya satu
# variabel lingkungan yang mengatur port di mana pun dashboard
# dijalankan (compose, systemd, manual).
CMD ["sh", "-c", "exec npx next start -p \"${DASHBOARD_PORT:-3000}\""]
