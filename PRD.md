# PRD — Discord Bot Music & Admin

| Field | Value |
| --- | --- |
| Nama Produk (kerja) | **Harmony** (nama final TBD) |
| Versi Dokumen | v1.0 |
| Tanggal | 2 Oktober 2026 |
| Status | Draft — menunggu review |
| Pemilik | (isi nama kamu) |
| Stack Rekomendasi | Node.js 20+ · TypeScript · discord.js v14 · Lavalink v4 · PostgreSQL · Redis |

> **Catatan asumsi:** Bagian teknis (Bab 9–10) memakai stack rekomendasi di atas. Kalau kamu lebih nyaman dengan Python (discord.py + Wavelink) atau ingin memakai `yt-dlp` langsung tanpa Lavalink, lihat Bab 16 bagian *Keputusan Terbuka* — bagian teknis bisa ditulis ulang tanpa mengubah ruang lingkup fitur.

---

## 1. Ringkasan Eksekutif

Bot Discord serbaguna dengan **dua pilar utama**:

1. **Music** — pemutaran audio berkualitas tinggi dari berbagai sumber (YouTube, Spotify metadata, SoundCloud) dengan antrean, playlist, filter audio, dan kontrol penuh via slash command.
2. **Admin** — moderasi komunitas (ban/kick/timeout/warn), automod, logging, welcome/greeting, reaction roles, dan sistem tiket (ticket) dasar.

**Masalah yang dipecahkan:** Pemilik server sering harus memasang 2–4 bot berbeda (satu untuk musik, satu untuk moderasi, satu untuk logging, satu untuk welcome) yang masing-masing punya prefix, permission, dan dashboard berbeda. Ini menyulitkan konfigurasi, menambah beban resource, dan menciptakan celah konflik (misal dua bot sama-sama mengelola antrean musik). **Harmony menyatukan semuanya dalam satu bot** dengan konfigurasi per-server yang konsisten.

**Diferensiasi:** Setup 1 perintah (`/setup`) yang mengonfigurasi semua modul, konfigurasi berbasis web (fase 2), dan latensi kontrol musik rendah (< 100 ms dari input ke respons).

---

## 2. Latar Belakang & Peluang

- Discord tetap menjadi platform komunitas terbesar untuk gaming, study group, dan komunitas niche.
- Bot musik populer (Groovy, Rythm) pernah dimatikan karena tekanan legal (DMCA / ToS YouTube) — ini menciptakan **ruang kosong** yang diisi bot kecil-kecil, tapi kualitasnya tidak konsisten.
- Permintaan bot moderation bot gratis (MEE6, Dyno) sangat besar, tapi hampir semuanya mengunci fitur penting di balik paywall.
- Peluang: bot alternatif yang **jujur soal batasan legal**, hemat resource, dan menggratiskan fitur inti.

**Validasi yang dibutuhkan sebelum coding (Bab 17):** survei 10–20 pemilik server, cek apakah ada kebutuhan nyata yang belum terpenuhi di bot yang mereka pakai sekarang.

---

## 3. Tujuan (Goals) & Non-Goals

### 3.1 Goals
| # | Tujuan | Cara Ukur |
| --- | --- | --- |
| G1 | Musik jalan stabil 24/7 di server kecil–menengah (< 5.000 member) | Uptime bot ≥ 99% per bulan |
| G2 | Kontrol musik responsif | Median latency perintah musik < 100 ms |
| G3 | Moderasi lengkap tanpa perlu bot kedua | ≥ 90% tugas moderasi umum tersedia di v1 |
| G4 | Onboarding tanpa dokumentasi | User baru bisa memutar lagu dalam < 3 perintah |
| G5 | Gratis untuk fitur inti | Tidak ada fitur inti yang dipaywall di v1 |

### 3.2 Non-Goals (v1)
- ❌ Web dashboard penuh (ditunda ke Fase 3).
- ❌ Music playback di voice channel **stage** / video streaming.
- ❌ Fitur ekonomi, leveling/XP, atau game mini.
- ❌ Bot sharding multi-node (ditunda sampai > 2.500 server).
- ❌ Monetisasi / sistem premium.
- ❌ Aplikasi mobile.

---

## 4. Target Pengguna

| Persona | Deskripsi | Kebutuhan Utama |
| --- | --- | --- |
| **Rian — Pemilik Server** | 24 th, punya server komunitas 800 member, tidak bisa coding | Setup cepat, satu bot untuk semua, gratis |
| **Dita — Moderator** | 20 th, moderasi harian, responsif terhadap laporan | Perintah moderasi cepat, logging jelas, tidak salah hapus |
| **Bagas — Anggota / Penikmat Musik** | 19 th, ikut voice channel tiap malam | Antrean musik, playlist, lirik, kualitas suara bagus |
| **Sari — Developer Bot** | 22 th, hosting sendiri botnya | Arsitektur jelas, mudah di-fork, dokumentasi API |

**Profil server target:** 50–5.000 member, minimal 20 voice member aktif, berbasis komunitas/gaming/study.

---

## 5. Ruang Lingkup

### 5.1 MVP (v1.0) — WAJIB ada
**Modul Music**
- Play dari query (judul / URL YouTube / URL SoundCloud)
- Antrean per-server (queue), tampil, hapus lagu dari antrean
- Pause, resume, skip, stop, seek, volume
- Loop (off / track / queue), shuffle
- Now Playing (embed dengan progress bar)
- Auto-disconnect setelah idle (default 5 menit, bisa dikonfigurasi)
- DJ role / batasan siapa yang boleh kontrol

**Modul Admin**
- Ban, unban, kick, timeout (mute sementara), warn
- Riwayat warn + remove warn
- Purge pesan (bulk delete dengan filter user/contains)
- Slowmode, lockdown channel
- Automod dasar: anti-spam, anti-invite-link, anti-badword (daftar kata bisa dikonfigurasi)
- Logging event: join/leave member, hapus/edit pesan, perubahan role, ban/kick, perubahan channel
- Welcome & goodbye message (embed, bisa pakai `{user}`, `{server}`, `{count}`)
- Autorole saat join
- Permission & role check yang ketat di setiap perintah

**Infrastruktur**
- Slash command saja (tanpa prefix) — menghindari konflik dengan bot lain
- Konfigurasi per-server tersimpan di database
- Error handling + logging terstruktur (pino/winston)
- Health check endpoint untuk monitoring

### 5.2 Fase 2 (v1.1–1.3) — Setelah MVP stabil
- Playlist pengguna (simpan & load), playlist komunitas
- Lirik (via API Genius/LRCLIB)
- Filter audio: bassboost, nightcore, vaporwave, 8D
- Reaction roles (self-assign role via reaksi/tombol) — 🟢 *selesai di M5: panel select menu + panel sementara yang berakhir sendiri*
- Custom commands (teks balasan buatan admin)
- Sistem tiket (ticket) dasar — 🟢 *selesai di M5: channel privat + arsip, topik lewat modal, transkrip percakapan*
- Spotify metadata support (search Spotify → resolve ke sumber audio)
- 24/7 mode di voice channel tertentu

### 5.3 Fase 3 (v2.0) — Eksperimental
- Web dashboard (Next.js) untuk konfigurasi tanpa perintah
- Statistik per-server & analitik lagu terpopuler
- Sharding + multi-node Lavalink
- Dukungan multi-bahasa (ID / EN)

---

## 6. Fitur Musik — Spesifikasi Detail

### 6.1 Daftar Perintah (MVP)

| Perintah | Deskripsi | Opsi Utama | Permission |
| --- | --- | --- | --- |
| `/play` | Putar lagu atau tambahkan ke antrean | `query` (wajib) | Semua (butuh di VC) |
| `/search` | Cari 5 hasil, pilih lewat menu | `query` | Semua (butuh di VC) |
| `/pause` | Jeda pemutaran | — | DJ |
| `/resume` | Lanjutkan pemutaran | — | DJ |
| `/skip` | Lewati lagu saat ini | `amount` (default 1) | DJ |
| `/stop` | Hentikan & bersihkan antrean | — | DJ |
| `/queue` | Tampilkan antrean (paginasi) | `page` | Semua |
| `/remove` | Hapus lagu dari antrean | `position` | DJ |
| `/move` | Pindahkan posisi lagu | `from`, `to` | DJ |
| `/nowplaying` | Embed lagu yang sedang diputar | — | Semua |
| `/seek` | Lompat ke detik tertentu | `position` | DJ |
| `/volume` | Atur volume 0–200% | `level` | DJ |
| `/loop` | Mode loop | `mode`: off/track/queue | DJ |
| `/shuffle` | Acak antrean | — | DJ |
| `/disconnect` | Keluar dari voice channel | — | DJ |
| `/dj-role` | Set role DJ server | `role` | Manage Server |

### 6.2 Aturan Perilaku
- **Bot hanya bisa kontrol musik di channel tempat ia di-invoke** — mencegah trolling lintas channel.
- Jika user tidak di voice channel yang sama → tolak dengan pesan jelas.
- Jika voice channel penuh → coba pindah ke channel lain, kalau gagal, laporkan.
- Antrean maksimum **500 lagu** per server (cegah abuse memory).
- Durasi maksimum satu track: **6 jam** (mencegah track "radio 24 jam" merusak memory).
- Lagu dengan durasi > 30 menit hanya boleh ditambahkan oleh DJ role atau user dengan `Manage Server` (anti-abuse).
- Setelah antrean habis + tidak ada aktivitas voice selama **5 menit**, bot disconnect otomatis.

### 6.3 Perilaku Error
| Skenario | Respons ke User |
| --- | --- |
| Tidak ada hasil pencarian | Embed: "Tidak ditemukan hasil untuk `<query>`" |
| Bot tidak punya izin `Connect`/`Speak` | "Saya tidak punya izin masuk/berbicara di channel itu" |
| Sumber lagu tidak didukung / di-restrict | "Lagu ini tidak bisa diputar (dibatasi oleh sumbernya)" |
| Voice node Lavalink down | "Layanan musik sedang gangguan, coba lagi nanti" + log ke channel ops |
| User spam `/play` (> 5/menit) | Cooldown 10 detik dengan pesan sisa waktu |

---

## 7. Fitur Admin — Spesifikasi Detail

### 7.1 Moderasi

| Perintah | Deskripsi | Permission Discord |
| --- | --- | --- |
| `/ban` | Ban member + hapus pesan (0–7 hari) | Ban Members |
| `/unban` | Buka ban berdasarkan user ID | Ban Members |
| `/kick` | Kick member | Kick Members |
| `/timeout` | Mute sementara (maks 28 hari) | Moderate Members |
| `/warn` | Beri peringatan (tersimpan) | Moderate Members |
| `/warnings` | Lihat riwayat warn member | Moderate Members |
| `/unwarn` | Hapus warn berdasarkan ID | Moderate Members |
| `/case` | Ringkasan satu kasus: detail kasus, riwayat kasus lain atas target yang sama, dan log terkait | Moderate Members |
| `/modprofile` | Halaman profil moderator: seluruh kasus atas namanya, sebaran jenis aksi, target unik, aktivitas 30 hari terakhir, dan kasus terbaru | Moderate Members |
| `/purge` | Hapus N pesan dengan filter | Manage Messages |
| `/slowmode` | Atur slowmode channel | Manage Channels |
| `/lock` / `/unlock` | Kunci/buka channel untuk @everyone | Manage Channels |
| `/note` | Catatan internal tentang member | Moderate Members |

**Aturan wajib:**
- Semua aksi moderasi **wajib mengirim DM ke target** (kecuali DM tertutup) dan **selalu tercatat di log channel**.
- **Anti-hierarki:** bot tidak bisa memoderasi user dengan role lebih tinggi, dan tidak bisa memoderasi pemilik server. Cek ini sebelum eksekusi.
- **Self-moderation block:** user tidak bisa memoderasi dirinya sendiri.
- Setiap aksi mengembalikan **ID kasus** (misal `#CASE-0142`) agar bisa dirujuk di laporan.
- Nomor kasus yang sama ikut menempel di log kategori (Bab 7.3) sehingga aksi bot bisa dibedakan dari moderator lain: log menandai **sumber** aksi — kasus Harmony, bot lain, atau moderator manusia — dan `/logs case:#CASE-0142` bisa menelusurinya kembali.
- `/case` menampilkan yang terjadi **sekarang**, bukan hanya yang tercatat: untuk ban dan timeout halaman ini mengecek langsung ke Discord apakah aksi masih berlaku. Keterbatasan yang diketahui: halaman kasus tidak menampilkan apakah DM ke target terkirim, karena status itu tidak disimpan di database.

### 7.2 Automod

| Aturan | Trigger | Aksi Default | Dapat Dikonfigurasi |
| --- | --- | --- | --- |
| Anti-spam | > 5 pesan / 5 detik dari user sama | Hapus + warn | Ya (threshold) |
| Anti-invite | Link `discord.gg/*` | Hapus + warn | Ya (whitelist server) |
| Anti-link | Semua URL | Hapus (opsional) | Ya (whitelist domain) |
| Badword | Daftar kata (default kosong) | Hapus + warn | Ya (daftar kata) |
| Anti-mention-spam | > 5 mention / pesan | Hapus + timeout 10 menit | Ya |
| Anti-caps | > 70% huruf kapital & panjang > 10 | Hapus | Ya |
| Anti-duplicate | Pesan identik 3x berturut-turut | Hapus | Ya |

**Exempt:** channel yang di-whitelist, role yang di-whitelist, dan user dengan `Manage Messages` dikecualikan.

### 7.3 Logging

Event yang dicatat, masing-masing dikirim ke channel log yang bisa dipilih per kategori:

| Kategori | Event |
| --- | --- |
| Member | join, leave, nickname change, role add/remove, timeout, ban, unban |
| Pesan | delete, edit (before/after), bulk delete |
| Channel | create, delete, rename, permission overwrite |
| Role | create, delete, rename, permission change |
| Voice | join, leave, move, mute/deafen state |
| Server | emoji/sticker change, boost, vanity URL update |

**Format:** embed dengan warna per kategori, timestamp, executor (siapa yang melakukan), target, dan alasan bila tersedia.

Setiap event yang lolos juga disimpan ke tabel `log_entry` (kategori, kunci event, executor, target, channel asal, ringkasan isi embed, ID pesan log) sehingga bisa dicari ulang lewat `/logs` dengan filter kategori, user, channel, kata kunci, dan rentang tanggal. Retensi riwayat log 30 hari; kolom `expires_at` disiapkan untuk job pembersihan sesuai Bab 12.

Ringkasan periode: `/logs … stats:true` menampilkan jumlah event per kategori, event yang paling sering muncul, dan member yang paling sering terlibat (sebagai target maupun executor). Tanpa `from`, periode dibatasi ke masa simpan riwayat agar angka yang ditampilkan jujur; agregasi dihitung di database lewat `groupBy`, bukan dengan menarik seluruh riwayat ke memori.

### 7.4 Welcome, Autorole & Lainnya

| Fitur | Deskripsi |
| --- | --- |
| Welcome message | Channel + embed kustom, placeholder `{user}`, `{mention}`, `{server}`, `{count}` |
| Goodbye message | Sama seperti welcome |
| Autorole | Role otomatis diberikan ke member baru; bisa bedakan bot vs manusia |
| Role button | Self-assign role lewat panel select menu — 🟢 *selesai di M5 (reaction roles)* |
| Panel sementara | Panel role yang mati sendiri setelah periode tertentu (`duration`), select menu dilepas saat berakhir — 🟢 *selesai di M5* |
| Tiket dasar | Satu channel privat per tiket, topik diminta lewat modal sebelum channel dibuat, ditutup = diarsipkan bukan dihapus — 🟢 *selesai di M5* |
| `/setup` | Wizard interaktif: pilih channel log, welcome, role DJ, modul aktif |
| `/config` | Lihat/ubah pengaturan server kapan saja |
| `/help` | Daftar perintah interaktif dengan kategori |

---

## 8. User Stories & Acceptance Criteria

**US-01 — Memutar lagu**
> Sebagai anggota, saya ingin memutar lagu dengan satu perintah agar malam komunitas bisa diisi musik tanpa ribet.

- **AC:** `/play never gonna give you up` → bot join VC pemanggil, mulai memutar hasil terbaik, tampilkan embed Now Playing berisi judul, durasi, requester, thumbnail.
- **AC:** Jika sudah playing, lagu masuk ke antrean dan bot membalas posisi di antrean.
- **AC:** Respons awal (acknowledge) muncul dalam < 2 detik.

**US-02 — Antrean transparan**
> Sebagai anggota, saya ingin melihat dan mengatur antrean agar tahu lagu apa selanjutnya.

- **AC:** `/queue` menampilkan antrean berhalaman (10 lagu/halaman) dengan tombol navigasi.
- **AC:** `/remove 3` menghapus lagu posisi 3 dan menampilkan antrean terbaru.

**US-03 — Anti-troll musik**
> Sebagai pemilik server, saya ingin hanya DJ yang bisa skip/stop agar satu orang tidak merusak sesi musik semua orang.

- **AC:** User tanpa role DJ mencoba `/skip` → ditolak dengan pesan "Butuh role DJ".
- **AC:** DJ (atau `Manage Server`) bisa `/skip` tanpa hambatan.

**US-04 — Moderasi dengan bukti**
> Sebagai moderator, saya ingin setiap aksi moderasi tercatat agar keputusan bisa diaudit.

- **AC:** `/ban @user alasan: spam` → user terban, DM terkirim, embed log terkirim di channel log dengan ID kasus, executor, alasan, timestamp.
- **AC:** Menjalankan `/ban` pada user dengan role di atas bot → ditolak dengan pesan jelas, tidak ada aksi.

**US-05 — Onboarding cepat**
> Sebagai pemilik server, saya ingin menyiapkan semua modul dalam satu perintah agar tidak perlu belajar dokumentasi panjang.

- **AC:** `/setup` menuntun lewat 4 langkah (log channel, welcome channel, DJ role, modul aktif) memakai menu dropdown/tombol.
- **AC:** Konfigurasi tersimpan dan langsung berlaku tanpa restart bot.

---

## 9. Arsitektur Teknis

### 9.1 Stack Rekomendasi

| Layer | Teknologi | Alasan |
| --- | --- | --- |
| Runtime | Node.js 20 LTS + TypeScript | Ekosistem Discord terbaik, type-safety |
| Discord library | discord.js v14 | Mature, slash command + voice built-in |
| Audio engine | **Lavalink v4** | Handle streaming, filter, dan scaling; bot tetap ringan |
| Source audio | LavaSrc plugin (YouTube, SoundCloud, Spotify metadata) | Satu plugin banyak sumber |
| Database | PostgreSQL + Prisma | Relasional, cocok untuk config & riwayat kasus |
| Cache/Queue | Redis (BullMQ opsional) | Cooldown rate limit, state antrean lintas proses |
| Logging | pino → stdout + file rotasi | Terstruktur, ringan |
| Deployment | Docker Compose (bot + lavalink + postgres + redis) | Reproducible di VPS kecil |
| Monitoring | Prometheus metrics endpoint + UptimeRobot | Deteksi downtime cepat |

### 9.2 Alur Tingkat Tinggi

```
┌──────────────┐   slash command    ┌──────────────┐
│  Discord API │ ─────────────────► │  Bot Process │
│  (Gateway)   │ ◄───────────────── │ (discord.js) │
└──────────────┘   embed + voice    └──────┬───────┘
                                           │ REST / WS
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
            ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
            │  Lavalink v4 │       │  PostgreSQL  │       │    Redis     │
            │  (audio node)│       │ (config/data)│       │ (cache/rate) │
            └──────────────┘       └──────────────┘       └──────────────┘
```

### 9.3 Struktur Folder (usulan)

```
src/
├─ commands/
│  ├─ music/        # play, queue, skip, ...
│  └─ admin/        # ban, warn, purge, ...
├─ events/          # ready, interactionCreate, guildMemberAdd, ...
├─ modules/
│  ├─ music/        # queue manager, lavalink client, embeds
│  ├─ moderation/   # case manager, hierarchy checks
│  ├─ automod/      # rule engine + detectors
│  ├─ logging/      # event → embed mapping
│  └─ config/       # guild config service
├─ services/        # prisma client, redis, logger
├─ utils/           # permissions, time parsing, pagination
├─ config/          # env schema (zod), constants
└─ index.ts
```

### 9.4 Prinsip Teknis
- **Fail fast pada config:** validasi env dengan `zod` saat startup; jangan jalan dengan config setengah lengkap.
- **Antrean state di memori per-guild** untuk latensi, tapi **config di database** (selalu sumber kebenaran).
- **Idempotent event handler:** event Discord bisa terkirim dobel; handler log harus toleran.
- **Semua interaksi di-defer** (`deferReply`) sebelum operasi async > 1 detik.

### 9.5 Environment Variables (usulan)

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DEV_GUILD_ID=           # untuk deploy command instan saat development
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=
LOG_LEVEL=info
DEFAULT_VOLUME=100
MAX_QUEUE_SIZE=500
```

---

## 10. Model Data (usulan skema)

| Tabel | Kolom Kunci | Keterangan |
| --- | --- | --- |
| `guild_config` | `guild_id` PK, `dj_role_id`, `log_channel_id`, `welcome_channel_id`, `default_volume`, `idle_timeout_sec`, `modules_enabled` (JSON) | Satu baris per server |
| `automod_rule` | `id` PK, `guild_id`, `type`, `enabled`, `threshold`, `action`, `whitelist` (JSON) | Aturan automod per server |
| `moderation_case` | `id` PK, `case_number`, `guild_id`, `type`, `target_id`, `moderator_id`, `reason`, `created_at`, `expires_at`, `active` | Semua aksi moderasi. Diindeks `(guild_id, moderator_id, created_at DESC)` khusus untuk `/modprofile` |
| `warning` | `id` PK, `guild_id`, `user_id`, `moderator_id`, `reason`, `case_id`, `created_at` | Warn aktif & historis |
| `user_note` | `id` PK, `guild_id`, `user_id`, `author_id`, `content`, `created_at` | Catatan internal |
| `playlist` (Fase 2) | `id` PK, `guild_id`, `owner_id`, `name`, `tracks` (JSON), `is_public` | Playlist pengguna |
| `reaction_role_panel` | `id` PK, `guild_id`, `channel_id`, `message_id`, `expires_at`, `closed_at`, `created_at`, `updated_at` | Satu pesan panel self-assign role. `expires_at` = masa hidup panel (null = permanen), `closed_at` = sudah dinonaktifkan sehingga tidak disapu ulang |
| `reaction_role_option` | `id` PK, `panel_id`, `role_id`, `label`, `emoji`, `description`, `position` | Role yang bisa diambil member; ikut terhapus bersama panel |
| `ticket` | `id` PK, `ticket_number`, `guild_id`, `channel_id`, `opener_id`, `subject`, `status`, `claimed_by`, `closed_at`, `closed_by`, `expires_at`, `transcript` | Tiket support; ditutup = channel diarsipkan, bukan dihapus. `transcript` (JSONB) = isi percakapan channel saat ditutup, disimpan di baris yang sama sehingga ikut hilang bersama tiket |
| `guild_log_subscription` | `guild_id`, `category`, `channel_id` | Routing log per kategori |
| `log_entry` | `id` PK, `guild_id`, `category`, `event_key`, `title`, `summary`, `executor_id`, `target_id`, `channel_id`, `log_channel_id`, `log_message_id`, `case_id`, `created_at`, `expires_at` | Riwayat log agar bisa dicari `/logs`; `case_id` mengikat aksi bot ke kasus moderasinya |

**Retensi data:** kasus moderasi & tiket yang sudah ditutup disimpan 12 bulan (transkrip percakapan tiket ikut terhapus di operasi yang sama); riwayat log 30 hari (`expires_at`); lagu/statistik playback disimpan agregat (tanpa data pribadi). Lihat Bab 12 (Privasi).

---

## 11. Non-Functional Requirements

| Kategori | Requirement |
| --- | --- |
| **Performa** | Median latency perintah musik < 100 ms; ack < 2 detik; waktu start playback < 3 detik |
| **Kapasitas** | 1 proses bot menangani 500 server / 10.000 member bersamaan tanpa degradasi > 20% |
| **Reliabilitas** | Uptime ≥ 99% / bulan; auto-reconnect gateway & Lavalink; graceful restart tanpa memutus VC |
| **Skalabilitas** | Horizontal: tambah node Lavalink tanpa mengubah kode bot; sharding siap di > 2.500 server |
| **Keamanan** | Semua izin dicek server-side; tidak ada eval; input user di-escape sebelum masuk embed; token tidak pernah masuk log; rate limit per user per perintah |
| **Observability** | Log terstruktur, health endpoint `/healthz`, metrik: jumlah guild, lagu diputar, error rate, latency Lavalink |
| **Maintainability** | TypeScript strict mode; unit test ≥ 60% untuk modul music queue & permission check; CI menjalankan lint + test |
| **Biaya** | Berjalan di VPS 2 vCPU / 2 GB RAM (bot) + 1 GB (Lavalink) — target < $10/bulan |
| **Aksesibilitas** | Semua respons pakai embed rapi, warna konsisten, tanpa asumsi bahasa selain ID pada v1 |

---

## 12. Legal, Privasi & Kepatuhan ⚠️

Bagian ini **tidak boleh dilewati** — inilah yang menumbangkan Groovy & Rythm.

| Aspek | Ketentuan |
| --- | --- |
| **Discord ToS** | Bot harus patuh pada Discord Developer Terms & Community Guidelines; tidak boleh memproses voice content secara sembarangan |
| **Sumber audio** | Gunakan API/endpoint resmi atau library resmi (Lavalink + LavaSrc). **Jangan** memakai `ytdl-core` yang sudah rusak/unmaintained dan rawan patching ilegal |
| **YouTube ToS** | Streaming dari YouTube berisiko; mitigasi: sediakan konfigurasi node alternatif (misal sumber yang punya izin), tanggapan cepat atas takedown, dan siap menonaktifkan sumber tertentu lewat flag konfigurasi |
| **DMCA / Takedown** | Sediakan alamat kontak & jalur permintaan takedown; dokumentasikan prosedur menghapus sumber dalam < 48 jam |
| **Privasi pengguna** | Simpan user ID, guild ID, dan riwayat moderasi. **Pengecualian yang harus dinyatakan terbuka: transkrip tiket** (§5.2, M5) menyimpan isi percakapan channel tiket — maksimal 500 pesan terakhir per tiket, hanya dibaca staff tiket atau pembuat tiketnya. Sediakan perintah `/privacy` yang menjelaskan data apa yang disimpan dan perintah `/data-delete` untuk permintaan penghapusan |
| **Retensi data** | Kasus moderasi, peringatan, dan tiket yang sudah ditutup disimpan **12 bulan** lalu dihapus otomatis oleh job berkala di dalam proses bot (dapat dimatikan lewat `RETENTION_SWEEP_HOURS=0` dan dijalankan dari cron). Transkrip percakapan tiket ikut terhapus pada saat yang sama, karena disimpan di baris tiket yang sama. Riwayat log 30 hari. Nomor kasus tidak bergantung pada jumlah baris, jadi penghapusan tidak merusak penomoran |
| **Kebijakan privasi & ToS bot** | Wajib dipublikasikan (halaman sederhana) sebelum bot publik |
| **Verifikasi Discord** | Untuk > 100 server perlu verifikasi bot; siapkan deskripsi, kebijakan privasi, dan penjelasan permission |

---

## 13. Metrik Keberhasilan (KPI)

| Metrik | Target 3 bulan setelah rilis | Cara Ukur |
| --- | --- | --- |
| Server aktif (≥ 1 perintah / minggu) | 50 server | Query database |
| Retensi server (masih aktif setelah 30 hari) | ≥ 60% | Kanal database |
| Perintah musik per hari | ≥ 500 | Counter metrik |
| Error rate perintah | < 1% | Log error / total perintah |
| Uptime | ≥ 99% | UptimeRobot |
| Rating feedback (survei) | ≥ 4/5 | Survei di server pendukung |

**Anti-metrik (yang tidak jadi target):** jumlah total server, karena bisa jadi vanity metric tanpa pemakaian nyata.

---

## 14. Milestones & Timeline

| Fase | Durasi | Deliverable | Kriteria Selesai |
| --- | --- | --- | --- |
| **M0 — Riset & Setup** | 3 hari | Repo, CI, Docker Compose, skeleton bot, deploy command ke 1 test server | `/ping` jalan di server test — 🟡 *kode & infra selesai (lihat [README.md](README.md)); deploy ke server test menunggu token Discord* |
| **M1 — Fondasi** | 1 minggu | Koneksi DB, config service, `/setup`, `/config`, logging infra | Konfigurasi per-server tersimpan & terbaca — 🟢 *selesai: PostgreSQL + Prisma 7, service config dengan cache 60 detik (perubahan langsung berlaku), wizard `/setup`, `/config show\|set\|reset`, migrasi otomatis saat start Docker* |
| **M2 — Music MVP** | 2 minggu | Lavalink terpasang, `/play`, `/queue`, `/skip`, `/pause`, `/stop`, `/nowplaying`, loop, volume | Bisa memutar & mengelola antrean 20 lagu berturut-turut tanpa error — 🟢 *inti selesai: klien shoukaku + Lavalink v4, antrean per-server (batas `MAX_QUEUE_SIZE`), `/play` `/queue` `/nowplaying` `/skip` `/pause` `/resume` `/stop`, izin role DJ, auto-disconnect via `idleTimeoutSec`. Sisa: `/volume`, `/loop`, `/seek`, `/shuffle`, `/disconnect`* |
| **M3 — Admin MVP** | 2 minggu | Moderation commands + case system + welcome + autorole | Semua AC US-04 & US-05 lolos — 🟢 *selesai: seluruh perintah Bab 7.1 (`/ban` `/unban` `/kick` `/timeout` `/warn` `/warnings` `/unwarn` `/slowmode` `/lock` `/unlock` `/note` `/purge`) dengan ID kasus (`#CASE-0142`), anti-hierarki (self/bot/owner/posisi role), DM target + log channel (best-effort), tabel `moderation_case` & `warning`, welcome/goodbye + autorole dari konfigurasi server, 115 tes unit* |
| **M4 — Automod & Logging** | 1 minggu | Rule engine automod + logging 6 kategori | Uji simulasi spam/link/badword lolos — 🟢 *selesai: automod 7 rule (spam, invite, link, badword, mention, caps, duplicate) dengan ambang & whitelist, tabel `automod_rule`, `/automod show\|toggle\|threshold\|badword\|whitelist`, aksi hapus / catat peringatan (masuk sistem kasus) / timeout 10 menit, pengecualian channel/role/bot/Manage Messages; logging 6 kategori (member, pesan, channel, role, voice, server) lewat 22 event ke embed berwarna dengan executor dari audit log, routing per kategori `/logging show\|set\|reset` dengan fallback `logChannelId` dan tabel `guild_log_subscription`, riwayat log tersimpan di `log_entry` dengan perintah `/logs` (filter kategori/user/channel/kata kunci/kasus/rentang tanggal) dan tertaut ke ID kasus moderasi, sepenuhnya best-effort; 250 tes unit* |
| **M5 — Hardening & Beta** | 1 minggu | Test coverage, rate limit, dokumentasi, kebijakan privasi, deploy 5 server beta | Error rate < 1% selama 1 minggu beta — 🟡 *berjalan: dua fitur Fase 2 masuk lebih dulu (`/reactionrole` panel self-assign via select menu, `/ticket` channel privat dengan penutupan berbasis arsip) karena keduanya memakai komponen persisten yang belum pernah ada di bot ini dan jadi risiko utama untuk rate limit nanti. Sisa: test coverage, rate limit, dokumentasi lengkap, kebijakan privasi, deploy 5 server beta* |
| **M6 — Rilis Publik v1.0** | 3 hari | Listing bot publik, halaman bantuan, kanal dukungan | Bot tayang di top.gg / discords.com |

**Total estimasi: ~8 minggu** untuk 1 developer paruh waktu. Kalau kamu bekerja sendiri sambil belajar TypeScript, kalikan 1,5–2x.

---

## 15. Risiko & Mitigasi

| Risiko | Dampak | Probabilitas | Mitigasi |
| --- | --- | --- | --- |
| Sumber audio (YouTube) diblokir/di-takedown | Tinggi | Tinggi | Abstraksi sumber di Lavalink → tinggal ganti plugin; sediakan config multi-sumber |
| Lavalink node crash | Tinggi | Sedang | Health check + auto-reconnect; siapkan node cadangan (bisa dari VPS kedua) |
| Dependency Discord berubah (breaking API) | Sedang | Sedang | Pin versi, ikuti changelog, jangan pakai API yang belum stabil |
| Abuse (spam perintah, lagu durasi ekstrem) | Sedang | Tinggi | Cooldown, limit antrean, limit durasi, permission DJ |
| Biaya VPS membengkak seiring jumlah server | Sedang | Sedang | Metrik resource, threshold untuk scaling, evaluasi sebelum rilis publik |
| Legal/DMCA & ban bot | Tinggi | Sedang | Kebijakan takedown, dokumentasi jelas, jangan monetisasi audio |
| Maintainer tunggal (bus factor = 1) | Tinggi | Tinggi | Dokumentasi arsitektur, test coverage, kode sederhana, README onboarding |
| Scope creep (fitur dashboard, ekonomi, leveling) | Sedang | Tinggi | Non-goals di Bab 3 mengikat; fitur baru hanya masuk lewat revisi PRD |

---

## 16. Keputusan Terbuka (Open Questions)

| # | Pertanyaan | Opsi | Perlu Diputuskan Sebelum |
| --- | --- | --- | --- |
| Q1 | Bahasa & stack? | (a) Node.js + discord.js *(rekomendasi)* (b) Python + discord.py (c) Go + disgo | M0 |
| Q2 | Audio engine? | (a) Lavalink *(rekomendasi)* (b) `@discordjs/voice` + ffmpeg langsung (c) yt-dlp wrapper | M2 |
| Q3 | Database? | (a) PostgreSQL *(rekomendasi)* (b) SQLite (c) MongoDB | M1 |
| Q4 | Hosting? | (a) VPS sendiri (b) Railway/Fly.io (c) Wispbyte/ReynoHost | M0 |
| Q5 | Nama & branding bot? | Beberapa kandidat nama + aset | M6 |
| Q6 | Publik atau privat? | (a) Publik penuh (b) Privat/beberapa server (c) Hybrid | M6 |
| Q7 | Monetisasi nanti? | (a) Tidak ada (b) Donasi (c) Premium fitur kosmetik | M6 |

---

## 17. Validasi Sebelum Ngoding (Checklist)

- [ ] Survei 10–20 pemilik server: bot apa yang dipakai sekarang, apa yang bikin kesal?
- [ ] Konfirmasi sumber audio mana yang bisa dipakai secara aman untuk proyek ini
- [ ] Putuskan Q1–Q4 di Bab 16
- [ ] Cek server test + akun Discord developer + aplikasi bot sudah dibuat
- [ ] Baca Discord Developer Terms & Community Guidelines sekali lagi
- [ ] Siapkan template kebijakan privasi & ToS bot

---

## 18. Lampiran

### 18.1 Glosarium
| Istilah | Arti |
| --- | --- |
| **Guild** | Istilah Discord API untuk "server" |
| **Lavalink** | Server audio terpisah yang menangani streaming; bot hanya mengirim perintah |
| **Node** | Instansi Lavalink yang bisa dihubungkan bot |
| **Slash command** | Perintah Discord berbasis `/` dengan UI native |
| **DJ role** | Role yang diberi hak kontrol musik |
| **Case** | Catatan satu aksi moderasi lengkap dengan bukti |
| **Automod** | Moderasi otomatis berbasis aturan |

### 18.2 Prioritas Fitur (MoSCoW)
- **Must:** play/queue/skip/stop, ban/kick/timeout/warn, logging dasar, welcome, slash command, config per-server
- **Should:** loop/shuffle/seek, automod, autorole, purge lanjutan, health check
- **Could:** playlist, lyrics, filter audio, dashboard (reaction roles & ticket sudah masuk M5)
- **Won't (v1):** ekonomi, leveling, game, monetisasi, sharding

### 18.3 Referensi
- Discord Developer Docs — https://discord.com/developers/docs
- discord.js Guide — https://discordjs.guide
- Lavalink — https://lavalink.dev
- Discord Bot Verification — https://support-dev.discord.com

---

## 19. Riwayat Perubahan

| Versi | Tanggal | Perubahan | Penulis |
| --- | --- | --- | --- |
| v1.0 | 2 Okt 2026 | **Halaman profil moderator** `/modprofile moderator:@user` (M3, §6.1): dua embed — ringkasan angka besar (total kasus, target unik, rentang waktu aktif, aktivitas 30 hari terakhir) dengan sebaran jenis aksi bergambar batang, lalu 10 kasus terbaru yang mengarahkan ke `/case` untuk detail. Satu moderator boleh mengaudit moderator lain; gate-nya Moderate Members, sama persis dengan `/case` yang juga menampilkan target & alasan. **Aturan hitungnya dibuat jujur karena statistik ini bisa dipakai mengadili:** `active: false` pada `warn` berarti peringatan **dicabut**, bukan aksi gagal — mencampurkannya akan terlihat seperti moderator gagal N kali padahal habis membersihkan peringatannya sendiri. Karena itu `failed` dan `revoked` dihitung dan ditampilkan terpisah (fungsi murni `moderatorFailedTotal`/`moderatorRevokedTotal`), dan hanya kasus gagal yang diberi tanda ⚠️. Rasio kasus per target hanya muncul di atas 1,5 supaya moderator yang memang butuh beberapa kali untuk satu orang tidak disamakan dengan yang menyerang target sama berulang. Aksi terhadap channel (`slowmode`/`lock`/`unlock`) dikecualikan dari hitungan *target unik* — ID channel bukan orang. Cakupan datanya dinyatakan eksplisit di footer: hanya kasus yang tercatat lewat Harmony dan berumur < 12 bulan, jadi ban/timeout manual dari Discord tidak pernah terhitung. Moderator tanpa kasus mendapat penjelasan, bukan "tidak ditemukan". Agregasi dihitung di database lewat `groupBy` + `groupBy targetId`, bukan memuat semua kasus ke memory; hanya 10 terbaru yang ditarik, jadi butuh indeks baru `(guild_id, moderator_id, created_at DESC)` — tanpanya halaman ini memindai seluruh tabel kasus tiap dibuka. Logika seluruhnya di modul murni `modProfile.ts` agar bisa diuji tanpa database, 50 tes baru (total 575) | Buffy |
| v1.0 | 2 Okt 2026 | **Transkrip tiket** (Fase 2, §5.2 & §12): saat tiket ditutup, isi channel diambil dan disimpan di kolom `transcript` pada **baris `ticket` yang sama**; `/ticket transcript [ticket]` menampilkannya sebagai cuplikan 8 pesan terakhir + seluruh isi dilampirkan sebagai berkas `.txt` (tidak ada yang terpotong). Pembaca hanya staff tiket atau pembuat tiketnya — untuk itu `setDefaultMemberPermissions(ManageGuild)` dicabut dari `/ticket` dan gate-nya dipindah ke per-subcommand, karena member tidak punya Manage Server sama sekali. **Penyimpanan di baris tiket, bukan tabel terpisah, adalah keputusan yang menentukan sisanya:** retensi menghapus baris tiket sehingga transkrip ikut hilang di operasi yang sama — tidak ada data percakapan yatim, dan "hapus tiket = hapus transkrip" jadi satu fakta, bukan dua hal yang harus dijaga sinkron. Urutan pengambilan juga menentukan: transkrip dibaca **sebelum** channel diarsipkan (dibuktikan tes urutan), saat bot pasti masih punya akses baca; diambil setelahnya, penyimpangan kecil pada hak akses bot bisa membuatnya hilang tanpa jejak. Kegagalan transkrip tidak menggagalkan penutupan. Batas 500 pesan terakhir (ditandai terpotong eksplisit di embed & akhir file), pesan sistem dibuang, URL lampiran disimpan tanpa mengunduh filenya, isi pesan dipotong 2.000 karakter, nama disimpan sebagai nama saat pesan dikirim. Kolom JSON dibaca lewat `parseTranscript` yang menolak bentuk rusak alih-alih menampilkan isi setengah jadi — lebih jujur mengatakan "tidak ada" daripada menampilkan yang tidak bisa dipercaya asalnya. `closeAndArchive` kini menerima service lewat DI (seperti `openTicket`) supaya urutan ini bisa diuji. **§12 diperbarui jujur:** transkrip ini membuat bot menyimpan isi percakapan member, jadi aturan "tidak ada data pribadi lain" tidak lagi berlaku dan job retensi 12 bulan menjadi kewajiban privasi, bukan sekadar pembersihan DB. 38 tes baru (total 525) | Buffy |
| v1.0 | 2 Okt 2026 | **Panel reaction role sementara** (Fase 2, §5.2 & §7.4): `/reactionrole post … duration:7d` memberi panel masa hidup; setelah habis, select menu **dilepas** dari pesan dan embed-nya diganti pengumuman "sudah ditutup" — pesannya sendiri tidak dihapus supaya jejaknya bisa dibaca admin dan member yang masih menyimpan tautan lama punya penjelasan. Default tetap permanen agar perilaku yang sudah ada tidak berubah; batas 10 menit–365 hari, satuan `m`/`h`/`d` (tanpa satuan dibaca sebagai jam), dan input yang tidak terbaca ditolak saat perintah dijalankan — panel yang tanpa sengaja jadi permanen baru ketahuan berminggu-minggu kemudian. Kolom `expires_at` + `closed_at` (index) di `reaction_role_panel`; `closed_at` membuat penyapuan bersifat *shrinking* sehingga panel tidak disapu ulang setiap siklus. **Kebenarannya ada dua lapis, bukan satu:** penjaga utama di select menu menolak panel yang `expires_at`-nya sudah lewat walau `closed_at` masih kosong — kondisi itu nyata setiap kali bot mati atau keceplosan tepat di detik kedaluwarsa; job penyapuan (`panelExpiryJob.ts`, `PANEL_EXPIRY_SWEEP_MINUTES`, default 15 menit) hanya membersihkan tampilan dan tidak memegang kebenaran. Job ini sengaja dipisah dari `retentionJob` karena mengubah pesan Discord dan butuh gateway yang sudah login, sehingga kegagalannya tidak pernah ikut menghapus data. `/reactionrole close` memakai jalur yang sama dengan penyapuan, seperti penutupan tiket. 42 tes baru (total 487) | Buffy |
| v1.0 | 2 Okt 2026 | Topik tiket lewat modal: tombol **Buat Tiket** tidak lagi langsung membuat channel, melainkan membuka modal satu text input (customId `ticket:subject`, wajib, 3–45 karakter sesuai batas *short* input Discord). Alasannya praktis — staff tahu harus menyiapkan apa sebelum member mengetik pesan pertama, dan member tidak perlu mengulang cerita di channel yang salah. Aturan topsik dipisah ke `validation.ts` yang murni (`parseTicketSubject`: spasi diratakan, minimal 3, dipotong 45) sehingga penolakan terjadi **sebelum** tiket tercatat dan tidak ada tiket bertopik kosong yang memblokir member membuka tiket baru; `missingTicketConfig` dipindah ke sana agar dipakai bersama tombol dan submit. Konfigurasi server dicek ulang saat modal dikirim, bukan hanya saat modal dibuka, karena di antara keduanya admin bisa saja mematikan modul atau memindahkan kategori. `openTicket()` kini menerima service lewat DI supaya alur buat-channel-birim-embed bisa diuji tanpa database, dan router komponen gaining filter `kinds` karena `ticket:subject` dan `ticket:create` sama-sama berawalan `ticket:`. 13 tes baru (total 445) | Buffy |
| v1.0 | 2 Okt 2026 | M5 dimulai: reaction roles + sistem tiket dasar (Fase 2, §5.2 & §7.4). **Reaction roles** — panel self-assign lewat string select menu (batas 25 opsi Discord), tabel `reaction_role_panel` + `reaction_role_option` dengan `customId` berbasis ID baris, `/reactionrole post\|add\|remove\|list\|delete`, toggle (pilih lagi untuk melepas), validasi role di atas bot / @everyone / tanpa izin Manage Roles sudah dilakukan saat panel dibuat, router komponen baru `componentRouter.ts`. **Tiket** — channel privat per tiket (izin ditulis eksplisit agar kategori yang menyinkronkan izin tidak membocorkan channel), tabel `ticket` dengan nomor monoton, satu tiket terbuka per member, tombol Klaim (khusus staff) dan Tutup (staff **atau** pembuat), penutupan = arsip: channel diganti nama `closed-NNNN` lalu dikunci **tanpa** menghapus isi, jalur tutup dipakai bersama oleh tombol dan `/ticket close`, tiket hantu langsung ditutup bila pembuatan channel gagal, retensi 12 bulan disapu di job yang sama dengan kasus moderasi. 40 tes baru (total 432) | Buffy |
| v1.0 | 2 Okt 2026 | Halaman ringkasan kasus `/case`: satu perintah menampilkan tiga embed — detail kasus (target, moderator, status aktif/dicabut/nonaktif, alasan, masa berlaku), riwayat 5 kasus lain atas target yang sama, dan log terkait dalam jendela ±1 jam dengan entri tertaut kasusnya di urutan teratas. Ban & timeout dicek langsung ke Discord untuk tahu apakah aksi masih berlaku. Helper baris entri log diekstrak jadi `logRecordSummary` supaya `/logs` dan `/case` menampilkan entri dengan format sama; filter `targetId` (opsional) & `prioritizeCaseLogs` ditambahkan ke query builder, 37 tes baru (total 363) | Buffy |
| v1.0 | 2 Okt 2026 | Statistik ringkas di `/logs`: opsi `stats:true` menampilkan jumlah event per kategori, aksi teratas (eventKey teratas dengan label Bahasa Indonesia), dan member paling sering terkait sebagai target maupun executor, untuk satu periode (tanpa `from` dibatasi ke masa simpan 30 hari dan dinyatakan eksplisit). Agregasi lewat `groupBy` Prisma di database — 4 query paralel, ditambah tabel silang target × executor hanya bila ada user yang muncul di kedua sisi supaya aksi pada diri sendiri tidak terhitung dua kali. Target dari kategori `channel` & `role` disaring (kolom `targetId` mereka berisi ID channel/role, bukan member). Modul `stats.ts` murni (agregasi + label + batang) diuji tanpa database, 34 tes baru (total 326) | Buffy |
| v1.0 | 2 Okt 2026 | Draft awal | (isi nama) |
| v1.0 | 2 Okt 2026 | M0 dieksekusi: scaffold proyek (TypeScript strict + ESLint + Vitest), validasi env dengan zod, loader perintah/event otomatis, `/ping` + `/help`, Docker Compose (bot + Lavalink v4 + PostgreSQL + Redis), CI GitHub Actions | Buffy |
| v1.0 | 2 Okt 2026 | Ekspor log untuk arsip/audit: `/logs … format:json\|csv` membangun file dari hasil pencarian yang difilter (maks 500 entri), JSON memuat filter asal + metadata arsip, CSV ber kolom tetap dengan quoting RFC 4180 dan proteksi formula (`=`, `+`, `-`, `@`), file dilampirkan ke balasan sekaligus diarsipkan ke `data/exports/` (best-effort, `LOG_EXPORT_DIR`), nama file bertimestamp UTC, 20 tes baru (total 292) | Buffy |
| v1.0 | 2 Okt 2026 | Log kasus ikut routing per kategori (`deliverCaseLog`): `/warn` — yang tidak memicu event Discord — sekarang masuk ke channel hasil `/logging set …`, bukan hanya channel log global; embed event dari aksi Harmony dibuat ringkas (fokus ke tautan kasus) supaya tidak dobel di channel yang sama, 272 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | Job retensi data: penghapusan otomatis kasus & peringatan yang lewat 12 bulan (`retention.ts` murni + `ModerationService.purgeExpired` + repository `deleteExpired*`), dijadwalkan di dalam proses bot (`retentionJob.ts`, timer `unref`, latch anti-tumpang-tindih, gagal = peringatan bukan crash), interval lewat `RETENTION_SWEEP_HOURS` (0 = mati), skrip sekali-jalan `npm run db:prune` untuk cron luar, 18 tes baru (total 268) | Buffy |
| v1.0 | 2 Okt 2026 | Log tertaut ke kasus moderasi: registry tautan singkat (`caseLink.ts`, TTL 60 detik) diisi perintah sebelum aksi Discord dieksekusi, lalu dipakai event `guildBanAdd`/`guildBanRemove`/`guildMemberRemove`/`guildMemberUpdate`/`channelUpdate` untuk menampilkan `Sumber` + `Kasus #CASE-…`; aksi dari bot lain atau moderator manusia ditandai eksplisit; kasus menjadi satu baris riwayat tunggal (event tidak mencatat ulang) dan `/logs case:` bisa mencarinya, kolom `case_id` + index baru, 250 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | Riwayat log + `/logs`: tabel `log_entry` (kategori, kunci event, executor, target, channel asal, ringkasan isi embed, ID pesan log, `expiresAt` retensi 30 hari), `dispatchLog` menyimpan entri sebelum mengirim lalu menempelkan ID pesan untuk tautan lompat, pencarian dengan filter kategori/user/channel/kata kunci/rentang tanggal (relatif `7d` atau kalender) + halaman, builder `where` murni yang bisa dites, env minimal untuk tes lewat `tests/setup.ts`, 225 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | M4 (logging) dieksekusi: 22 event Discord dipetakan ke 6 kategori (member, pesan, channel, role, voice, server), embed berwarna per kategori dengan executor dari audit log + diff role/izin/channel/voice/server, routing channel per kategori lewat `/logging show\|set\|reset` dengan fallback `logChannelId` global dan tabel `guild_log_subscription` (cache 60 detik), `dispatchLog` best-effort yang tidak pernah menggagalkan alur event, 184 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | M4 (automod) dieksekusi: engine 7 rule murni + tracker state (anti-spam 5 detik & anti-duplicate per user), tabel `automod_rule` (actions & whitelist JSON), perintah `/automod show\|toggle\|threshold\|badword\|whitelist`, event `messageCreate` (hapus + peringatan ke sistem kasus + timeout 10 menit + log channel), toggle modul via `/config set`, 166 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | M3 dilengkapi: `/unban` (verifikasi ban + DM), `/slowmode` (parser 0–6 jam), `/lock` & `/unlock` berbasis override @everyone (teks → `SendMessages`, voice → `Connect`), `/note add\|show` sebagai catatan internal tanpa DM, kasus untuk aksi channel (target = channel), 115 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | M3 dieksekusi: kasus moderasi bernomor per server (`#CASE-0142`) + tabel `moderation_case` & `warning`, 7 perintah admin dengan gate izin berlapis dan anti-hierarki, DM target + log channel best-effort (kasus ditandai tidak aktif bila eksekusi Discord gagal), welcome/goodbye + autorole (kolom `autoroleId`, `autoroleBotId`, `goodbyeMessage`), 110 tes unit | Buffy |
| v1.0 | 2 Okt 2026 | M2 dieksekusi: klien Lavalink (shoukaku v4) dengan driver adapter node + auto-reconnect, 7 perintah musik, antrean milik bot (karena `player.track` hanya base64), izin DJ berbasis konfigurasi server, timer auto-disconnect yang bisa dites, 75 tes unit, perbaikan build (`dist` dibersihkan) dan konvensi helper `_` di loader | Buffy |
| v1.0 | 2 Okt 2026 | M1 dieksekusi: Prisma 7 + PostgreSQL (tabel `guild_config`), service konfigurasi dengan cache in-memory 60 detik, validasi patch dengan zod, wizard `/setup` berbasis menu, `/config show\|set\|reset`, service migrasi di Docker Compose, 35 tes unit | Buffy |
