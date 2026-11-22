# Standard Setup — Harmony (tanpa Docker, hanya Node.js)

Panduan ini memasang **seluruh stack Harmony dari awal menggunakan hanya Node.js**,
tanpa Docker, tanpa Docker Compose, dan tanpa container. Cocok untuk laptop kecil
atau mesin di mana Docker Desktop tidak tersedia (atau terlalu berat).

Jika kamu justru ingin memakai Docker untuk Lavalink + Redis, lihat bagian
["Menjalankan seluruh stack lewat Docker"](README.md#menjalankan-seluruh-stack-lewat-docker)
di README.

---

## 1. Prasyarat

| Kebutuhan | Versi / Catatan | Di mana diperiksa |
| --- | --- | --- |
| **Node.js** | 24+ (diuji di v24.22.3) | `node --version` |
| **npm** | 10+ (ikatan dari Node) | `npm --version` |
| **Java** | 17+ (hanya untuk Lavalink) | `java -version` |
| **yt-dlp** | 2026.08.19+ (untuk audio YouTube) | `yt-dlp --version` *atau* isi `YTDLP_PATH` |
| **ffmpeg** | 6+ (encode Opus untuk voice) | `ffmpeg -version` |
| **PostgreSQL** | 14+ — lewat container `postgres` di compose, atau pasang sendiri | `psql --version` |
| **Redis** | 6+ — *service opsional, `REDIS_URL` tetap wajib diisi* | `redis-cli ping` |

> **Database-nya lokal.** Bot memakai PostgreSQL di mesin ini, tanpa layanan
> cloud: cukup container `postgres` dari compose (langkah 4), atau PostgreSQL
> yang sudah terpasang.

> **Service Redis opsional, variabelnya wajib.** `REDIS_URL` harus tetap diisi
> dengan alamat yang sah (mis. `redis://localhost:6379`). Jika alamat itu tidak
> terjangkau, bot otomatis memakai penyimpanan memori dan mencatat peringatan di
> log — bot tetap berjalan, hanya rate limit jadi per-proses (tidak optimal
> untuk sharding).

### Pasang di Windows

- **Node.js**: unduh di [nodejs.org](https://nodejs.org) (LTS) atau
  `winget install OpenJS.NodeJS`.
- **Java**: `winget install EclipseAdoptium.Temurin.21.JRE`
  (atau versi 17+).
- **yt-dlp**: `python -m pip install --user yt-dlp` — hasilnya masuk ke
  `%APPDATA%\Python\PythonXY\Scripts\yt-dlp.exe` dan **tidak otomatis di PATH**.
  Catat jalurnya untuk `YTDLP_PATH`.
- **ffmpeg**: `winget install ffmpeg`
  (memasang di `%LOCALAPPDATA%\Programs\ffmpeg\bin\ffmpeg.exe`).

### Pasang di macOS

```bash
brew install node openjdk@21 yt-dlp ffmpeg redis
# Java perlu didaftarkan sebagai runtime untuk Lavalink:
sudo ln -sfn $(brew --prefix openjdk@21)/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-21.jdk
```

### Pasang di Linux (Debian/Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs openjdk-21-jre yt-dlp ffmpeg redis-server
```

---

## 2. Kloning & dependency

```bash
git clone https://github.com/29nls/musicbot.git harmony-bot
cd harmony-bot

# Satu perintah: npm install + generate Prisma Client (postinstall)
npm install
```

> `npm install` memicu `postinstall` → `prisma generate`. Jika gagal karena
> koneksi database, abaikan saja — itu hanya menyiapkan *client*, migrasi
> dilakukan di langkah 5.

---

## 3. Konfigurasi `.env`

```bash
cp .env.example .env
```

Setelah itu edit `.env` dan isi nilai berikut (wajib):

```env
# ── Discord ────────────────────────────────────────────────
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DEV_GUILD_ID=YOUR_DEV_GUILD_ID      # ID server dev (mode developer)
# Ambil ID-nya: Discord → Settings → Advanced → Developer Mode aktif, lalu klik
# kanan nama server → Copy Server ID. Kalau dikosongkan, command didaftarkan
# global (butuh ±1 jam).

# ── Database (PostgreSQL lokal) ─────────────────────────────
DATABASE_URL=postgresql://harmony:harmony_dev_password@localhost:5432/harmony
# Password di URL harus sama dengan POSTGRES_PASSWORD di bawah (atau dengan
# user yang kamu buat sendiri kalau Postgres-nya bukan dari compose).

# ── Cache (service opsional, REDIS_URL wajib diisi) ─────────
REDIS_URL=redis://localhost:6379

# ── Lavalink ───────────────────────────────────────────────
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=isi_password_acak_di_sini

# ── Audio (YouTube) ────────────────────────────────────────
YOUTUBE_OAUTH_ENABLED=false                 # true kalau lagu ditolak YouTube ("All clients failed")
# YTDLP_PATH=C:/Users/ANDA/.../yt-dlp.exe   # isi kalau yt-dlp tidak di PATH
# YTDLP_COOKIES_FILE=/path/to/cookies.txt   # opsional, bypass bot check

# ── Lampiran audio (`/play file:`) ─────────────────────────
# Lavalink dan bot sama-sama jalan di mesin ini, jadi path-nya sama. Kosongkan
# nilai bawaan di .env.example yang ditujukan untuk Lavalink di container.
ATTACHMENT_LAVALINK_DIR=
```

### Membuat `LAVALINK_PASSWORD` acak

```bash
# Windows (PowerShell)
[System.Guid]::NewGuid().Guid

# macOS / Linux
openssl rand -hex 16
```

Password inilah yang juga diteruskan ke Lavalink — jangan biarkan kosong,
beri komentar jika sudah diisi.

---

## 4. Skema database

Database-nya PostgreSQL lokal. Paling mudah lewat container di compose:

```bash
# Nyalakan database (data disimpan di volume postgres_data)
docker compose up -d postgres

# Terapkan migrasi yang ada
npm run db:deploy
```

Container `postgres` mem-publish port ke `127.0.0.1:5432`, jadi kedua perintah
di atas berjalan dari host tanpa overlay dev. Port itu tidak terbuka ke mesin
lain di jaringan.

Kalau Postgres-nya **tidak** dari compose, siapkan user dan database-nya dulu,
lalu arahkan `DATABASE_URL` ke sana:

```bash
# Windows: winget install PostgreSQL.PostgreSQL
# macOS:   brew install postgresql@16 && brew services start postgresql@16
# Linux:   sudo apt-get install postgresql-16

psql -U postgres -c "CREATE USER harmony WITH PASSWORD 'harmony_dev_password';"
psql -U postgres -c "CREATE DATABASE harmony OWNER harmony;"

# Edit .env supaya DATABASE_URL menunjuk Postgres itu, lalu:
npm run db:deploy
```

`db:deploy` menerapkan migrasi yang sudah ada. Untuk menulis migrasi baru dari
perubahan `prisma/schema.prisma`, pakai `npm run db:migrate`.

---

## 5. Lavalink (mesin audio) tanpa Docker

Lavalink hanyalah aplikasi Java. Skrip `tools/start-lavalink.mjs` menjalankannya
langsung dari folder `lavalink/` dengan heap yang bisa diturunkan — ini diganti
dibandingkan Docker untuk laptop kecil.

```bash
# Unduh Lavalink.jar (~96 MB) sekali, lalu jalankan:
npm run infra:lavalink -- --download
```

Skrip ini:
- Membaca `LAVALINK_PASSWORD`, `YOUTUBE_OAUTH_ENABLED`, `YOUTUBE_REFRESH_TOKEN`,
  dan `YTDLP_PATH` dari `.env`, lalu meneruskannya ke JVM sebagai environment.
- Memberi log: `Lavalink 4.2.2 | heap -Xmx512m | konfigurasi lavalink/application.yml`
- Membuat Lavalink mendengar di `localhost:2333`.

> **Heap lebih kecil untuk laptop kecil:**
> ```bash
> LAVALINK_HEAP=256m npm run infra:lavalink
> ```

Buka **terminal terpisah** (atau tab baru) untuk langkah berikutnya —
`npm run infra:lavalink` tetap berjalan di foreground.

Verifikasi Lavalink siap:

```bash
curl -s http://localhost:2333/health | head -1
# {"status":"ok", ...}
```

Baris `Registering YTDLP audio source manager...` di log berarti sumber
yt-dlp sudah aktif. Jika tidak muncul, restart Lavalink setelah memastikan
`lavalink/application.yml` punya `lavasrc.sources.ytdlp: true`.

### Lampiran audio dan URL langsung

`/play` bisa memutar berkas yang diunggah lewat opsi `file:`. Batas ukurannya
**25 MB** (`MAX_ATTACHMENT_BYTES`, mengikuti batas unggahan Discord). Berkas
disimpan sementara di `cache/attachments`, dibaca Lavalink lewat sumber `local`,
lalu dihapus saat lagu selesai, dilewati, atau dihentikan. Untuk berkas yang
lebih besar, unggah ke hosting sendiri dan pakai `/play <URL>`: bot tidak
mengunduhnya, Lavalink mengambil langsung lewat sumber `http`.

Kedua sumber sudah aktif di `lavalink/application.yml` (`local: true` dan
`http: true`); tidak ada yang perlu diubah. Cek bahwa Lavalink bisa membaca
berkas lampiran (port Lavalink tidak dipublikasikan, jadi perintah dijalankan
di dalam container):

```bash
docker compose exec lavalink sh -c 'wget -qO- \
  --header="Authorization: $LAVALINK_SERVER_PASSWORD" \
  "http://127.0.0.1:2333/v4/loadtracks?identifier=/opt/Lavalink/attachments/<folder>/<berkas>.wav"'
```

Balasan `"loadType":"track"` berarti berkas terbaca. Diuji pada stack Docker
repo ini: lampiran WAV menghasilkan `track` 1 detik, URL langsung `http://...`
menghasilkan `track` 2 detik, dan berkas sementara terhapus dari sisi bot maupun
Lavalink. Uji itu memakai REST Lavalink, bukan unggahan Discord sungguhan, jadi
sekali-sekali tetap coba `/play file:` langsung di server dev untuk memastikan
pemutaran ke voice channel.

---

## 6. Redis (service opsional)

Redis boleh tidak dipasang, tetapi `REDIS_URL` tetap wajib diisi. Jika sudah
terpasang:

```bash
# macOS
brew services start redis

# Linux (setelah apt-get install redis-server)
sudo systemctl enable --now redis-server

# Windows (gunakan winget)
winget install Redis.Roadkill

# Kemudian uji:
redis-cli ping
# PONG
```

Jika tidak memasang Redis, tetap isi `REDIS_URL` dengan alamat yang sah (mis.
`redis://localhost:6379`). Kalau alamat itu tidak terjangkau, bot memakai store
memori dan mencatat peringatan.

---

## 7. yt-dlp & ffmpeg (audio)

### yt-dlp

```bash
# Semua platform
python -m pip install --user yt-dlp

# Atau lewat package manager
# macOS:  brew install yt-dlp
# Linux:  sudo apt-get install yt-dlp
# Windows: winget install yt-dlp.yt-dlp
```

Cek: `yt-dlp --version` → harus ≥ `2026.08.19`.

Jika yt-dlp tidak di PATH (umum di Windows karena `pip --user`), isi di `.env`:

```env
YTDLP_PATH=C:/Users/ANDA/AppData/Roaming/Python/Python314/Scripts/yt-dlp.exe
```

### ffmpeg

Dipakai bot untuk encode Opus (untuk kualitas suara Discord). Biasanya sudah
tersedia jika kamu memutar video di browser. Cek:

```bash
ffmpeg -version
```

Jika tidak ada, pasang:

- Windows: `winget install ffmpeg`
- macOS: `brew install ffmpeg`
- Linux: `sudo apt-get install ffmpeg`

Jika ffmpeg tidak di PATH, isi `FFMPEG_PATH` di `.env` (opsional — biasanya
bot cukup menemukannya sendiri).

### Memverifikasi yt-dlp bisa mengambil audio YouTube

```bash
yt-dlp --version
yt-dlp -o - -f bestaudio "https://www.youtube.com/watch?v=dQw4w9WgXcQ" | head -c 100 | xxd | head -2
# Harus keluar data biner (bukan "ERROR")
```

---

## 8. Deploy slash command & jalankan bot

```bash
# Daftarkan perintah ke server dev (instan karena DEV_GUILD_ID terisi)
npm run deploy

# Jalankan bot di development (auto-reload lewat tsx)
npm run dev
```

Jika berhasil, log akan menampilkan bertahap:

```
✅ Semua perintah dimuat
✅ Semua event terpasang
✅ Database terhubung
✅ Harmony siap menerima perintah
```

### Production build

```bash
npm run build
npm start
```

---

## 9. Verifikasi akhir

Setelah bot online:

```bash
# Cek bot hidup
curl -s http://localhost:8080/health | head -1
# {"status":"ok", ...}

# Cek semua dependency siap
curl -s http://localhost:8080/ready
# {"status":"ready", ...}
```

Di Discord:
1. Ketik `/play` di server dev.
2. Pilih lagu (misalnya ketik "test" di kotak pencarian).
3. Bot harus join voice channel dan memutar audio.
4. Untuk berkas sendiri, isi opsi `file:` (maks 25 MB). Berkas lebih besar
   diunggah ke hosting sendiri lalu diputar lewat `/play <URL>`.

Jika lagu tidak berputar, cek log bot untuk baris
`Registering YTDLP audio source manager...` pada saat Lavalink start.

---

## 10. Ringkasan perintah

| Langkah | Perintah | Keterangan |
| --- | --- | --- |
| Install | `npm install` | + generate Prisma Client |
| Konfig | `cp .env.example .env && nano .env` | isi token, DB URL, password |
| Migrasi | `npm run db:deploy` | `migrate deploy`, bukan `migrate dev` |
| Lavalink | `npm run infra:lavalink -- --download` | unduh jar sekali, jalan di foreground |
| Redis | `redis-cli ping` | service opsional; `REDIS_URL` wajib diisi |
| yt-dlp | `yt-dlp --version` | (opsional) isi `YTDLP_PATH` kalau perlu |
| Deploy command | `npm run deploy` | daftarkan slash command ke DEV_GUILD_ID |
| Jalankan | `npm run dev` | auto-reload, atau `npm run build && npm start` |

---

## 11. Pemecahan masalah

### "Cannot find module prisma" / generate gagal
```bash
npx prisma generate
npm install
```

### Lavalink gagal start: "Java tidak ditemukan"
Pastikan Java 17+ terpasang dan ada di PATH:
```bash
java -version
# Jika belum: winget install EclipseAdoptify.Temurin.21.JRE
```

### "database connection failed" setelah migrasi berhasil
- Pastikan container Postgres hidup: `docker compose ps postgres`.
- Saat bot jalan di dalam container, host `localhost` tidak berlaku — compose
  menimpanya menjadi `postgres`; kalau bot dijalankan dari host, pakai
  `localhost`.
- Cocokkan password di `DATABASE_URL` dengan `POSTGRES_PASSWORD` di `.env`.

### Musik YouTube ditolak: "All clients failed to load the item"
Ini artinya YouTube memblokir IP ini untuk musik. Buka di `.env`:
```env
YOUTUBE_OAUTH_ENABLED=true
```
Restart Lavalink. Token refresh akan tercetak di log pertama kali.

Atau gunakan jalur kedua yt-dlp (lihat [README.md → Jalur kedua yang sudah terbukti: yt-dlp](README.md#jalur-kedua-yang-sudah-terbukti-yt-dlp)): pastikan `YTDLP_PATH` isi dan
`lavasrc.sources.ytdlp: true` ada di `lavalink/application.yml`.

### "permission denied while trying to connect to the docker API"
Ini biasanya terjadi jika kamu tetap menggunakan `docker compose up -d` di
NAS/CasaOS. Ikuti panduan di
[deploy/casaos/README.md](deploy/casaos/README.md) untuk setup tanpa Docker
di perangkat NAS.

### Scan glitch CLEAN di semua file
Repo ini memerlukan semua file yang disentuh lolos pemeriksaan `scan-glitch`.
Bila kamu menambahkan skrip baru, jalankan:
```bash
node tools/scan-glitch.cjs <filebaru>
```
