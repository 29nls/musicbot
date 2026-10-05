# Menjalankan Harmony di CasaOS / ZimaOS

Berkas di folder ini adalah **alternatif** untuk [docker-compose.yml](../../docker-compose.yml)
di root. Yang berbeda bukan service-nya — semuanya sama persis — tapi cara memasangnya ke NAS.

Pilihan mana yang dipakai:

| | `docker-compose.yml` (root) | Berkas ini (CasaOS) |
|---|---|---|
| Checkout repo di NAS | Wajib | Tidak perlu |
| `npm`/`node` di NAS | Wajib untuk dev | Tidak perlu |
| Metadata app store CasaOS | Tidak ada | Ada (`x-casaos`) |
| Data di luar folder project | Boleh | Dibatasi ke `/DATA/AppData` |
| Build image Lavalink | Pakai image upstream | Image turunan dari repo |

Kalau NAS-nya sudah punya clone repo dan tidak masalah memakai SSH, compose di root
juga berfungsi. Berkas ini ada supaya bot bisa dipasang sebagai "app" CasaOS biasa.

---

## Syarat

- CasaOS atau ZimaOS dengan Docker yang sudah berjalan.
- Token bot Discord, Client ID, dan `DATABASE_URL` (Supabase) yang sudah siap.
- Ruang disk ±2 GB: image bot, image Lavalink, dan volume Redis.

## Langkah

**1. Siapkan folder data dan berkas `.env`**

```bash
mkdir -p /DATA/AppData/harmony-bot
curl -fsSL https://raw.githubusercontent.com/29nls/musicbot/main/.env.example \
  -o /DATA/AppData/harmony-bot/.env
curl -fsSL https://raw.githubusercontent.com/29nls/musicbot/main/deploy/casaos/preflight.mjs \
  -o /DATA/AppData/harmony-bot/preflight.mjs
```

Berkas `preflight.mjs` ikut diunduh karena pesan error compose menyuruh
menjalankannya dengan `node`. Skrip itu sengaja ditulis kompatibel **Node
12.17+** — NAS CasaOS/ZimaOS lazim membawa Node lama, dan versi pertamanya
pernah gagal di sana dengan `SyntaxError: Unexpected token '?'`. Kalau NAS
belum punya Node sama sekali, jalankan skripnya dari mesin lain: ia hanya
membaca berkas `.env`, jadi tidak harus jalan di NAS.

Isi minimal `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, dan
`LAVALINK_PASSWORD`. Daftar lengkap ada di [`.env.example`](../../.env.example).

Periksa dulu sebelum lanjut — skrip ini melaporkan variabel yang kosong, masih
berupa contoh, atau salah lokasi:

```bash
node /DATA/AppData/harmony-bot/preflight.mjs
```

> `LAVALINK_PASSWORD` **wajib diisi dan tidak boleh kosong**. Compose
> memperlakukan nilai kosong sama dengan tidak ada, jadi pesan errornya berbunyi
> "missing a value" padahal barisnya sudah ada. Penolakan itu disengaja: password
> Lavalink yang kosong membuat mesin audio bisa diakses siapa saja di jaringan
> compose.

**2. Ambil berkas compose**

```bash
curl -fsSL https://raw.githubusercontent.com/29nls/musicbot/main/deploy/casaos/docker-compose.yml \
  -o /DATA/AppData/harmony-bot/docker-compose.yml
```

**3. Start**

Dari SSH:

```bash
cd /DATA/AppData/harmony-bot
docker compose up -d
```

Dari antarmuka CasaOS: buka **Apps > File Manager**, masuk ke
`/DATA/AppData/harmony-bot`, lalu jalankan stack lewat compose editor yang
disediakan CasaOS.

Build pertama mengunduh dependensi npm dan image Lavalink, jadi butuh beberapa
menit tergantung koneksi. Build berikutnya memakai cache.

## Kalau `docker compose up` gagal

### `required variable LAVALINK_PASSWORD is missing a value`

Ini dibaca saat compose di-parse, dari `.env` di **direktori proyek compose** —
bukan dari berkas yang disebut di `env_file:`. Dua sumber itu punya nama sama
tetapi berbeda, jadi mudah terkira satu hal.

Jalankan diagnosisnya dulu (skripnya sudah diunduh di langkah 1):

```bash
node /DATA/AppData/harmony-bot/preflight.mjs
```

Yang biasanya jadi penyebab:

| Penyebab | Cara memperbaiki |
|---|---|
| `LAVALINK_PASSWORD=` kosong di `.env` | Isi dengan password, mis. `LAVALINK_PASSWORD=hasil-acak-panjang` |
| Baris masih `harmony_dev_password` dari `.env.example` | Ganti dengan password sungguhan |
| Compose dijalankan dari folder lain | `cd /DATA/AppData/harmony-bot && docker compose up -d` |
| `.env` ada di path lain | `docker compose --env-file /path/lain/.env up -d` |

Membuat password acak langsung di NAS — aman dijalankan berulang: baris yang
sudah ada ditimpa, yang belum ada ditambahkan.

```bash
cd /DATA/AppData/harmony-bot
PW=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-24)
grep -q '^LAVALINK_PASSWORD=' .env || printf '\nLAVALINK_PASSWORD=%s\n' "$PW" >> .env
sed -i "s|^LAVALINK_PASSWORD=.*|LAVALINK_PASSWORD=$PW|" .env
node preflight.mjs    # lompati kalau Node di NAS lebih tua dari 12.17
docker compose up -d
```

`LAVALINK_PASSWORD` yang sama juga dibaca bot lewat `env_file:`, jadi tidak ada
yang perlu disalin manual ke tempat lain.

### `SyntaxError: Unexpected token '?'` saat menjalankan preflight

Node di NAS lebih tua dari 14. Versi pertama `preflight.mjs` memakai `??` dan
impor `node:fs` yang baru ada di Node 14/16; itu sudah dihapus, jadi cukup unduh
ulang skripnya (langkah 1). Skrip yang sekarang jalan di Node 12.17+, dan baris
pertama keluarannya mencetak versi Node. Kalau Node di NAS tetap lebih tua dari
12.17, jalankan preflight dari mesin lain — cukup berkas `.env`-nya ada di NAS.

> Node host hanya dipakai skrip bantu ini. Bot dan Lavalink berjalan di
> container masing-masing, jadi versi Node di NAS tidak memengaruhi pemutaran
> musik.

### `permission denied ... unix:///var/run/docker.sock`

Compose-nya tidak salah — shell SSH-mu tidak punya izin ke socket Docker. Dua
galat sebelumnya (`missing a value` dan `SyntaxError`) muncul saat berkas dibaca,
sebelum compose menyentuh Docker, jadi izin ini baru teruji sekarang.

Periksa dulu, belum perlu mengubah apa pun:

```bash
ls -l /var/run/docker.sock   # biasanya root:docker, mode srw-rw----
groups                       # apakah "docker" ada di daftar?
```

Kalau `docker` tidak ada di keluaran `groups`, tambahkan user SSH-mu ke grup itu
lalu masuk ke shell dengan grup baru:

```bash
sudo usermod -aG docker "$USER"
newgrp docker                # hanya untuk shell ini; sesi SSH baru sudah membawanya sendiri
docker compose up -d
```

Kalau tidak ingin mengubah keanggotaan grup dulu, menjalankan stack sebagai root
juga langsung bekerja dan cukup untuk sekali jalan:

```bash
sudo docker compose up -d
```

Selama grup `docker` belum ditambahkan, setiap perintah `docker ...` di SSH
butuh `sudo`. Kalau kolom grup di `ls -l` bukan `docker` melainkan nama lain,
pakai nama itu di `usermod -aG`. Kalau `root`, lewati langkah grup dan tetap
pakai `sudo docker ...`.

Lewat antarmuka CasaOS masalah ini tidak muncul: compose editor CasaOS berjalan
sebagai root. Yang butuh grup `docker` hanya perintah di SSH.

### Bot start lalu langsung mati

```bash
docker compose logs bot | head -40
```

Paling sering: migrasi gagal (koneksi database ditolak) atau `.env` terpotong
karena ada spasi di sekitar `=`. `preflight.mjs` sudah memeriksa keduanya.

```bash
cd /DATA/AppData/harmony-bot
docker compose ps              # bot & lavalink harus Up
docker compose logs -f bot     # cari baris "✅ Harmony siap menerima perintah"
curl -fsS http://localhost:8080/health
```

Endpoint `/health` juga yang dibuka CasaOS sebagai "app" — bot tidak punya
antarmuka web lain.

## Yang perlu disesuaikan

| Variabel | Baku | Kapan diubah |
|---|---|---|
| `CASAOS_PORT` | `8080` | Port sudah dipakai service lain di NAS — **harus diubah juga** di `x-casaos.port_map` |
| `PUID` / `PGID` | `1000` | User CasaOS-mu punya id berbeda (`id -u` di SSH) |
| `HARMONY_DATA` | `/DATA/AppData/harmony-bot` | Penyimpanan NAS ada di mount lain |
| `HARMONY_REF` | `main` | Bot yang dites dari branch lain |

`HEALTH_PORT` **diabaikan** oleh stack ini dan dipaksa ke `8080`, supaya port
yang dipublish dan port yang diprobe health check tidak bisa melenceng. Kalau
`.env` diisi `HEALTH_PORT` lain, nilainya diabaikan oleh compose CasaOS.

Satu yang mudah terlewat: `x-casaos.port_map` berisi **string biasa**, bukan
ekspresi, jadi tidak ikut berubah kalau `CASAOS_PORT` diganti. Kalau hanya
`CASAOS_PORT` yang diubah, CasaOS tetap membuka port lama dan gejalanya hanya
"apinya tidak merespons". Ubah keduanya.

## Update

```bash
cd /DATA/AppData/harmony-bot
docker compose pull 2>/dev/null || true
docker compose build --pull
docker compose up -d
```

`migrate` dijalankan ulang otomatis oleh `depends_on`, jadi skema database
selalu sudah paling dulu sebelum bot start.

---

## Batas yang perlu jujur diketahui

- **Belum pernah dijalankan di CasaOS sungguhan.** Compose ini disusun dari
  konvensi CasaOS/ZimaOS dan divalidasi secara struktural, tapi tidak ada
  hardware NAS untuk mencobanya. Dua hal yang belum terverifikasi secara
  nyata: apakah CasaOS membaca blok `x-casaos` dengan versi yang tepat, dan
  berapa lama build pertama di NAS yang sebenarnya.
- **Build dari jaringan, bukan image siap pakai.** Compose mengambil sumber
  dari GitHub lalu build sendiri. Untuk NAS kecil ini bisa lama. Alternatifnya
  mendorong image ke registry lalu mengganti `build:` dengan `image:`.
- **`/health` bukan dasbor.** Bot ini memang tidak punya UI. Endpoint itu
  mengembalikan JSON status, yang dipakai monitoring (PRD §11) — bukan tempat
  mengelola server.
- **Tidak ada Postgres lokal.** Kolom `postgres` di compose root sengaja tidak
  ada di sini: database produksi adalah Supabase, dan menimpanya dengan
  hostname container berarti bot bicara ke database yang berbeda dari yang
  migrasinya baru diterapkan.