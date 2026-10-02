# Harmony — Bot Discord Musik & Admin

Bot Discord serbaguna: pemutaran musik berkualitas tinggi (Lavalink) + moderasi
komunitas. Ruang lingkup, perintah, dan roadmap lengkap ada di [PRD.md](PRD.md).

> **Status: M4 (automod).**
> Sudah jalan: bootstrap bot, loader perintah & event otomatis, validasi
> environment, database PostgreSQL + Prisma, konfigurasi per-server dengan cache
> + wizard `/setup`, `/config`, **pemutaran musik lewat Lavalink**
> (`/play`, `/queue`, `/nowplaying`, `/skip`, `/pause`, `/resume`, `/stop`),
> **moderasi lengkap dengan ID kasus** (`/ban`, `/unban`, `/kick`, `/timeout`,
> `/warn`, `/warnings`, `/unwarn`, `/purge`, `/slowmode`, `/lock`, `/unlock`,
> `/note`), **welcome/goodbye + autorole** otomatis, **automod 7 rule** dengan
> whitelist (`/automod`), `/ping`, `/help`, dan stack Docker (bot + migrasi +
> Lavalink + PostgreSQL + Redis).
> Berikutnya: logging 6 kategori (sisa M4) dan sisa fitur musik (`/volume`,
> `/loop`, `/seek`, `/shuffle`, `/disconnect`) mengikuti PRD.

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
| --- | --- |
| Node.js **22+** | `node --version` |
| Docker + Docker Compose | untuk PostgreSQL, Lavalink, Redis |
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
# 1. Dependency (sekaligus generate Prisma Client lewat postinstall)
npm install

# 2. Konfigurasi
cp .env.example .env      # lalu isi DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID

# 3. Infrastruktur (PostgreSQL + Lavalink + Redis) yang bisa diakses dari host
npm run infra:up

# 4. Terapkan skema database
npm run db:migrate        # saat pengembangan: buat + terapkan migrasi
# npm run db:deploy       # alternatif: hanya menerapkan migrasi yang sudah ada

# 5. Daftarkan slash command ke server dev (instan)
npm run deploy

# 6. Jalankan bot
npm run dev
```

Kalau berhasil, log menampilkan `Semua perintah dimuat`, `Semua event terpasang`,
`Database terhubung`, lalu `✅ Harmony siap menerima perintah`. Coba `/setup` di
servermu.

> **Database mati bukan masalah fatal.** Bot tetap start dan `/ping` tetap jalan;
> hanya perintah yang butuh konfigurasi (`/setup`, `/config`) yang akan menolak
> dengan pesan "Database tidak bisa dihubungi".

### Menjalankan seluruh stack lewat Docker

```bash
docker compose up -d --build
docker compose logs -f bot
```

Service `migrate` menjalankan `prisma migrate deploy` sebelum `bot` start, jadi
skema database selalu terbaru tanpa langkah manual.

| File | Kapan dipakai |
| --- | --- |
| `docker-compose.yml` | Produksi/self-host: semua service termasuk bot. Port infrastruktur **tidak** dibuka ke luar |
| `docker-compose.dev.yml` | Overlay saat bot dijalankan dari host (`npm run infra:up`) |

Compose otomatis mengganti `DATABASE_URL`, `REDIS_URL`, dan `LAVALINK_HOST`
menjadi hostname container (`postgres`, `redis`, `lavalink`), jadi nilai di
`.env` hanya dipakai saat bot dijalankan dari host.

---

## 3. Konfigurasi per server (M1)

Semua pengaturan disimpan di tabel `guild_config` (satu baris per server) dan
di-cache 60 detik di memori. **Perubahan langsung berlaku tanpa restart bot** —
`update()` menulis ulang cache setelah menyimpan ke database.

### `/setup` — wizard interaktif

Menampilkan konfigurasi yang berlaku sekarang, lalu membiarkan kamu mengubahnya
lewat menu (channel log, channel welcome, role DJ, modul aktif) dan tombol
**Simpan**. Habis 5 menit tanpa aktivitas, komponennya otomatis dimatikan.

### `/config` — kontrol presisi

| Subcommand | Fungsi |
| --- | --- |
| `/config show` | Tampilkan konfigurasi yang berlaku |
| `/config set` | Ubah sebagian pengaturan (opsi yang dikosongkan tidak diubah) |
| `/config reset` | Hapus barisnya dan kembali ke default |

Opsi `/config set`: `log-channel`, `welcome-channel`, `goodbye-channel`,
`dj-role`, `autorole` (member manusia), `autorole-bot` (bot baru),
`volume` (0–200), `idle-timeout` (30–86400 detik),
`welcome-message` & `goodbye-message` (placeholder `{user}` `{mention}`
`{server}` `{count}`), serta `music` / `moderation` / `automod` / `logging`
(true/false) untuk menyalakan-matikan modul.

Keduanya butuh izin **Manage Server** dan hanya bisa dipakai di dalam server.
Nilai yang tidak valid ditolak sebelum menyentuh database, dengan pesan yang
menyebut field bermasalahnya.

### Menambah field konfigurasi baru

1. Tambahkan kolom di [prisma/schema.prisma](prisma/schema.prisma) (dan field di
   [types.ts](src/modules/config/types.ts)).
2. `npm run db:migrate` — Prisma membuat file migrasi baru.
3. Tambahkan nama field ke `guildConfigPatchSchema` di
   [validation.ts](src/modules/config/validation.ts) kalau boleh diubah user.
4. Field baru otomatis ikut terbaca lewat `toDomain()` — jangan lupa tes.

---

## 4. Perintah musik (M2)

| Perintah | Fungsi | Izin |
| --- | --- | --- |
| `/play <query>` | Cari lalu putar, atau tambahkan ke antrean. Kata kunci → pencarian YouTube; URL diteruskan apa adanya | Semua (harus di voice channel) |
| `/queue` | Lagu yang sedang diputar + 10 lagu berikutnya | Semua |
| `/nowplaying` | Embed lagu aktif: progress bar, volume, sisa antrean | Semua |
| `/skip` | Lewati lagu sekarang | DJ |
| `/pause` / `/resume` | Jeda / lanjutkan pemutaran | DJ |
| `/stop` | Hentikan dan bersihkan antrean (bot tetap di voice channel) | DJ |

**Aturan yang berlaku**

- **Role DJ** diambil dari konfigurasi server. Kalau belum diatur, semua orang
  boleh mengontrol; pemegang **Manage Server** selalu boleh.
- Bot yang sedang memutar di satu channel tidak bisa dikendalikan dari channel
  lain — user diminta pindah (kecuali Manage Server).
- Antrean dibatasi `MAX_QUEUE_SIZE` (default 500). Kelebihan lagu dari sebuah
  playlist dipotong dan jumlahnya dilaporkan di embed.
- Setelah antrean habis, bot menunggu `idleTimeoutSec` (lihat `/config set`)
  lalu keluar sendiri dari voice channel.
- Bot bergabung sebagai *deafened* supaya tidak memproses audio yang tidak perlu.
- Kesalahan (bukan di voice channel, bukan DJ, antrean penuh) dibalas sebagai
  pesan privat, sedangkan hasil yang perlu dilihat semua orang tetap publik.

### Cara bot memegang state

`player.track` milik Lavalink hanya berisi data base64 — tanpa judul, artis, atau
metadata lain. Karena itu **antrean dan lagu aktif disimpan oleh bot**
([queue.ts](src/modules/music/queue.ts), [musicService.ts](src/modules/music/musicService.ts)),
dan perpindahan lagu dikendalikan event `end` dari Lavalink (event `replaced`
diabaikan agar tidak melompat dua kali). Konsekuensinya wajar: restart bot
mengosongkan antrean.

Kalau Lavalink mati saat memutar, node akan dicoba sambung ulang dan player
dipindahkan ke node lain bila ada (`moveOnDisconnect`). Perintah musik memberi
pesan jelas “Lavalink belum terhubung” alih-alih gagal diam-diam.

---

## 5. Moderasi & onboarding (M3)

| Perintah | Fungsi | Izin |
| --- | --- | --- |
| `/ban <user> [reason] [delete-messages 0–7]` | Ban member; opsional hapus pesannya | Ban Members |
| `/kick <user> [reason]` | Kick member | Kick Members |
| `/timeout <user> <duration> [reason]` | Bisukan sementara (`30s`, `10m`, `2h`, `7d`; maks 28 hari) | Moderate Members |
| `/warn <user> <reason>` | Peringatan tersimpan | Moderate Members |
| `/warnings <user>` | Riwayat peringatan (10 terbaru + total) | Moderate Members |
| `/unwarn <case>` | Cabut peringatan (`#CASE-0007` atau `7`) | Moderate Members |
| `/unban <user-id> [reason]` | Buka ban berdasarkan ID user | Ban Members |
| `/slowmode <duration> [reason]` | Slowmode channel (`0`/`off`, `30s`, `5m`, `2h`; maks 6 jam) | Manage Channels |
| `/lock [reason]` | Tolak `Send Messages` (teks) / `Connect` (voice) untuk @everyone | Manage Channels |
| `/unlock [reason]` | Hapus override kunci — izin kembali ke default server | Manage Channels |
| `/note add <user> <content>` | Catatan internal (target tidak diberi tahu) | Moderate Members |
| `/note show <user>` | Lihat catatan terbaru seorang member | Moderate Members |
| `/purge <amount> [user] [contains]` | Hapus pesan massal (maks 100) | Manage Messages |

**Aturan yang berlaku**

- Setiap aksi punya **ID kasus** (`#CASE-0142`) yang muncul di balasan, DM
target, dan channel log.
- **Anti-hierarki**: self-moderation, bot sendiri, dan pemilik server ditolak;
role bot dan role moderator harus benar-benar di atas role target. Semua
diperiksa *sebelum* aksi dieksekusi.
- **Selalu DM target** untuk aksi terhadap user (ban/kick/timeout/warn/unban) dan
**selalu kirim log** ke `logChannelId` — best-effort. Kalau DM tertutup atau
channel log belum diatur, aksi tetap jalan dan hasilnya mencatat apa yang gagal.
Aksi channel (`/slowmode`, `/lock`, `/unlock`) dan `/note` tidak mengirim DM.
- `/note` murni internal: tercatat sebagai kasus tanpa mengubah apa pun di
Discord, dan bisa dibaca lagi lewat `/note show`. Tanpa cek hierarki — mencatat
pemilik server pun tidak apa-apa.
- `/lock`/`/unlock` bekerja di channel tempat perintah dipanggil: channel teks
menolak `Send Messages`, channel voice menolak `Connect`; `/unlock` menghapus
override sehingga izin kembali mengikuti default server (bukan dipaksa allow).
- Kasus dicatat **lebih dulu** di database; kalau eksekusi Discord gagal, kasus
ditandai tidak aktif sehingga tidak ada aksi “hantu”. Database offline berarti
tidak ada aksi yang dijalankan.
- `/purge` tidak membuat kasus (tidak ada target tunggal) tetapi selalu dicatat
ke channel log. Pesan lebih tua dari 14 hari tidak bisa dihapus massal —
jumlah yang dilewati dilaporkan.

**Welcome, goodbye & autorole**

- `guildMemberAdd` mengirim pesan ke `welcomeChannelId` lalu memberi
`autoroleId` (manusia) atau `autoroleBotId` (bot). Kalau role gagal diberikan
(izin `Manage Roles` atau posisi role), bot melaporkannya di `logChannelId`.
- `guildMemberRemove` mengirim pesan ke `goodbyeChannelId`.
- Placeholder teks: `{user}` (tag), `{mention}`, `{server}`, `{count}`. Pesan
kosong memakai template default di [greetings.ts](src/modules/moderation/greetings.ts).

**Di mana datanya**

- `moderation_case` — satu baris per aksi: `caseNumber` unik per server, tipe,
target (user atau channel), moderator, alasan, `expiresAt` untuk timeout,
`active`. Catatan `/note` juga tersimpan di sini dengan tipe `note`.
- `warning` — baris peringatan yang menunjuk kasusnya; `/unwarn` menghapus baris
ini dan menonaktifkan kasusnya (data tidak hilang untuk audit).

---

## 6. Automod (M4)

Aktifkan dulu modulnya lewat `/config set automod:true` (atau wizard `/setup`).
Semua rule bisa diatur dengan `/automod` — dasar-dasarnya adalah default PRD:

| Rule | Pemicu default | Aksi default | Ambang bisa diubah |
| --- | --- | --- | --- |
| 🌊 Anti-spam | 5 pesan / 5 detik dari user sama | Hapus + catat peringatan | 2–20 pesan |
| 🔗 Anti-invite | Link `discord.gg/*` / `discord.com/invite/*` | Hapus + catat peringatan | — |
| 🌐 Anti-link | Semua URL (`http(s)://` dan `www.`) | Hapus | — |
| 🤬 Badword | Daftar kata terlarang (default kosong) | Hapus + catat peringatan | — |
| 📣 Anti-mention-spam | >5 mention (user + role) dalam satu pesan | Hapus + timeout 10 menit | 1–20 mention |
| 🔠 Anti-caps | >70% huruf kapital dan panjang >10 | Hapus | 10–100% |
| 🔁 Anti-duplicate | Pesan identik 3x berturut-turut | Hapus | 2–10x |

**Aturan yang berlaku**

- **Pengecualian global:** channel & role yang di-whitelist, semua bot, dan
  pemegang **Manage Messages** tidak pernah dievaluasi.
- Rule berjalan berurutan sesuai prioritas tabel di atas; pelanggaran pertama
  yang menang supaya tidak ada aksi bertumpuk.
- Aksi **catat peringatan** masuk ke sistem kasus moderasi — muncul di
  `/warnings` dengan ID `#CASE-…` dan moderator dicatat sebagai bot.
- Setiap tindakan dikirim ke `logChannelId` (rule, alasan, aksi, cuplikan
  pesan). Kalau channel log belum diatur, automod tetap jalan.
- Anti-spam & anti-duplicate memakai state in-memory per user — restart bot
  mengosongkan hitungan (sama seperti antrean musik).
- Anti-link hanya mengenali URL dengan protokol/`www.`; domain telanjang
  seperti `contoh.com` sengaja tidak dideteksi supaya tidak salah tangkap
  nama file. Daftar putih domain mencakup subdomain.

### `/automod` — kelola rule

| Perintah | Fungsi |
| --- | --- |
| `/automod show` | Status semua rule + pengecualian + daftar putih |
| `/automod toggle <rule> <enabled>` | Nyalakan/matikan satu rule |
| `/automod threshold <rule> <value>` | Ubah ambang (rule tanpa ambang akan ditolak) |
| `/automod badword add\|remove <word>` | Kelola daftar kata terlarang |
| `/automod whitelist channel add\|remove <channel>` | Kecualikan channel |
| `/automod whitelist role add\|remove <role>` | Kecualikan role |
| `/automod whitelist domain add\|remove <domain>` | Izinkan domain untuk anti-link |
| `/automod whitelist invite add\|remove <code>` | Izinkan kode invite |

Butuh izin **Manage Server**; perubahan langsung berlaku (cache 60 detik
dibuang setiap kali rule diubah).

---

## 7. Logging (M4)

Aktifkan modulnya lewat `/config set logging:true` (atau wizard `/setup`).
Semua event Discord penting dipetakan ke **6 kategori**, masing-masing dengan
embed berwarna, timestamp, executor (dari audit log bila tersedia), target, dan
alasan bila ada:

| Kategori | Event yang dicatat |
| --- | --- |
| 👤 Member | join, leave, nickname, role ditambah/dihapus, timeout, ban, unban |
| 💬 Pesan | hapus, edit (sebelum → sesudah), hapus massal |
| 📁 Channel | dibuat, dihapus, diubah (nama, topik, NSFW, slowmode, kategori, batas user, overwrite izin) |
| 🎭 Role | dibuat, dihapus, diubah (nama, warna, tampil terpisah, mentionable, izin) |
| 🔊 Voice | join, leave, pindah, mute/deafen self & server, streaming |
| 🏠 Server | emoji & sticker (tambah/ubah/hapus), boost tier, jumlah boost, vanity URL, nama/pemilik/ikon server |

### `/logging` — routing per kategori

| Perintah | Fungsi |
| --- | --- |
| `/logging show` | Tampilkan routing semua kategori + status modul |
| `/logging set <category> <channel>` | Arahkan satu kategori ke channel tertentu |
| `/logging reset <category>` | Hapus routing kategori → kembali memakai channel log global |

Butuh izin **Manage Server**. Routing bersifat dua tingkat: kategori yang belum
diarahkan otomatis memakai `logChannelId` global, sehingga server kecil cukup
satu channel dan server besar bisa memisahkan misalnya `#log-pesan` dan
`#log-member`. Perubahan berlaku seketika (cache 60 detik dibuang tiap kali
diubah).

**Catatan operasional**

- Best-effort: channel belum diatur/hilang atau modul logging mati tidak pernah
  menggagalkan alur event — kegagalan hanya dicatat di log internal bot.
- Executor diambil dari audit log Discord; perubahan yang tidak tercatat di
  audit log (misalnya member mengganti nickname sendiri) tampil tanpa executor.
- Edit/hapus pesan memakai snapshot cache Discord — pesan lama yang tidak
  ter-cache tampil sebagai *isi tidak tersedia*.
- Boost dipantau lewat perubahan `premiumTier`/jumlah boost di event
  `guildUpdate`, karena discord.js 14.27 tidak punya event boost tersendiri.

---

## 8. Struktur proyek

```
prisma/
├─ schema.prisma            # model database (sumber kebenaran skema)
├─ migrations/              # migrasi SQL yang bisa diaudit
└─ seed?                    # (belum ada — belum dibutuhkan)

src/
├─ commands/
│  ├─ core/                 # /ping, /help, /config, /setup         (M0–M1 ✅)
│  ├─ music/                # /play, /queue, /nowplaying, /skip,
│  │                        # /pause, /resume, /stop + _shared.ts   (M2 ✅)
│  └─ admin/                # /ban … /note (M3 ✅), /automod & /logging (M4 ✅)
│                           # _shared.ts berisi gate & alur aksi bersama
├─ events/                  # satu file = satu event Discord
│  └─ logging/              # 22 event → embed 6 kategori (M4 ✅)
├─ handlers/                # loader perintah & event (auto-discovery)
├─ modules/
│  ├─ config/               # konfigurasi per-server (M1 ✅)
│  ├─ music/                # antrean, pemutar Lavalink, izin musik (M2 ✅)
│  │                        # queue.ts, idleTimer.ts, musicService.ts, track.ts
│  ├─ moderation/           # kasus, warning, hierarki, greeting      (M3 ✅)
│  ├─ automod/              # engine 7 rule + tracker state          (M4 ✅)
│  └─ logging/              # routing channel per kategori + diff/audit helper (M4 ✅)
├─ services/                # logger, Prisma client, deteksi error database
├─ utils/                   # cooldown, embed, durasi, izin, module loader
├─ config/                  # env (zod) + konstanta
├─ generated/               # Prisma Client hasil generate — JANGAN diedit, tidak di-commit
├─ client.ts                # BotClient: intents + registry perintah
├─ deploy-commands.ts       # daftarkan slash command ke Discord
└─ index.ts                 # entrypoint + graceful shutdown
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

> **Konvensi file `_`:** file yang diawali garis bawah (mis. `_shared.ts`) di
> dalam `commands/` atau `events/` **tidak** didaftarkan sebagai perintah/event.
> Pakai awalan itu untuk helper. File biasa tanpa `default export BotCommand`
> akan membuat bot menolak start (memang disengaja: salah ketik tidak boleh
> lewat diam-diam).

### Menambah event baru

`src/events/<nama>.ts` dengan `name` dari `Events.*` discord.js. Loader otomatis
mendaftarkannya, dan error di satu handler tidak mematikan proses.

---

## 9. Perintah npm

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Jalankan bot dengan auto-reload (tsx watch) |
| `npm run build` | Bersihkan `dist/` lalu compile TypeScript |
| `npm run clean` | Hapus `dist/` (mencegah file lama ikut dimuat loader) |
| `npm start` | Jalankan hasil build (produksi) |
| `npm run deploy` | Daftarkan slash command (guild dev bila `DEV_GUILD_ID` diisi, jika tidak global) |
| `npm run infra:up` / `infra:down` | Nyalakan/matikan Postgres + Lavalink + Redis untuk dev lokal |
| `npm run db:migrate` | Buat + terapkan migrasi baru (pengembangan) |
| `npm run db:deploy` | Terapkan migrasi yang sudah ada (produksi/CI) |
| `npm run db:generate` | Generate Prisma Client dari schema |
| `npm run db:studio` | Buka Prisma Studio untuk melihat isi database |
| `npm run typecheck` | TypeScript strict, tanpa emit |
| `npm run lint` / `lint:fix` | ESLint |
| `npm test` / `test:watch` | Vitest |

CI (`.github/workflows/ci.yml`) menjalankan lint → typecheck → test → build di
setiap push/PR.

---

## 10. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `Used disallowed intents` | Privileged intents belum aktif di Developer Portal (lihat bagian 1) |
| Pesan “Lavalink belum terhubung” | `docker compose ps` → pastikan `harmony-lavalink` jalan. Plugin diunduh saat start pertama, jadi butuh internet. Cek `docker compose logs lavalink` |
| `Modul perintah tidak valid ...` saat start | Ada file di `src/commands/**` (atau `src/events/**`) tanpa `default export BotCommand` — beri nama diawali `_` atau pindahkan keluar folder itu |
| Bot keluar sendiri dari voice channel | Auto-disconnect setelah `idleTimeoutSec` tanpa lagu. Atur lewat `/config set idle-timeout` |
| `/play` bilang antrean penuh | Batas `MAX_QUEUE_SIZE` (default 500) tercapai — tunggu lagu selesai atau naikkan di `.env` |
| `Konfigurasi environment tidak valid: • DISCORD_TOKEN: ...` | `.env` belum diisi / valuenya salah — pesannya menyebut variabel yang bermasalah |
| “DM ke target tidak terkirim” saat moderasi | Wajar kalau target menutup DM atau memblokir bot — aksinya tetap dijalankan dan tercatat di channel log |
| “Role target lebih tinggi atau setara…” | Hierarki Discord. Pindahkan role bot dan role moderator di atas role target (Server Settings → Roles) |
| Autorole gagal diberikan | Cek pesan di channel log: bot butuh izin **Manage Roles** dan role autorole harus berada di bawah role bot |
| Perintah `/setup` bilang database offline | Jalankan `npm run infra:up`, lalu cek `docker compose ps` |
| `Cannot resolve environment variable: DATABASE_URL` | Prisma CLI butuh `DATABASE_URL` di `.env` — untuk `generate` saja, nilai placeholder otomatis dipakai |
| Prisma Client tidak sinkron setelah ubah schema | `npm run db:generate` (atau `npm run db:migrate` sekaligus) |
| Slash command tidak muncul | Jalankan `npm run deploy`; untuk pendaftaran global butuh ±1 jam. Coba restart aplikasi Discord (Ctrl+R) |
| Perintah lama masih muncul setelah ganti nama | Developer Portal → Integrations → hapus perintah global lama |
| Bot join voice tapi tidak ada suara | Cek `docker compose logs lavalink`; pastikan `LAVALINK_PASSWORD` di `.env` sama dengan yang dipakai container |
| Lavalink mati saat memutar lagu panjang | Naikkan `JAVA_TOOL_OPTIONS=-Xmx2G` di `docker-compose.yml` |
| Error YouTube "sign in to confirm you're not a bot" | Aktifkan OAuth token di plugin [youtube-source](https://github.com/lavalink-devs/youtube-source#using-oauth-tokens) |

Lihat juga bagian **Legal, Privasi & Kepatuhan** di PRD — sumber audio dan
kewajiban takedown bukan detail teknis yang bisa ditunda.
