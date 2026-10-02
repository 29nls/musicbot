# Harmony — Bot Discord Musik & Admin

Bot Discord serbaguna: pemutaran musik berkualitas tinggi (Lavalink) + moderasi
komunitas. Ruang lingkup, perintah, dan roadmap lengkap ada di [PRD.md](PRD.md).

> **Status: M0 (fondasi).** Yang sudah jalan: bootstrap bot, loader perintah &
> event, validasi environment, `/ping`, `/help`, dan stack Docker
> (bot + Lavalink + PostgreSQL + Redis). Fitur musik masuk di M2, moderasi di M3.

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
| --- | --- |
| Node.js **22+** | `node --version` |
| Docker + Docker Compose | untuk Lavalink, PostgreSQL, Redis (opsional saat M0) |
| Aplikasi Discord | dibuat di [Developer Portal](https://discord.com/developers/applications) |

### ⚠️ Wajib: aktifkan Privileged Intents

Bot ini memakai intent `GuildMembers` dan `MessageContent` (dibutuhkan welcome,
autorole, dan automod). Tanpa ini, `client.login()` akan gagal:

1. Developer Portal → pilih aplikasi → **Bot**
2. Bagian **Privileged Gateway Intents** → aktifkan
   **Server Members Intent** dan **Message Content Intent**
3. Simpan

### Ambil nilai yang dibutuhkan

| Variabel | Lokasi di Developer Portal |
| --- | --- |
| `DISCORD_TOKEN` | Bot → Reset Token |
| `DISCORD_CLIENT_ID` | General Information → Application ID |
| `DEV_GUILD_ID` | Klik kanan servermu di Discord → Copy Server ID (mode developer aktif) |

---

## 2. Menjalankan secara lokal

```bash
# 1. Dependency
npm install

# 2. Konfigurasi
cp .env.example .env      # lalu isi DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID

# 3. Infrastruktur (Lavalink + Postgres + Redis) yang bisa diakses dari host
npm run infra:up

# 4. Daftarkan slash command ke server dev (instan)
npm run deploy

# 5. Jalankan bot
npm run dev
```

Kalau berhasil, log akan menampilkan `Semua perintah dimuat`, `Semua event
terpasang`, lalu `✅ Harmony siap menerima perintah`. Coba `/ping` di servermu.

> **Tanpa Docker?** Langkah 3 boleh dilewati selama M0 — nilai `DATABASE_URL`,
> `REDIS_URL`, dan `LAVALINK_*` hanya divalidasi bentuknya, belum dipakai untuk
> koneksi. Diperlukan mulai M1 (database) dan M2 (musik).
>
> `npm run infra:up` memakai `docker-compose.dev.yml` yang membuka port ke
> `127.0.0.1` (Lavalink 2333, Postgres 5432, Redis 6379) supaya bot dari host
> bisa terhubung. `docker compose up -d` biasa tidak membukanya — lihat bagian
> berikut.

### Menjalankan seluruh stack lewat Docker

```bash
docker compose up -d --build
docker compose logs -f bot
```

Compose otomatis mengganti `DATABASE_URL`, `REDIS_URL`, dan `LAVALINK_HOST`
menjadi hostname container (`postgres`, `redis`, `lavalink`), jadi nilai di
`.env` hanya dipakai saat bot dijalankan dari host.

| File | Kapan dipakai |
| --- | --- |
| `docker-compose.yml` | Produksi/self-host: semua service termasuk bot. Port infrastruktur **tidak** dibuka ke luar |
| `docker-compose.dev.yml` | Overlay saat bot dijalankan dari host (`npm run infra:up`) |

---

## 3. Struktur proyek

```
src/
├─ commands/
│  ├─ core/            # /ping, /help            (M0 — selesai)
│  ├─ music/           # /play, /queue, ...      (M2)
│  └─ admin/           # /ban, /warn, ...        (M3)
├─ events/             # satu file = satu event  (clientReady, interactionCreate, ...)
├─ handlers/           # loader perintah & event (auto-discovery, tidak perlu daftar manual)
├─ modules/            # logika domain
│  ├─ music/           # queue manager, pemutar (M2)
│  ├─ moderation/      # case manager, cek hierarki role (M3)
│  ├─ automod/         # rule engine (M4)
│  ├─ logging/         # event → embed log (M4)
│  └─ config/          # config per-server dari DB (M1)
├─ services/           # logger, (M1: prisma, redis)
├─ utils/              # cooldown, embed, durasi, module loader
├─ config/             # env (zod) + konstanta
├─ client.ts           # BotClient: intents + registry perintah
├─ deploy-commands.ts  # daftarkan slash command ke Discord
└─ index.ts            # entrypoint + graceful shutdown
```

### Menambah perintah baru

Buat file `.ts` di `src/commands/<kategori>/`, contoh `src/commands/core/uptime.ts`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder().setName('uptime').setDescription('Lama bot berjalan'),
  category: 'core',
  cooldownSeconds: 5,
  guildOnly: true,
  async execute(interaction, client) {
    await interaction.reply({ embeds: [infoEmbed('⏱️ Uptime', `${client.uptime} ms`)] });
  },
} satisfies BotCommand;
```

Loader akan menemukannya otomatis saat start. Setelah menambah/mengubah perintah,
jalankan `npm run deploy` supaya Discord mengenalinya.

### Menambah event baru

`src/events/<nama>.ts` dengan `name` dari `Events.*` discord.js. Loader otomatis
mendaftarkannya, dan error di satu handler tidak mematikan proses.

---

## 4. Perintah npm

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Jalankan bot dengan auto-reload (tsx watch) |
| `npm run build` | Compile TypeScript ke `dist/` |
| `npm start` | Jalankan hasil build (produksi) |
| `npm run deploy` | Daftarkan slash command (guild dev bila `DEV_GUILD_ID` diisi, jika tidak global) |
| `npm run infra:up` / `infra:down` | Nyalakan/matikan Lavalink + Postgres + Redis untuk dev lokal |
| `npm run typecheck` | TypeScript strict, tanpa emit |
| `npm run lint` / `lint:fix` | ESLint |
| `npm test` / `test:watch` | Vitest |

CI (`.github/workflows/ci.yml`) menjalankan lint → typecheck → test → build di
setiap push/PR.

---

## 5. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `Used disallowed intents` | Privileged intents belum aktif di Developer Portal (lihat bagian 1) |
| `Konfigurasi environment tidak valid: • DISCORD_TOKEN: ...` | `.env` belum diisi / valuenya salah — pesannya menyebut variabel yang bermasalah |
| Slash command tidak muncul | Jalankan `npm run deploy`; untuk pendaftaran global butuh ±1 jam. Coba restart aplikasi Discord (Ctrl+R) |
| Perintah lama masih muncul setelah ganti nama | Developer Portal → Integrations → hapus perintah global lama |
| Bot join voice tapi tidak ada suara | Cek `docker compose logs lavalink`; pastikan `LAVALINK_PASSWORD` di `.env` sama dengan yang dipakai container |
| Lavalink mati saat memutar lagu panjang | Naikkan `JAVA_TOOL_OPTIONS=-Xmx2G` di `docker-compose.yml` |
| Error YouTube "sign in to confirm you're not a bot" | Aktifkan OAuth token di plugin [youtube-source](https://github.com/lavalink-devs/youtube-source#using-oauth-tokens) |

Lihat juga bagian **Legal, Privasi & Kepatuhan** di PRD — sumber audio dan
kewajiban takedown bukan detail teknis yang bisa ditunda.
