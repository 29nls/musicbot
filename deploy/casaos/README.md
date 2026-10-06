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

Kalau yang diinginkan justru **mengembangkan bot langsung di NAS** — `npm run dev`
dengan hot reload — ada dua jalur di bawah, dan keduanya bekerja tanpa app CasaOS
ini:

- [Jalankan Lavalink dan `npm run dev` bersamaan](#jalankan-lavalink-dan-npm-run-dev-bersamaan)
  — bot di host, Lavalink dan Redis tetap di container. Bagian itu menjelaskan
  kenapa app CasaOS harus dimatikan dulu, dan kenapa perintahnya bukan
  `npm run infra:up`.
- [Jalankan Lavalink dan `npm run dev` tanpa Docker](#jalankan-lavalink-dan-npm-run-dev-tanpa-docker)
  — keduanya di host, tidak ada container sama sekali. Hanya butuh Node LTS,
  Java 17+, dan `yt-dlp`.

---

## Syarat

- CasaOS atau ZimaOS dengan Docker yang sudah berjalan.
- Token bot Discord, Client ID, dan `DATABASE_URL` (Supabase) yang sudah siap.
- Ruang disk ±2 GB: image bot, image Lavalink, dan volume Redis.
- **Node.js 12.x? Upgrade ke LTS dulu** — lihat
  [Update Node.js ke LTS](#update-nodejs-ke-lts) di bawah. `preflight.mjs`
saat ini kompatibel Node 12, tapi versi LTS lebih baru jauh lebih andal.

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

### Update Node.js ke LTS

Jika NAS masih bawaan Node 12.x (lazim di CasaOS lama), upgrade ke LTS
terbaru (v22+) supaya semua alat jalan dengan stabil:

```bash
# Cek versi & arsitektur dulu
node --version   # contoh: v12.22.12
uname -m         # aarch64 = ARM64 (Amlogic), x86_64 = Intel

# Pasang `n` (manajer versi Node) lewat npm yang ada
npm install -g n

# Install Node.js LTS terbaru
n lts

# Buat shell ini pakai versi baru
source ~/.profile   # atau: logout lalu login kembali
node --version      # contoh: v22.11.0
```

Jika `npm install -g n` gagal (mis. npm juga rusak), pasang `n` langsung dari
GitHub — tidak perlu npm sama sekali:

```bash
curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n \
  -o /usr/local/bin/n
sudo chmod +x /usr/local/bin/n
n lts

hash -r
node --version      # harus ≥ v22 LTS
```

Atau unduh binary resmi langsung dari nodejs.org (menggunakan direktori LTS,
**bukan** `/latest/` yang berisi rilis *Current*):

```bash
ARCH=$(uname -m)
NODE_ARCH=$([ "$ARCH" = "aarch64" ] && echo "arm64" || echo "x64")

# Dapatkan versi LTS terbaru dari index.json
# (filter: properti lts berupa string, bukan false)
NODE_VER=$(curl -fsSL https://nodejs.org/dist/index.json \
  | grep '"lts":"[A-Z]' | head -1 \
  | grep -oP '"version":"\Kv[0-9]+\.[0-9]+\.[0-9]+')

cd /tmp
curl -O "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-${NODE_ARCH}.tar.xz"
NODE_DIR=$(tar -tf "node-${NODE_VER}-linux-${NODE_ARCH}.tar.xz" | head -1 | cut -d/ -f1)
tar -xf "node-${NODE_VER}-linux-${NODE_ARCH}.tar.xz"
sudo cp -r ${NODE_DIR}/bin/* /usr/local/bin/
sudo cp -r ${NODE_DIR}/lib/* /usr/local/lib/
rm -rf ${NODE_DIR} "node-${NODE_VER}-linux-${NODE_ARCH}.tar.xz"
hash -r
node --version
```

Setelah update, `preflight.mjs` tetap jalan — ia ditulis agar tidak
memakai sintaks yang butuh versi baru. Tapi pesan error
`SyntaxError: Unexpected token '?'` tidak akan muncul lagi.

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

`LAVALINK_HOST` dan `REDIS_URL` juga **ditimpa** di stack ini menjadi hostname
container (`lavalink`, `redis`) — bukan `localhost` yang tertulis di
`.env.example`. Itu benar untuk bot yang berjalan di dalam jaringan compose,
tapi **salah** kalau bot-nya jalan di host: jalur `npm run dev` di atas justru
butuh `localhost`.

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

## Supaya bot jalan sendiri dan tidak pernah mati

"Otomatis setelah reboot" dan "hidup lagi setelah crash" itu dua hal berbeda,
dan hanya sebagian yang benar-benar dijamin stack ini:

| Yang terjadi | Dijamin? | Yang mengerjakan |
|---|---|---|
| Bot hidup lagi setelah crash | Ya | `restart: unless-stopped` |
| Bot hidup lagi setelah NAS reboot | Ya, **asal daemon Docker ikut start** | Docker daemon + restart policy |
| Bot hidup lagi setelah kamu tekan Stop | **Tidak** | — (lihat jebakan `unless-stopped`) |
| Bot yang menggantung direstart | **Tidak** | tidak ada yang memeriksa |
| Ada yang memberi tahu kalau bot mati | **Tidak** | tidak ada alarm |

### Yang sudah diatur compose ini

`bot`, `lavalink`, dan `redis` memakai `restart: unless-stopped`. Service
`migrate` sengaja memakai `restart: "no"` — ia pekerjaan sekali jalan yang harus
selesai lalu berhenti, bukan proses yang perlu hidup terus.

Sisi bot-nya juga sudah disiapkan untuk **direstart**, bukan dibiarkan
menggantung: kegagalan startup keluar dengan status 1 (`process.exitCode = 1`
plus watchdog 5 detik supaya proses tidak menggantung selamanya),
`uncaughtException` keluar dengan status 1, dan SIGTERM menutup job, database,
serta mesin musik dengan rapi — dipaksa keluar paling lambat 10 detik supaya
restart tidak menunggu selamanya. Artinya setiap kegagalan berakhir sebagai
**exit non-zero**, dan itulah satu-satunya hal yang membuat restart policy bisa
bekerja. Docker memberi jeda yang makin panjang tiap percobaan, jadi
konfigurasi yang salah tidak membanjiri log.

### Reboot: bagian yang paling sering terlewat

Restart policy hanya bekerja kalau **daemon Docker-nya sendiri** ikut start saat
boot. Periksa, jangan diasumsikan:

```bash
systemctl is-enabled docker    # harus "enabled"
systemctl is-active docker     # harus "active"
```

Kalau `is-enabled` menjawab `disabled`, aktifkan (butuh root):

```bash
sudo systemctl enable --now docker
```

Tanpa itu container tetap berhenti setelah reboot dan tidak ada pesan apa pun —
gejalanya hanya "bot tidak merespons" keesokan harinya.

Ada satu jalur gagal yang kedua, dan khusus: kalau setelah reboot `lavalink` dan
`redis` hidup tetapi `bot` **tidak ada sama sekali** (bukan crash-loop),
periksa `migrate`:

```bash
docker compose ps -a        # lihat ExitCode kolom migrate
```

`bot` menunggu `migrate` selesai dengan `condition: service_completed_successfully`,
jadi kalau migrasi gagal — misalnya jaringan NAS belum siap saat boot sehingga
Supabase belum bisa dihubungi — `docker compose up` menghentikan `bot` di tengah
jalan, dan tidak ada restart policy yang menolong karena container-nya memang
belum pernah dibuat. Sekali `migrate` berhasil, semuanya kembali normal:

```bash
docker compose up -d
```

### Jebakan `unless-stopped`

`unless-stopped` berarti: **jangan** hidupkan lagi kalau container-nya dihentikan
dengan sengaja. Jadi sekali kamu menekan Stop di CasaOS (atau `docker compose
stop`), bot itu tetap mati setelah NAS dinyalakan ulang — dan tidak terlihat
seperti kesalahan, karena memang sesuai permintaan.

Kalau maunya "selalu kembali, apa pun yang terjadi sebelumnya", ganti ke
`always`:

```bash
cd /DATA/AppData/harmony-bot
sed -i 's/restart: unless-stopped/restart: always/' docker-compose.yml
docker compose up -d
```

Bedanya cuma satu: dengan `always`, container yang tadinya kamu hentikan sendiri
pun ikut menyala saat boot — itu memang yang diinginkan untuk bot yang harus
selalu ada, tapi menjengkelkan kalau kamu sedang sengaja mematikannya.

> Kalau app-nya dipasang lewat antarmuka CasaOS, CasaOS menyimpan salinan
> compose-nya sendiri. Mengubah berkas di disk tetap berlaku untuk Docker, tapi
> ubah juga dari antarmuka CasaOS supaya tampilan dan isinya tidak berbeda.

### Verifikasi, bukan asumsi

```bash
cd /DATA/AppData/harmony-bot
docker compose ps
docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} state={{.State.Status}}' \
  harmony-bot harmony-lavalink harmony-redis
curl -fsS http://localhost:8080/health    # liveness
curl -fsS http://localhost:8080/ready     # readiness: gateway + database + Lavalink
```

`migrate` memang **tidak** muncul sebagai Up: ia keluar dengan status 0, dan itu
keadaan yang benar.

### Yang tidak dijamin, dan tambalan kalau memang dibutuhkan

**Bot yang menggantung tidak akan direstart.** Docker tidak merestart container
berstatus `unhealthy`; health check hanya menandainya, dan di `docker compose
ps` keadaan itu terlihat sebagai `Up (unhealthy)`. Tambalan paling murah adalah
pengawas dari cron — CasaOS punya cron sendiri dan cron berjalan sebagai root,
jadi tidak butuh grup `docker`:

```bash
# crontab -e sebagai root, atau /etc/cron.d/harmony-watchdog
*/5 * * * * curl -fsS -m 10 http://127.0.0.1:8080/health >/dev/null 2>&1 || (cd /DATA/AppData/harmony-bot && docker compose restart bot) >> /var/log/harmony-watchdog.log 2>&1
```

Itu memeriksa tiap lima menit dan merestart `bot` saja; Lavalink dan Redis tidak
disentuh. Dua batasnya: saat bot baru start, `/health` bisa gagal sesaat
sehingga terjadi satu restart yang tidak perlu, dan kalau bot crash-loop
pengawas ini hanya menambah kebisingan — penyebabnya tetap harus diperbaiki.

**Tidak ada yang memberi tahu kamu.** Uptime ≥ 99% ada di PRD, tetapi stack ini
tidak membawa alarm. `/health`, `/ready`, dan `/metrics` tersedia untuk
di-scrape; pemasangan scraper-nya ada di luar lingkup folder ini.

**Crash-loop tetap crash-loop.** Kalau `docker compose ps` menunjukkan container
yang berulang kali restart, yang dibutuhkan log, bukan pengawas tambahan:

```bash
docker compose logs --tail=50 bot
```

### Kalau bot dijalankan tanpa Docker

Tidak ada `restart: unless-stopped` yang menjaga apa pun di sana; yang
mengerjakan itu **systemd**. Panduan lengkapnya ada di bagian
[Tanpa Docker: bot start sendiri dan tidak pernah mati](#tanpa-docker-bot-start-sendiri-dan-tidak-pernah-mati).

---

## Tanpa Docker: bot start sendiri dan tidak pernah mati

Bagian ini untuk yang menjalankan bot langsung di host — tidak ada container,
tidak ada `restart: always`, dan tidak ada service `migrate`. Yang menjaga bot
tetap hidup di sini adalah **systemd**.

Berkasnya sudah ada di repo ini, jadi tidak ada unit yang perlu diketik ulang:

| Berkas | Dipasang ke | Guna |
|---|---|---|
| [`systemd/harmony-lavalink.service`](systemd/harmony-lavalink.service) | `/etc/systemd/system/` | mesin audio, dijalankan lebih dulu |
| [`systemd/harmony.service`](systemd/harmony.service) | `/etc/systemd/system/` | bot |
| [`systemd/harmony-health.service`](systemd/harmony-health.service) + [`systemd/harmony-health.timer`](systemd/harmony-health.timer) | `/etc/systemd/system/` | pemeriksa `/health` tiap 5 menit |
| [`systemd/harmony-check.sh`](systemd/harmony-check.sh) | `/usr/local/bin/harmony-check` | skrip yang dipanggil timer itu |
| [`systemd/harmony-dashboard.service`](systemd/harmony-dashboard.service) | `/etc/systemd/system/` | dashboard web (opsional, lewat `--dashboard`) |
| [`install-systemd.sh`](install-systemd.sh) | — | pengganti nilainya, lalu pemasangnya |

Yang perlu sudah ada: repo ter-clone, Node LTS, Java 17+, `yt-dlp`, `.env` yang
terisi, dan skema database sudah diterapkan
([jalur tanpa Docker](#jalankan-lavalink-dan-npm-run-dev-tanpa-docker)), plus
akses root. Untuk `--dashboard`, `dashboard/` juga harus sudah di-build
(`cd dashboard && npm ci && npm run build`).

```bash
systemctl --version | head -1     # kalau ini menjawab, systemd tersedia
```

> `npm run dev:all -- --detach` **bukan** jawaban untuk ini. Ia melepas proses
> dari terminal, jadi bot tetap hidup setelah sesi SSH ditutup — tapi NAS reboot
> tetap mematikannya, dan tidak ada yang menyalakannya kembali.

### Satu perintah, dan nilainya diedit sekali

Pemasangnya mendeteksi sendiri user, folder repo, biner Node/npm, direktori JRE,
dan `HEALTH_PORT` dari `.env`. Kalau deteksinya salah, timpa lewat environment —
**satu tempat saja**, tidak ada berkas konfigurasi kedua yang harus dijaga
sinkron:

```bash
cd /DATA/AppData/harmony-dev
npm ci
npm run build

# Lihat dulu hasilnya: nilai yang dipakai dan unit yang dirender, tanpa menyentuh /etc.
bash deploy/casaos/install-systemd.sh --dry-run

# Pasang (butuh root). Memasang, mengaktifkan, dan menyalakannya sekaligus.
HARMONY_USER=flow JAVA_BIN_DIR=/home/flow/jdk/jdk-21.0.5+11-jre/bin \
  bash deploy/casaos/install-systemd.sh
```

| Opsi | Guna |
|---|---|
| `--dry-run` | cetak hasil render; tidak menulis ke `/etc`, tidak memanggil `systemctl` |
| `--verify` | bunuh paksa bot yang sedang hidup, lalu buktikan systemd menghidupkannya lagi (keluar 0 kalau terbukti, 1 kalau tidak) |
| `--no-health-timer` | lewati timer pemeriksa `/health` |
| `--dashboard` | pasang juga `harmony-dashboard.service` (dashboard web; port dari `DASHBOARD_PORT` di `.env`) |
| `--uninstall` | hentikan, nonaktifkan, dan hapus unitnya (`.env` dan repo tidak disentuh) |

Kalau `dist/index.js` belum ada atau Node-nya di bawah 22, pemasangnya memberi
peringatan. Kalau `.env` tidak ada, ia **menolak**: `EnvironmentFile=` yang
menunjuk berkas tidak ada membuat systemd menolak start unit-nya, dan pesannya
baru muncul jauh kemudian di `journalctl`.

### Dua setelan yang menentukan "tidak pernah mati"

Keduanya ada di berkas unit, dan sengaja tidak dipendekkan:

- **`StartLimitIntervalSec=0`.** Bawaan systemd adalah 5 percobaan dalam 10 detik,
  lalu unit berstatus `failed` dan **berhenti mencoba** — kebalikan dari yang
  diinginkan, dan ini penyebab paling sering dari "systemd-nya tidak menolong".
- **`Restart=always` + `RestartSec=5`.** Proses yang keluar dengan cara apa pun
  dihidupkan lagi, dengan jeda 5 detik supaya crash-loop tidak membanjiri log.

Kenapa dua unit terpisah, bukan satu: Lavalink harus hidup sebelum bot
menyambung, dan satu JVM yang start-nya lambat (terukur ~20 detik di laptop
pengembangan repo ini) akan membuat systemd menganggap seluruh layanan gagal
lalu merestart bot berulang-ulang.

### Buktikan, jangan diasumsikan

Klaim "tidak pernah mati" adalah klaim yang bisa diuji, jadi jangan dipercaya
begitu saja. Setelah pasang, jalankan pengujiannya — sekali, di mesin ini:

```bash
sudo bash deploy/casaos/install-systemd.sh --verify
```

Yang dilakukannya, berurutan: menolak kalau `harmony` belum `active`; mencatat
`MainPID` dan `NRestarts`; mengirim `SIGKILL` ke pid itu (tanpa penutupan rapi,
jadi seperti crash sungguhan); menunggu pemulihannya sampai `VERIFY_TIMEOUT`
detik (bawaan 90; jeda sebenarnya ditentukan `RestartSec` di berkas unit); lalu
memeriksa empat hal
satu per satu — **pid baru yang berbeda**, **`NRestarts` naik**, **`/health`
menjawab** di `HEALTH_PORT`, dan **`harmony-lavalink` masih `active`** (jadi yang
dibunuh memang hanya bot). Hasilnya dicetak sebagai `LULUS`/`GAGAL`/`PERINGATAN`/
`LEWAT` per pemeriksaan, dan skripnya keluar 0 hanya kalau terbukti.

Kalau hasilnya `GAGAL`, baca `journalctl -u harmony -n 50 --no-pager`. Yang dicek
pertama: `StartLimitIntervalSec=0` memang ada di berkas unit (kalau tidak,
systemd berhenti mencoba setelah beberapa kegagalan), dan `RestartSec` tidak
lebih besar dari `VERIFY_TIMEOUT`.

Yang penting dipahami: asersi kedua (`NRestarts` naik) sengaja ada supaya hasil
`LULUS` benar-benar berarti. Pid yang berubah saja bisa berasal dari hal lain;
yang membedakan adalah systemd sendiri yang melaporkan jumlah restart-nya
bertambah.

Kalau mau memeriksanya dengan tangan, inilah yang setara — dan masih berguna
untuk melihat sendiri apa yang terjadi:

```bash
kill -9 "$(systemctl show -p MainPID --value harmony)"   # mati paksa, tanpa penutupan rapi
sleep 8
systemctl is-active harmony      # harus "active" lagi, tanpa menyentuh apa pun
systemctl show -p NRestarts --value harmony
systemctl list-timers harmony-health.timer --no-pager
```

Yang dicari di log: `Registering YTDLP audio source manager...` pada unit
Lavalink, lalu `Node Lavalink terhubung` dan `✅ Harmony siap menerima perintah`
pada unit bot.

Satu keuntungan systemd dibanding Docker: `enable` berarti **selalu** start saat
boot, ia tidak mengingat bahwa kamu pernah `systemctl stop`. Jadi perilaku
bawaannya sudah seperti `restart: always`, bukan `unless-stopped`. Satu-satunya
yang menghentikannya adalah `systemctl stop` (dan `systemctl disable` kalau kamu
tidak ingin ia kembali saat boot).

### Dashboard di host yang sama (opsional)

Dashboard boleh hidup di mesin yang sama dengan bot, tanpa Docker. Unit-nya
dipasang dengan flag `--dashboard` — instalasi bot-only tidak berubah:

```bash
# Build dulu (sekali). Dashboard mengimpor modul bot lewat alias
# `@bot/*`, jadi ia butuh checkout repo utuh — bukan salinan:
npm ci                                  # akar repo: deps + client Prisma
(cd dashboard && npm ci && npm run build)

bash deploy/casaos/install-systemd.sh --dry-run --dashboard   # lihat dulu
sudo bash deploy/casaos/install-systemd.sh --dashboard
```

Yang berbeda dari unit bot:

- **Port dari `DASHBOARD_PORT`** di `.env` (bawaan 3000), dirender ke
  `ExecStart` — satu variabel yang mengatur port di mana pun dashboard
  dijalankan, persis seperti di Docker.
- **`EnvironmentFile` ke `.env` yang sama** dengan bot, dan
  `NODE_ENV=production` dipatok *setelahnya* (directive terakhir yang
  menang), supaya `DASHBOARD_DEV_FAKE_SESSION` tidak mungkin aktif
  di produksi walau variabel itu tertinggal di `.env`.
- **`MemoryMax=256M`** — sama dengan `mem_limit` service `dashboard`
  di `docker-compose.yml`.
- **Hardening dasar**: `NoNewPrivileges`, `PrivateTmp`,
  `ProtectSystem=strict` (seluruh sistem berkas hanya-baca, kecuali
  `dashboard/` tempat Next.js menulis cache), `CapabilityBoundingSet=`
  kosong, `RestrictAddressFamilies`, dan `ProtectKernel*`.

Dua perbedaan dari compose yang perlu diketahui:

- **`next start` mendengarkan di semua antarmuka** — compose
  mem-publish port hanya ke `127.0.0.1`. Kalau dashboard hanya untuk
  peramban di mesin ini, tambahkan `-H 127.0.0.1` ke `ExecStart=` di
  `/etc/systemd/system/harmony-dashboard.service`, lalu
  `systemctl daemon-reload && systemctl restart harmony-dashboard`.
- **Tidak ada timer pemeriksa `/api/health`.** Endpoint itu menjawab
  503 saat database mati, dan me-restart dashboard tidak membetulkan
  database — Prisma menyambung lagi sendiri begitu database pulih.
  `Restart=always` sudah menangani proses yang keluar; timer ala bot
  justru membuat dashboard restart-loop tiap 5 menit sepanjang
  outage database.

Setelah itu: `systemctl status harmony-dashboard`, dan log di
`journalctl -u harmony-dashboard -f`.

### Bot yang menggantung: satu hal yang tidak ditangani systemd

`Restart=always` hanya menangani proses yang **keluar**. Bot yang masih hidup
tetapi tidak membalas apa pun (mis. socket Discord macet) tidak akan pernah
direstart, karena systemd tidak tahu apa-apa soal HTTP di dalamnya.

Itu pekerjaan `harmony-health.timer`: `harmony-check.sh` memanggil
`http://127.0.0.1:<HEALTH_PORT>/health` tiap lima menit dan baru merestart bot
setelah **dua** pemeriksaan berturut-turut gagal, supaya bot yang sedang start
tidak dibunuh oleh pemeriksaan yang kebetulan lewat. Interval dan aturan dua
kegagalan itu tinggal di berkasnya, bukan diketik ulang di sini.

### Batas yang jujur

- **Belum pernah dijalankan di systemd sungguhan.** Tidak ada NAS dan tidak ada
  systemd di lingkungan pengembangan repo ini. Yang benar-benar diuji: pemasangnya
  (`bash -n`; `--dry-run` merender berkas unit tanpa satu pun placeholder
  tersisa — termasuk `harmony-dashboard.service` dengan `--dashboard`;
  menolak dijalankan tanpa root; menolak kalau `.env` tidak ada). Mode
  `--verify` diuji dengan `systemctl` tiruan (harness stub): kasus pulih,
  tidak-pulih, dan pid-berubah-tapi-`NRestarts`-tetap — ketiganya memberi hasil
  dan kode keluar yang benar. Isi unit-nya sendiri baru diperiksa dengan membaca.
  Dry-run itu juga dijalankan di Git Bash (Windows), jadi nilai PATH-nya terlihat
  seperti `C:\...` — di NAS nilainya POSIX biasa.
- **`--verify` membuktikan prosesnya kembali, bukan botnya sudah melayani lagi.**
  Yang diperiksa `/health`; perintah Discord betulan tidak diuji. Ia juga tidak
  membuktikan pemulihan setelah NAS reboot — itu butuh reboot sungguhan
  (`systemctl is-enabled harmony` untuk bagian `enable`-nya).
- **`After=network-online.target` hanya berarti kalau ada yang menunggu
  jaringan.** Kalau bot start sebelum Supabase terjangkau, unit bot gagal dan
  `StartLimitIntervalSec=0` membuatnya mencoba lagi tiap 5 detik sampai berhasil
  — itu memang yang diinginkan, tapi log-nya ramai selama itu.
- **Tidak ada padanan service `migrate`.** Setelah `git pull` yang membawa
  migrasi baru: `npm run db:deploy` lalu `systemctl restart harmony`. Di versi
  Docker itu otomatis lewat `depends_on`.
- **Update Node LTS atau JRE ikut memutus unit.** Service memakai PATH dan biner
  yang dipatok di berkas unit, jadi setelah upgrade jalankan ulang
  `install-systemd.sh` (nilainya dideteksi ulang), lalu
  `systemctl daemon-reload` dan `systemctl restart harmony-lavalink harmony`
  (tambah `harmony-dashboard` kalau unit dashboard terpasang).
- **Bot lama bisa berjalan bersama bot baru.** Kalau app CasaOS (versi Docker)
  masih hidup dengan token yang sama, kamu punya dua bot yang menyambung ke
  gateway yang sama dan saling menimpa state player. Hentikan salah satunya:
  `cd /DATA/AppData/harmony-bot && docker compose down`.
---

## Jalankan Lavalink dan `npm run dev` bersamaan

Alur di atas menjalankan **bot di dalam container**. Kalau yang diinginkan justru
sebaliknya — bot jalan di host dengan `npm run dev` (hot reload) sementara mesin
audio tetap di container — begini caranya:

```
NAS (host)                                Docker (project compose `harmony`)
  npm run dev ─────────────► 127.0.0.1:2333 ─► container lavalink
  .env: LAVALINK_HOST=localhost ─► 127.0.0.1:6379 ─► container redis
```

> **Hentikan dulu app CasaOS-nya.** Compose root dan compose di folder ini
> sama-sama memakai `name: harmony` dengan `container_name` yang identik
> (`harmony-bot`, `harmony-lavalink`, `harmony-redis`), jadi keduanya adalah
> **project compose yang sama**. Selama app CasaOS hidup, `up` untuk jalur dev
> gagal dengan `Conflict. The container name "/harmony-lavalink" is already in
> use`, dan port 8080 sudah dipegang container bot.
>
> ```bash
> cd /DATA/AppData/harmony-bot
> docker compose down          # atau tombol Stop di antarmuka CasaOS
> ```
>
> Ini sekaligus menutup masalah yang lebih halus: dua bot dengan token yang sama
> menyambung ke gateway Discord dua kali, jadi state player dan antreannya
> saling menimpa.

**1. Salinan repo di folder terpisah**

Jangan meng-`git clone` ke `/DATA/AppData/harmony-bot`: folder itu sudah berisi
`docker-compose.yml` versi CasaOS dan `.env` milik app, dan `git clone` menolak
folder yang tidak kosong. Folder terpisah juga membuat app CasaOS tetap utuh,
jadi bisa dinyalakan kembali kapan saja tanpa memasang ulang.

```bash
cd /DATA/AppData
git clone https://github.com/29nls/musicbot.git harmony-dev
cd harmony-dev
npm install          # sekaligus `prisma generate` lewat postinstall
cp .env.example .env
```

`npm install` butuh Node LTS. Kalau NAS masih membawa Node 12.x, kerjakan dulu
[Update Node.js ke LTS](#update-nodejs-ke-lts).

**2. `LAVALINK_HOST` harus `localhost`**

Tiga baris ini yang membedakan `.env` di sini dari `.env` milik app CasaOS:

```env
LAVALINK_HOST=localhost              # BUKAN `lavalink` (itu hostname container)
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

`LAVALINK_PASSWORD` **tidak** perlu disamakan dengan punya app CasaOS — kedua
stack tidak pernah hidup bersamaan. `NODE_ENV=development` juga bukan hiasan:
kalau `NODE_ENV=production` diekspor di environment shell SSH-mu,
`src/config/env.ts` **melewati pembacaan `.env`** sepenuhnya dan nilainya hanya
diambil dari environment proses.

**3. Jalankan hanya infrastrukturnya**

```bash
cd /DATA/AppData/harmony-dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d lavalink redis
npm run db:deploy                    # terapkan skema ke Supabase
```

Dua nama service di akhir perintah itu yang penting. `npm run infra:up` adalah
perintah yang sama **tanpa** nama service, dan itu ikut menyalakan `migrate` dan
`bot` — bot itulah yang lalu berebut token, port 8080, dan koneksi gateway
dengan `npm run dev`. `lavalink` dan `redis` tidak punya `depends_on`, jadi
`migrate` tidak ikut tertarik.

Overlay `docker-compose.dev.yml` membuka port hanya ke `127.0.0.1`, bukan ke
LAN. Itu memang tujuannya: mesin audio tidak boleh bisa dihubungi dari luar NAS.
Untuk menghentikannya lagi:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

**4. `npm run dev` di sesi SSH kedua**

`npm run dev` berjalan di foreground dan terus menonton berkas, jadi butuh
sesi/tab SSH tersendiri:

```bash
cd /DATA/AppData/harmony-dev
npm run dev
```

Baris pertama log bot membawa dua field di samping pesan `Menghubungkan ke
Discord…`: `node` (versi Node yang benar-benar dipakai) dan `lavalink` (alamat
Lavalink). Di jalur dev log-nya lewat `pino-pretty`, jadi keduanya tercetak
sebagai baris terpisah; yang perlu kamu lihat:

```
lavalink: localhost:2333
```

Kalau yang tercetak `lavalink: lavalink:2333`, `.env`-nya masih berisi hostname
container (langkah 2 belum dikerjakan).

Menutup sesi SSH ikut mematikan `npm run dev`. Supaya tetap hidup pakai `tmux`
(`apt-get install tmux` lalu `tmux new -s harmony`), `screen`, atau:

```bash
nohup npm run dev > dev.log 2>&1 &
tail -f dev.log
# menghentikannya: pkill -f 'tsx watch'
```

`nohup ... &` tetap mati kalau NAS reboot. Untuk pemakaian sehari-hari, app
CasaOS (bot di container) yang seharusnya menyala; jalur ini untuk saat
mengembangkan.

### Batas jalur ini

- **Lavalink-nya kehilangan yt-dlp.** `docker-compose.yml` root memakai image
  resmi `ghcr.io/lavalink-devs/lavalink:4-alpine`, yang **tidak** memuat
  `yt-dlp`; yang memuatnya adalah `deploy/casaos/lavalink.Dockerfile`. Tanpa
  biner itu `ytsearch:` kembali dilayani youtube-plugin — jalur yang ditolak
  YouTube untuk lagu musik (lihat "Musik tidak bisa dimuat" di README root).
  Kalau butuh yt-dlp sambil mengembangkan, bangun image CasaOS-nya dan suruh
  overlay dev memakainya:

  ```bash
  cat > docker-compose.dev.ytdlp.yml <<'EOF'
  services:
    lavalink:
      build:
        context: .
        dockerfile: deploy/casaos/lavalink.Dockerfile
      image: harmony-lavalink:local
  EOF

  docker compose -f docker-compose.yml -f docker-compose.dev.yml \
    -f docker-compose.dev.ytdlp.yml up -d --build lavalink
  ```

  Berkas override itu paling baik diletakkan di dalam folder repo, karena
  `context: .` di dalamnya dihitung relatif terhadap berkasnya sendiri. Ia
  muncul sebagai berkas tak terlacak di `git status`, dan itu wajar. Kalau
  tidak ingin membangun image sama sekali, jalur [tanpa Docker](#jalankan-lavalink-dan-npm-run-dev-tanpa-docker)
  di bawah memasang `yt-dlp` di host — lebih sedikit langkah untuk hasil yang sama.
- **`npm run dev` lebih boros RAM** daripada bot versi container: `tsx watch`
  menambah proses transpiler (~340 MB terukur, vs ~165 MB untuk
  `node dist/index.js`). Di NAS dengan RAM kecil, pertimbangkan menutup Redis
  dari jalur ini — Redis opsional, dan tanpa `localhost:6379` bot tetap jalan
  dengan store memori.
- **Bukan cara memasang bot.** Jalur ini tidak muncul di App Store CasaOS dan
  tidak punya health check; `/health` hanya hidup selama `npm run dev` berjalan.

---

## Jalankan Lavalink dan `npm run dev` tanpa Docker

Versi lain dari jalur di atas: **tidak ada container sama sekali**. Lavalink
jalan sebagai proses JVM dari `lavalink/Lavalink.jar` dan bot lewat
`npm run dev`; keduanya di host NAS.

```
Sesi SSH 1   npm run infra:lavalink ─► java -jar Lavalink.jar ─► 127.0.0.1:2333
Sesi SSH 2   npm run dev ─► bot Discord        .env: LAVALINK_HOST=localhost
```

Pilih jalur ini kalau Docker di NAS bermasalah (mis. `docker.sock` permission
denied dari bagian di atas) atau RAM/disk-nya mepet: tidak ada daemon,
image, maupun jaringan container yang ikut jalan. Yang dibutuhkan hanya Node
LTS, Java 17+, dan biner `yt-dlp`.

Kalau sudah punya salinan repo dari bagian sebelumnya (`/DATA/AppData/harmony-dev`),
lewati langkah 1 dan 4 — salinan dan `.env`-nya dipakai apa adanya. Satu hal yang
tetap perlu ditambahkan ke `.env` itu: `YTDLP_PATH` dari langkah 3, kalau
`~/.local/bin` tidak ada di PATH.

**1. Node LTS — di jalur ini wajib, bukan saran**

`npm run dev` menjalankan `tsx watch`, dan `package.json` menetapkan
`engines.node: ">=22"`. Kalau NAS masih membawa Node 12.x, kerjakan dulu
[Update Node.js ke LTS](#update-nodejs-ke-lts).

**2. Java 17+**

Lavalink 4 adalah aplikasi Java. Paling mudah kalau ada akses root:

```bash
sudo apt-get update && sudo apt-get install -y openjdk-21-jre-headless
java -version          # harus 17 atau lebih baru
```

Tanpa root (NAS CasaOS sering begitu), ambil JRE dari Adoptium ke `$HOME`:

```bash
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64) JAVA_ARCH=aarch64 ;;   # Amlogic
  x86_64|amd64)  JAVA_ARCH=x64 ;;
  *) echo "arsitektur tidak dikenal: $ARCH"; exit 1 ;;
esac

mkdir -p "$HOME/jdk" && cd "$HOME/jdk"
curl -fsSL -o jre.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/linux/$JAVA_ARCH/jre/hotspot/normal/eclipse"
tar -xzf jre.tar.gz && rm jre.tar.gz

export JAVA_HOME="$(ls -d "$HOME"/jdk/jdk-*-jre | head -1)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

Yang penting bukan JRE-nya terpasang di mana, tapi `java` bisa ditemukan di
**PATH shell yang menjalankan `npm run infra:lavalink`** — skrip itu memanggil
`java` dari PATH, dan kalau tidak ketemu ia gagal dengan pesan soal Temurin.
Export di atas hanya berlaku untuk shell itu, jadi catat juga ke `~/.profile`
supaya sesi SSH berikutnya ikut membawanya:

```bash
grep -q 'JAVA_HOME' "$HOME/.profile" || cat >> "$HOME/.profile" <<EOF
export JAVA_HOME="$JAVA_HOME"
export PATH="\$JAVA_HOME/bin:\$PATH"
EOF
```

**3. yt-dlp**

YouTube menolak hampir semua klien plugin untuk lagu musik, dan yang lolos adalah
jalur `yt-dlp` (lihat "Musik tidak bisa dimuat" di README root). Tanpa biner ini,
`ytsearch:` kembali dilayani youtube-plugin dan gagal dengan "This video requires
login".

```bash
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;;
  x86_64|amd64)  YTDLP_ASSET=yt-dlp_linux ;;
esac

mkdir -p "$HOME/.local/bin"
curl -fsSL -o "$HOME/.local/bin/yt-dlp" \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YTDLP_ASSET"
chmod +x "$HOME/.local/bin/yt-dlp"
"$HOME/.local/bin/yt-dlp" --version
```

Biner ini bisa memperbarui dirinya sendiri, dan itu akan sering dibutuhkan:
YouTube berubah, dan yt-dlp-lah yang menyesuaikan.

```bash
"$HOME/.local/bin/yt-dlp" -U
```

**4. Repo dan `.env`**

```bash
cd /DATA/AppData
git clone https://github.com/29nls/musicbot.git harmony-dev
cd harmony-dev
npm install
cp .env.example .env
```

Isi minimal sama seperti biasa (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
`DATABASE_URL`, `LAVALINK_PASSWORD`). Yang khas jalur ini:

```env
LAVALINK_HOST=localhost      # bot dan Lavalink sama-sama di host
LAVALINK_PASSWORD=hasil-acak-panjang
YTDLP_PATH=/home/USER/.local/bin/yt-dlp
```

`YTDLP_PATH` boleh dibiarkan kosong kalau `~/.local/bin` sudah ada di PATH.
Kalau diisi, tulis **jalur absolut** — `$HOME` tidak mengembang di dalam `.env`.
Nilai ini diteruskan `tools/start-lavalink.mjs` ke JVM, yang membacanya dari
environment proses, bukan dari `.env` secara langsung.

Skema database tetap di Supabase, jadi tidak ada Postgres lokal yang perlu hidup:

```bash
npm run db:deploy
```

**5. Sesi SSH pertama — Lavalink**

```bash
cd /DATA/AppData/harmony-dev
npm run infra:lavalink -- --download     # ~96 MB, sekali saja
```

Setelah unduhan selesai, log-nya memuat `Lavalink 4.2.2 | heap -Xmx512m |
konfigurasi lavalink/application.yml`, lalu — yang paling menentukan — baris
`Registering YTDLP audio source manager...`. Kalau baris itu tidak muncul,
`yt-dlp` belum dikenali dan perubahan di langkah 3 belum berlaku.

Heap bisa diturunkan untuk NAS ber-RAM kecil:

```bash
LAVALINK_HEAP=256m npm run infra:lavalink
```

`Lavalink.jar`, `lavalink/plugins/`, dan `lavalink/logs/` semuanya ada di
`.gitignore`, jadi `git status` tetap bersih.

**6. Sesi SSH kedua — bot**

```bash
cd /DATA/AppData/harmony-dev
npm run dev
```

Cari `lavalink: localhost:2333` di baris pertama, lalu `Node Lavalink terhubung`,
lalu `✅ Harmony siap menerima perintah`. Kalau `lavalink:` di situ menunjuk
hostname lain, `.env`-nya belum benar.

Menutup sesi SSH mematikan prosesnya. Untuk menjalankan dua-duanya dari satu
sesi: `tmux` (dua pane), `screen`, atau `nohup npm run dev > dev.log 2>&1 &`
setelah Lavalink start di latar belakang dengan cara yang sama.

### Batas jalur tanpa Docker

- **Lavalink mendengarkan di semua antarmuka.** `lavalink/application.yml`
  menulis `address: 0.0.0.0`, dan di jalur container itu tidak masalah karena
  compose tidak membuka port 2333 ke host. Tanpa Docker, mesin audio bisa
  dijangkau dari LAN dan hanya dilindungi `LAVALINK_PASSWORD`. Periksa dengan
  `ss -ltnp | grep 2333` (atau `netstat -ltnp`). Lavalink adalah aplikasi Spring
  Boot, jadi `SERVER_ADDRESS=127.0.0.1 npm run infra:lavalink` seharusnya
  menimpanya — environment menang atas berkas config — tapi **belum diuji di
  NAS**, jadi buktikan dengan perintah `ss` di atas, bukan dengan asumsi.
- **Tidak ada yang menyalakan ulang otomatis.** Proses ini mati kalau NAS reboot
  atau sesi SSH-nya putus; tidak ada `restart: unless-stopped` seperti container.
  Untuk pemakaian sehari-hari yang harus hidup terus, app CasaOS di atas tetap
  pilihan yang benar — atau, kalau jalur ini memang harus dipakai sehari-hari,
  unit systemd di [Supaya bot jalan sendiri dan tidak pernah mati](#supaya-bot-jalan-sendiri-dan-tidak-pernah-mati).
- **Java dan Node jadi tanggunganmu.** Update keamanan JRE dan versi Node LTS
  berikutnya harus dipasang manual — di jalur container, itu urusan image.

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