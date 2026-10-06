# Dashboard Harmony

Halaman web untuk melihat dan mengubah konfigurasi per-server (`guild_config`)
dari peramban, dengan paritas persis dengan perintah `/config`.

Rancangan, keputusan arsitektur, dan batas yang diketahui ada di
[PRD-DASHBOARD.md](../PRD-DASHBOARD.md). Berkas ini hanya cara menjalankan dan
hal-hal yang perlu diketahui saat mengutak-atiknya.

## Yang bisa dan tidak bisa dilakukan

**Bisa:** membaca dan mengubah 12 field konfigurasi umum dan 5 tombol modul
persis seperti `/config set`.

**Tidak bisa, dan itu disengaja:**

- `modules.reactions` dan `modules.tickets` tidak ada di sini. `/config set`
  memang tidak punya tombolnya — keduanya hanya bisa dinyalakan lewat `/setup`
  dan dimatikan lewat `/reactionrole` dan `/ticket`, supaya tidak ada jalan yang
  bisa meninggalkan panel setengah jadi. Dashboard mengikuti `/config`, bukan
  `/setup`.
- Empat field panel tiket tidak bisa diubah dari sini. Semuanya diatur perintah
  `/ticket`; `ticketPanelMessageId` bahkan bukan keputusan manusia, itu hasil
  kirim panel.
- Sebelas tabel selain `guild_config` tidak disentuh. Alasannya ada di
  [PRD-DASHBOARD.md §2.5](../PRD-DASHBOARD.md).

## Menjalankan di luar Docker

```bash
cd dashboard
npm ci
cp .env.example .env      # isi DISCORD_TOKEN, OAUTH_CLIENT_SECRET, DASHBOARD_SECRET, URL data
npm run dev               # http://localhost:3000
```

`npm run dev` memakai `.env` di folder `dashboard/`. Kalau prosesnya tidak
melewati variabel itu, isinya akan ditolak dengan pesan yang menyebut variabel
mana yang bermasalah — bukan "env tidak valid".

Bot **tidak** perlu berjalan untuk dashboard membaca. Ia perlu hidup untuk
dashboard bisa memverifikasi Manage Server, karena itu yang menentukan boleh
tidaknya seseorang menulis.

Untuk produksi di host tanpa Docker, jangan pakai `npm run dev`: pasang unit
systemd-nya lewat `bash deploy/casaos/install-systemd.sh --dashboard`, yang
menjalankan `next start` dengan `EnvironmentFile` ke `.env` di **akar repo** —
bukan `.env` di folder ini — supaya bot dan dashboard membaca satu berkas yang
sama. Keterangan lengkap ada di bagian
[Tanpa Docker](../deploy/casaos/README.md#tanpa-docker-bot-start-sendiri-dan-tidak-pernah-mati)
di `deploy/casaos/README.md`.

### Melihat UI tanpa akun Discord

```bash
DASHBOARD_DEV_FAKE_SESSION=true DEV_GUILD_ID=<id server milikmu> npm run dev
```

Sesi uji diganti dengan login Discord. `DEV_GUILD_ID` tetap dibaca dari database
sungguhan, jadi yang tampil adalah data asli — bukan fixture. Opsi ini ditolak
keras di `NODE_ENV=production`.

## Menjalankan dengan Docker

Dashboard punya image sendiri ([Dockerfile](Dockerfile)) — build
multi-stage dengan konteks **akar repo**, bukan `dashboard/`, karena
dashboard mengimpor modul bot lewat alias `@bot/*` dan memakai client
Prisma hasil generate milik bot. Menyalin modul ke dalam image adalah
cara paling pasti membuat paritas `/config` basi tanpa ada tes yang
gagal. Tahap `runtime` hanya membawa `node_modules` produksi dan
berjalan sebagai user `node` (non-root).

```bash
docker compose up -d dashboard     # dari akar repo, butuh .env terisi
```

Port hanya di-bind ke `127.0.0.1:3000` (keputusan D7): peramban di
mesin lain tidak perlu mengakses dashboard langsung dari host. Layanan
menunggu migrasi selesai dan Redis sehat sebelum start, dan **tidak
pernah** menjalankan migrasi sendiri — itu milik service `migrate`.

Untuk CasaOS/ZimaOS, `deploy/casaos/docker-compose.yml` memuat layanan
yang sama dengan build langsung dari GitHub. Variabel dashboard yang
harus ada di `.env` (selain milik bot): `OAUTH_CLIENT_SECRET`,
`DASHBOARD_SECRET`, `DASHBOARD_URL` — keterangan tiap variabel ada di
`dashboard/.env.example`.

## Health check dan metrik

`GET /api/health` (dan `HEAD`) menjawab tanpa autentikasi:

```json
{
  "status": "ok",
  "database": "ok",
  "sharedStore": "ok",
  "readWrite": true,
  "metrics": { "writesTotal": 12, "writeDeniedTotal": 0 },
  "checkedInMs": 3
}
```

`status` 200 selama database terjangkau. `sharedStore` melaporkan Redis
secara terpisah: dashboard tetap bisa membaca saat Redis mati, tapi
menolak menulis (D3), jadi dua status itu harus bisa dibedakan.
`readWrite` adalah konjungsi keduanya.

`metrics` adalah dua penghitung §4.5, disimpan di Redis tanpa TTL agar
bertahan melewati restart dan dijumlahkan lintas instance. Pencacahan
terbaik-usaha: kegagalan mencatat tidak pernah menolak permintaan, dan
kegagalan membaca menjawab nol (dengan peringatan di log). Penolakan
dihitung apa pun alasannya — izin, rate limit, nilai tidak valid, origin
salah, infrastruktur — jadi di operasi normal angkanya nol, dan angka
yang bukan nol berarti ada yang salah.

## Kredensial OAuth

Satu aplikasi di Discord Developer Portal. Yang perlu diisi:

| Kolom | Nilai |
| --- | --- |
| Application id | `DISCORD_CLIENT_ID` |
| Client secret | `OAUTH_CLIENT_SECRET` |
| Redirect | `<DASHBOARD_URL>/api/auth/callback` |

Redirect harus cocok **persis** dengan yang di environment. Salah satu huruf
berbeda akan menghasilkan `redirect_uri_mismatch` dari Discord, dan tidak ada
pesan dari dashboard yang menyebut itu secara berguna.

Scope `identify guilds`. Tidak ada scope lain yang diminta — bot ini tidak butuh
email, dan meminta yang tidak dipakai berarti memberi data pribadi ke pihak ketiga
tanpa alasan (§12).

## Yang dijamin, dan yang tidak

**Dijamin:**

- Izin **Manage Server dicek ulang pada setiap penulisan**, bukan sekali saat
  login. Izin bisa dicabut di tengah sesi yang berumur tujuh hari.
- `guild_config` dan `log_entry` ditulis dalam satu transaksi. Tidak ada keadaan
  setengah tertulis, dan perubahan yang tercatat di `/logs` selalu benar-benar
  ada di database.
- Kalau Redis tidak hidup, dashboard **menolak menulis** dan tetap bisa membaca.
  Perubahan tanpa memvalidasi cache bot menghasilkan dashboard yang terlihat
  benar sementara bot masih memakai nilai lama — itu kesalahan yang paling
  merusak kepercayaan dan paling sulit dideteksi.
- Tidak ada satu pun nilai rahasia berawalan `NEXT_PUBLIC_`.

**Tidak dijamin:**

- **Alur OAuth belum pernah diuji dengan akun Discord sungguhan.** Yang sudah
  dibuktikan: seluruh kode jalannya ada tes, build hijau, dan callback memverifikasi
  `state` sebelum menukar kode. Yang belum: Discord menerima redirect URI-nya,
  dan scope-nya cukup. Ini yang paling harus dicoba pertama kali, dengan akun
  yang tidak penting.
- **Tidak ada uji end-to-end.** Jalur yang paling mungkin rusak adalah yang paling
  jarang dijalankan: redirect, cookie SameSite lewat proksi, dan penolakan Origin
  saat nama host berbeda dari `DASHBOARD_URL`.
- **Kuota Discord.** Setiap penulisan yang menyebut channel atau role memanggil
  `GET /guilds/{id}/channels` dan `/roles`. Rate limit 30/menit per pengguna per
  server ada di sini juga, tapi kuota global Discord tidak diukur.

## Kalau penulisan ditolak

Semua penolakan menulis satu baris JSON ke stdout, jadi tidak ada yang perlu
ditebak:

```
{"time":"...","level":"error","service":"dashboard","event":"config.write.rejected","guildId":"...","userId":"...","reason":"shared-store-down"}
```

`reason` memberi tahu penyebabnya:

| `reason` | Status | Arti |
| --- | --- | --- |
| `bad-origin` | 403 | Permintaan datang dari asal lain. Lihat di bawah. |
| `no-session` | 401 | Cookie sesi hilang atau kedaluwarsa (umur 7 hari). |
| `forbidden` | 403 | Manage Server sudah dicabut sejak login. |
| `permission-unknown` | 503 | Discord tidak menjawab, jadi izin tidak bisa dipastikan. |
| `rate-limited` | 429 | Lebih dari 30 penulisan per menit. Ada header `retry-after`. |
| `invalid-field` | 400 | Body menyebut field yang tidak boleh diubah manusia. |
| `invalid-value` | 422 | Nilai ditolak `validatePatch` milik bot. `issues` menyebut fieldnya. |
| `foreign-id` | 409 | Channel atau role bukan milik server itu. |
| `shared-store-down` | 503 | Redis mati. Dashboard sengaja menolak menulis (D3). |
| `database-down` | 503 | PostgreSQL tidak terjangkau. |

`level` membedakan masalah infrastruktur (`error`, dua baris terakhir) dari
permintaan yang memang tidak layak dilayani (`warn`). Operator tidak perlu
membaca isi request untuk tahu mana yang harus diperbaiki.

### Kalau semuanya `bad-origin`

Pemeriksaan Origin membandingkan `Origin`, header `Host`, dan asal dari
`request.url` dengan `DASHBOARD_URL`. Di belakang reverse proxy, Next menyusun
URL dari host internal, jadi `127.0.0.1:3000` bisa menjadi `localhost:3000` —
itulah sebabnya `Host` ikut dibandingkan. Kalau dashboard diakses lewat nama
host yang tidak tercatat di mana pun, setiap PATCH ditolak 403. Itu memang
perilaku yang diinginkan; yang perlu diperbaiki adalah `DASHBOARD_URL`.
