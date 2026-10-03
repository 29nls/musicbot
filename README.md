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

### Health check & monitoring (PRD §5.1)

Bot menjalankan endpoint HTTP kecil di `HEALTH_PORT` (default `8080`):

| Endpoint | Arti | Kode HTTP |
| --- | --- | --- |
| `GET /health` | **Liveness**: proses bot masih hidup? Tidak menyentuh dependency apa pun, jadi selalu cepat | 200 selama server menyala |
| `GET /ready` | **Readiness**: semua dependency siap? | 200 kalau siap, 503 kalau database mati / gateway belum siap / Lavalink putus |
| `GET /metrics` | **Metrik proses** (§11): jumlah guild, lagu diputar, error rate, latensi Lavalink | 200 dengan teks Prometheus, 503 kalau metrik belum siap |

Contoh jawaban `/ready` (bagian `metrics` dipangkas supaya mudah dibaca):

```json
{
  "status": "degraded",
  "uptimeSeconds": 5400,
  "guildCount": 12,
  "checks": { "gateway": true, "lavalink": false, "database": "ok" },
  "metrics": { "...": "lihat /metrics" }
}
```

Kenapa dua endpoint, bukan satu: saat bot bermasalah, tindakan yang benar
berbeda-beda. `/health` gagal berarti **restart**; `/ready` 503 dengan
`database: "down"` berarti **tunggu database**, dan me-restart bot justru
menambah masalah. Lavalink yang putus hanya `degraded` karena moderasi, tiket,
serta logging tetap berjalan tanpa mesin audio.

`HEALTH_PORT=0` mematikan seluruh endpoint (berguna saat menjalankan bot lokal
tanpa monitoring). Portnya **tidak** dipublish ke luar di `docker-compose.yml`:
container `bot` punya healthcheck sendiri yang memanggil `/health`, jadi status
terlihat lewat `docker compose ps` tanpa membuka port ke host.

#### Metrik proses (`GET /metrics`)

PRD §11 menuliskan empat angka yang harus bisa dilihat: jumlah guild, lagu
diputar, error rate, dan latensi Lavalink. Yang pertama sudah ada di health
check; tiga sisanya hidup di modul `src/modules/metrics/` dan diekspos sebagai
teks Prometheus:

```
harmony_uptime_seconds 5400
harmony_guilds 12
harmony_tracks_played_total 318
harmony_interactions_total{kind="command"} 402
harmony_interaction_errors_total{kind="command"} 2
harmony_interactions_total{kind="component"} 57
harmony_interactions_total{kind="message"} 9
harmony_command_error_rate 0.004975124378109453
harmony_lavalink_connected 1
harmony_lavalink_latency_ms 23
```

Empat keputusan yang perlu diketahui sebelum angka ini dipakai:

- **Hitungannya kumulatif sejak proses start**, bukan jendela bergulir.
  Karena itu satu proses yang hidup seminggu tidak bisa "menghapus"
  kegagalannya dengan restart — persis yang dibutuhkan KPI §13 ("error rate
  perintah < 1%"). Jendela bergulir butuh penyapuan berkala, dan penyapuan
  berkala adalah tempat yang paling sering gagal diam-diam.
- **Yang dihitung adalah pekerjaan yang benar-benar dikerjakan**: Commands
  dihitung setelah gerbang izin dan cooldown lolos, jadi klik yang ditolak
  sebelum menyentuh apa pun tidak ikut terhitung sebagai pemakaian.
- **Error rate tidak pernah dibulatkan.** Error rate 0,4% yang ditulis "0%"
  menghapus tepat kejadian yang dicari.
- **`harmony_lavalink_latency_ms` tidak ditulis sebelum ada sample.** Metrik
  yang belum pernah terisi lebih baik tidak ada daripada ada dengan angka 0
  yang disalahartikan sebagai "latensi 0 milidetik".

Latensinya diukur job `metricsProbe` (default tiap 30 detik) dengan memanggil
`GET /stats` ke node Lavalink — endpoint murah yang tidak menyentuh player.
`/ready` juga menyertakan objek `metrics` di responsnya supaya satu
permintaan sudah cukup untuk diagnosis. Kalau metrik belum siap, `/metrics`
menjawab **503** dan bukan 200 kosong: kondisi "metrik hilang" harus terlihat,
bukan terlihat sebagai grafik yang datar tapi sehat.

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
`volume` (0–200), `idle-timeout` (30–86400 detik), `stay-channel` (voice
channel yang dijaga 24/7; sama dengan `/247 join`, dan hanya boleh diubah
dari Manage Server karena memengaruhi koneksi bot),
`welcome-message` & `goodbye-message` (placeholder `{user}` `{mention}`
`{server}` `{count}`), serta `music` / `moderation` / `automod` / `logging` /
`custom-commands` (true/false) untuk menyalakan-matikan modul.

Keduanya butuh izin **Manage Server** dan hanya bisa dipakai di dalam server.
Nilai yang tidak valid ditolak sebelum menyentuh database, dengan pesan yang
menyebut field bermasalahnya.

### Bahasa server (ID / EN)

`/config set locale:id` atau `/config set locale:en`, dan tampilannya ikut berubah
di `/config show`. Bahasa server disimpan di kolom `guild_config.locale`.

Kolom itu **sudah ada sejak migrasi pertama** — lengkap dengan tipe domain,
mapping, dan validasi — tapi tidak satu baris kode pun memakainya, dan `/config`
tidak punya opsi untuk mengubahnya. Pola yang sama seperti `REDIS_URL` dulu:
infrastrukturnya siap, fiturnya tidak pernah dibuat, dan tidak ada yang gagal
karena kekosongan itu tidak terlihat dari mana pun.

Ada dua hal yang harus dibedakan, karena kelihatan mirip tapi mekanismenya beda:

- **Nama & deskripsi perintah** tidak pernah dirender bot. Discord yang
  menampilkannya, dari data yang dikirim saat deploy — jadi terjemahannya harus
  ikut di payload `name_localizations` / `description_localizations`.
  Semuanya dikirim dari [commandTranslations.ts](src/modules/i18n/commandTranslations.ts),
  dan **tes gagal kalau satu perintah pun belum punya terjemahan**.
- **Teks balasan** (embed, pesan kesalahan) dicari saat runtime lewat katalog
  di [catalog.ts](src/modules/i18n/catalog.ts), dan bahasa server dibaca lewat
  cache 30 detik yang langsung dibuang begitu `/config set locale` dipakai.

Nama perintah **tidak** diterjemahkan: nama Indonesia jadi nama kanonik, dan
`/queue` tetap bisa diketik sama seperti `/antrean`. Menerjemahkan nama perintah
justru merusak — nama itu bagian antarmuka yang paling sering dibacakan.

**Sapuan modul musik sudah selesai.** Semua teks yang tampil dari perintah
musik — nama field, judul, footer, pesan kesalahan, label mode loop & filter,
tombol navigasi antrean, dan placeholder select menu — sekarang datang dari
katalog, begitu juga embed `/stats` dan seluruh pesan `/playlist`.

**Sapuan modul moderasi juga sudah selesai** untuk 14 perintah intinya:
`/ban` `/kick` `/unban` `/warn` `/unwarn` `/warnings` `/timeout` `/note`
`/case` `/modprofile` `/purge` `/slowmode` `/lock` `/unlock`. Yang ikut
diterjemahkan: gerbang izin,embed log kasus, DM ke target, halaman kasus
(status, kondisi target sekarang, hasil DM), daftar peringatan & catatan,
profil moderator, log purge, penolakan hierarki, error database, sampai baris
ringkasan yang menempel di balasan tiap aksi.

Tiga keputusan yang membuat sapuan ini tidak hanya "ubah kalimat":

- **Hierarki menyimpan kunci, bukan kalimat.** `checkModerationHierarchy`
  mengembalikan `{ ok: false, messageKey }`, dan pemanggil yang
  menerjemahkannya lewat `hierarchyMessage(check, t)`. Kalau berkas hierarki
  tetap menyimpan kalimat Indonesia, modul murni itu ikut tahu soal bahasa.
- **Urutan daftar tidak ikut berubah saat bahasa diganti.** `compareActions`
  mengurutkan lewat nama aksi, bukan `localeCompare` pada label — kalau tidak,
  daftar jenis aksi di `/modprofile` akan tertukar begitu server-nya English.
- **Label aksi tetap kapital.** `actionLabel('ban')` mengembalikan `Ban`, bukan
  nilai enum `ban`, supaya moderator membaca kata di awal baris.

Satu hal **sengaja** tidak diterjemahkan: alasan yang masuk ke audit log
Discord. Yang membacanya moderator lewat menu Audit Log bawaan Discord, dan
audit log itu tidak punya tempat untuk bahasa server. Alasan moderator juga
selalu dia ketik sendiri dalam bahasanya.

**Sapuan modul logging juga sudah selesai** untuk `/logs` dan `/logging`.
Yang ikut diterjemahkan: ringkasan filter, daftar hasil `/logs` beserta kaki
halaman dan catatan "halaman berikutnya", **baris per baris ringkasan tiap
entri** (kasus, executor, channel, tautan lompat ke pesan log), embed statistik
(daftar kategori, aksi teratas, member paling sering terkait, catatan periode
default), ringkasan `/logging` beserta status modul, baris ekspor, semua
pesan validasi `/logs`, dan embed error logging. Label event (22 label) dan
label kategori (6 label) ikut lewat katalog, jadi `/logs stats:true` di server
English tidak lagi mencampur bahasa.

Dua keputusan yang mencegah sapuan ini jadi "ubah kalimat":

- **Error validasi menyimpan kunci, bukan kalimat.** `LoggingValidationError`
  sekarang membawa `(key, params)` dan `message`-nya diturunkan dari katalog
  bahasa Indonesia, jadi `toLoggingErrorEmbed(error, t)` yang menyusun kalimat
  akhir. Kalau kalimatnya disimpan di `validation.ts`, setiap `"from"` atau
  `"to"` yang diketik user akan menghasilkan pesan bahasa Indonesia di server
  English.
- **Label `CATEGORY_META.label` sengaja tetap bahasa Indonesia.** Label itu
  ikut registering sebagai nama pilihan (`choice`) di `/logs` dan `/logging`,
  dan Discord membaca nama pilihan dari payload saat deploy — sama seperti
  nama perintah. Embed memakai `categoryLabel(category, t)` yang baru, jadi
  teks yang tampil ikut bahasa server tanpa merusak nama pilihan.

Yang **belum** ikut diterjemahkan: `/automod` `/customcommand`
`/reactionrole` `/ticket`, plus **22 berkas event log** di
[src/events/logging/](src/events/logging/) (judul embed seperti "Channel
Diperbarui" dan nama field seperti "Nama" / "Topik" masih bahasa Indonesia).
Event handler itu punya sifat yang berbeda: **judul dan ringkasannya tersimpan
di tabel `log_entry`**, jadi entri yang sudah tercatat sebelum server diganti ke
bahasa Inggris **tidak akan ikut berubah** — penerjemahan susulan mustahil tanpa
menulis ulang riwayat. Itulah alasan sapuan ini berhenti di renderer dan bukan
di event handler: bagian renderer selesai sekarang, bagian event handler menyusul pada sapuan berikutnya.

**Mekanismenya:** `gateMusicCommand` sudah membaca config server untuk aturan
lain, jadi penerjemah diambil sekali di sana lalu dipakai ulang lewat
`MusicContext.t`. Tidak ada perintah yang perlu `await` kedua hanya untuk
teks. Handler komponen (`/queue` tombol, `/search` select) menerjemahkan
dengan cara yang sama. `gateAdminCommand` memakai pola yang sama persis lewat
`AdminContext.t`, jadi 14 perintah admin tidak perlu lookup sendiri.

Tiga keputusan yang mengubah bentuk katalog:

- **Durasi dan contoh format ikut diterjemahkan, bukan disalin.** `"6 jam"`
  dan `"6 hours"` bukan beda kosakata, dan menyalin angka batas ke katalog
  berarti batas yang salah diam-diam kalau `_constant_` itu diubah. Jadi
  `formatDuration()` masih dipakai, hasilnya jadi placeholder.
- **Contoh format posisi ikut diterjemahkan** (`90`, `1:30`, `1m30s`)
  karena itu instruksi, bukan keterangan. Sintaksnya sama untuk dua bahasa,
  tapi penjelasannya tidak.
- **Nilai bawaan renderer adalah bahasa Indonesia**, bukan "tidak ada".
  Semua 1.300 tes lama tetap lulus tanpa diubah satu baris pun, dan teks
  bot tidak bergeser diam-diam kalau ada pemanggil yang belum meneruskan
  penerjemah.

**Yang belum:** teks fitur di luar musik, moderasi, dan logging — `/automod`,
`/customcommand`, `/reactionrole`, `/ticket`, inventaris `/privacy`, dan 22
event handler log — masih ditulis langsung dalam bahasa Indonesia, dan katalog
runtime jatuh ke bahasa Indonesia secara sadar untuk kunci yang belum ada,
bukan diam-diam jadi bahasa acak. Katalog setengah terisi lebih buruk daripada
kosong: orang akan melihat dua bahasa dalam satu layar tanpa punya cara tahu
mana yang belum.

Teks command tidak ikut diperiksa penjaga yang sama, karena memang tidak
perlu: nama dan deskripsinya dibaca Discord dari payload saat deploy, bukan
dari kode, dan `commandTranslations.ts` sudah memaksa tiap perintah punya
terjemahan Inggris.

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
| `/play <query>` | Cari lalu putar, atau tambahkan ke antrean. Kata kunci → pencarian YouTube; URL diteruskan apa adanya; tautan Spotify → metadata resmi lalu audio dicari ulang | Semua (harus di voice channel) |
| `/search <query>` | Cari 5 hasil teratas, pilih satu lewat select menu untuk langsung diputar | Semua (harus di voice channel) |
| `/queue` | Lagu yang sedang diputar + antrean berhalaman (10 lagu/halaman, tombol navigasi) | Semua |
| `/nowplaying` | Embed lagu aktif: progress bar, volume, sisa antrean | Semua |
| `/skip` | Lewati lagu sekarang | DJ |
| `/pause` / `/resume` | Jeda / lanjutkan pemutaran | DJ |
| `/stop` | Hentikan dan bersihkan antrean (bot tetap di voice channel) | DJ |
| `/volume <0–200>` | Atur volume; 0 = bisukan. Di atas 100 berarti penguatan suara | DJ |
| `/loop <off\|track\|queue>` | Ulangi satu lagu / seluruh antrean | DJ |
| `/shuffle` | Acak urutan antrean | DJ |
| `/remove <posisi>` | Hapus satu lagu dari antrean | DJ |
| `/move <dari> <ke>` | Pindahkan posisi satu lagu dalam antrean | DJ |
| `/seek <posisi>` | Lompat ke posisi (`90`, `1:30`, `1m30s`) | DJ |
| `/playlist <subcommand>` | Simpan & putar playlist: `create` `add` `remove` `list` `show` `play` `delete` `public` | Semua (harus di voice channel untuk `play`) |
| `/filter <mode>` | Ubah warna suara: bassboost, nightcore, vaporwave, 8D, atau `off` | DJ |
| `/lyrics [judul]` | Lirik lagu yang sedang diputar (baris aktif ditandai `▶`), atau cari lirik lewat judul | Semua |
| `/247 <join\|leave\|status>` | Jaga satu voice channel tetap terisi bot, atau matikan lagi mode itu | DJ / Manage Server (`status`: semua orang) |
| `/stats [jenis] [periode]` | Statistik lagu & perintah di server ini (agregat, tanpa data pribadi) | Semua |
| `/disconnect` | Bot keluar dari voice channel, antrean dikosongkan | DJ |

**Playlist: simpan, buka lagi, dan bagikan ke server ini**

`/playlist create <nama>` lalu `/playlist add <nama> <judul atau URL>` — atau
`/playlist add <nama>` tanpa query untuk **menyimpan lagu yang sedang diputar**.
Delapan subcommand: `create` `add` `remove` `list` `show` `play` `delete` `public`.

Empat hal yang perlu diketahui:

- **`uri` adalah sumber kebenaran, bukan `encoded`.** Data base64 Lavalink bisa
  basi setelah node restart atau ganti password, jadi playlist selalu
  di-resolve ulang dari URL-nya. Konsekuensinya: playlist lama tetap bisa
  diputar tanpa perlu disunting siapa pun. Playlist yang tidak punya `uri`
  memakai `encoded` sebagai sumber terakhir, dan entri yang keduanya tidak punya
  **dihitung sebagai gagal**.
- **Lagu yang gagal dimuat dilaporkan jumlahnya**, bukan diputar diam-diam. Footer
  embed menyebut berapa dari berapa yang gagal, jadi "diputar" tidak pernah lebih
  besar dari kenyataan. Resolve dilakukan bertahap 5 lagu sekaligus dengan urutan
  tetap terjaga.
- **Nama playlist tidak membedakan huruf besar-kecil** (`Lofi` = `lofi`), jadi tidak
  ada dua baris dengan nama yang terlihat sama. Playlist milik orang lain dilaporkan
  "tidak ada" — membalas "bukan milikmu" justru membocorkan bahwa nama itu benar.
- **Batas 100 lagu per playlist.** Menambah ke playlist yang sudah penuh ditolak
  dengan menyebut batasnya. Lagu yang sudah ada tidak digandakan, dan jumlahnya
  dilaporkan ("3 lagu tidak digandakan karena sudah ada").

Playlist bisa dibagikan ke server ini dengan `/playlist public <nama>`; yang
privat hanya bisa diputar pemiliknya. **Playlist ikut tercakup privasi §12:**
`ownerId`-nya dihitung di `/privacy` dan dilepas (pseudonim) saat
`/data-delete` dijalankan — isi playlist tetap ada karena daftar lagu bukan tentang
orang, sedangkan pemiliknya bisa ditelusuri kembali.

**Antrean berhalaman: 10 lagu per halaman, dengan tombol navigasi**

`/queue` menampilkan 10 lagu berikutnya per halaman, jadi antrean 40 lagu tidak
pernah dipotong diam-diam seperti sebelumnya. Kalau masih ada halaman lain,
embed menyebutkannya dan pesan dapat tombol `⏮️ ◀️ ▶️ ⏭️`.

Tiga hal yang menentukan halaman ini tidak menyesatkan:

- **Nomor dihitung dari posisi di antrean utuh.** Di halaman 3, baris pertama
  tetap ditulis `21.` supaya `/remove 21` menunjuk lagu yang sama dengan yang
  tertulis. Kalau nomor dihitung ulang per halaman, satu angka yang salah bisa
  menghapus lagu yang tidak sedang ditonton siapa pun.
- **Halaman selalu dijepit ke data terbaru.** Antrean bisa menyusut antara dua
  klik (lagu selesai, `/stop` jalan, member pindah server), jadi klik ke
  halaman yang sudah tidak ada menampilkan halaman terakhir yang ada — bukan
  halaman kosong atau error. Kalau antrean habis, tombolnya dilepas dan
  embed-nya berubah jadi "antrean kosong".
- **Tombolnya publik, antrean tetap milik server.** Siapa pun yang melihat pesan boleh
  berpindah halaman; tidak ada yang bisa memakai tombol orang lain untuk
  mengubah apa pun, karena klik hanya menulis ulang isi pesan yang sama.

Nomor halaman masuk ke `customId` sebagai satu-satunya isi — bukan judul lagu
atau data lain, karena `customId` ikut terkirim ke siapa pun yang menyalin
payload interaksi. Tombol batas dinonaktifkan, bukan disembunyikan, dan klik
pada pesan yang sudah lewat 15 menit dijawab "jalankan `/queue` lagi" karena
Discord menolak `update()` pada pesan lama.

**Filter audio: satu mode aktif, kembali ke normal lewat `off`**

`/filter <bassboost|nightcore|vaporwave|8d|off>` mengubah warna suara pemutar.
Filter adalah **milik player Lavalink, bukan antrean** — ia menempel sampai
diubah, termasuk menyeberang antar lagu, dan `/nowplaying` menampilkannya di
field **Filter** supaya orang tahu kenapa suaranya beda.

Tiga hal yang perlu diketahui:

- **`/filter` sebelum `/play` pertama tidak dianggap gagal.** Player Lavalink
  belum ada saat itu, jadi mode hanya tersimpan dan diterapkan saat pemutaran
  dimulai — balasannya menyebut itu secara eksplisit.
- **Setiap preset hanya mengatur satu kelompok parameter** (bassboost →
  equalizer, nightcore/vaporwave → timescale, 8D → rotation), dan semuanya
  diuji terhadap batas aman Lavalink: equalizer band 0–14, gain −0.25..1.0,
  ditambah jendela yang bot tetapkan sendiri untuk timescale (0.5–1.5) dan
  rotasi 8D (≤ 1 Hz). Nilai yang lebih ekstrem memang lebih keras, tapi
  suaranya pecah — dan itu baru ketahuan setelah lagu diputar.
- **`/disconnect` mengembalikan filter ke `off`** bersama seluruh state server;
  `/stop` tidak — sama seperti mode loop dan volume.

**Metadata Spotify: tempel tautan, judul & sampul jadi benar**

`/play https://open.spotify.com/track/<id>` (atau `spotify:track:<id>`) mengambil
metadata resmi dari Spotify dulu — judul, artis, album, cover, durasi — lalu
**mencari ulang audio itu di Lavalink** dengan judul resmi. Embed menampilkan
keduanya: judul Spotify (dengan cover) dan judul audio yang benar-benar berbunyi.

Yang perlu diketahui:

- **Bot tidak memutar audio dari Spotify.** Itu butuh Lavalink dengan plugin
  berlisensi berbayar, jadi yang diambil dari Spotify **hanya metadata**. Dengan
  begitu fitur ini tidak butuh Spotify Premium, dan batasnya dinyatakan terbuka,
  bukan diklaim sebagai “dukungan Spotify penuh”.
- **Metadata hanya dibaca kalau kredensial diisi** (`SPOTIFY_CLIENT_ID` &
  `SPOTIFY_CLIENT_SECRET`, Client Credentials dari developer.spotify.com).
  Kosong = member diberi tahu fiturnya belum aktif, bukan gagal diam-diam.
- **Hanya track tunggal.** Tautan playlist/album ditolak dengan penjelasan dan
  saran membuka lagunya — bukan diberi jawaban “tidak ditemukan” yang membuat
  orang mengira tautannya rusak.
- **Pencocokan menentukan apakah ini dipercaya.** Pencarian “judul – artis” di
  YouTube hampir selalu mengembalikan cover, remix, dan reaksi, jadi kandidat
  dinilai dari judul (harus cocok) **dan** durasi (toleransi keras 8 detik).
  Kalau tidak ada yang cocok, jawabannya “tidak ada audio yang cocok” beserta
  jumlah kandidat yang diperiksa — **memutar versi yang berbeda lebih buruk daripada
  bilang tidak bisa**.
- Embed menyebutkan kalau durasi audio meleset beberapa detik dari metadata,
  supaya perbedaan rekaman terlihat jelas dan bukan sesuatu yang misterius.

**Batas durasi track (PRD §6.2)** — dua aturan anti-abuse yang berlaku untuk semua
server:

| Aturan | Berlaku untuk |
| --- | --- |
| Durasi maksimum **6 jam** per lagu | Semua orang, termasuk DJ — ini batas memori, bukan batas hak akses |
| Lagu **> 30 menit** (dan live stream) | Hanya DJ / Manage Server |

Semua jalur pemuatan ikut menerapkannya: `/play`, `/search` (select menu), dan
`/playlist play`. Lagu yang ditolak **dihitung dan dilaporkan** — playlist yang
separuhnya tidak diputar karena alasan ini akan terlihat di footer, bukan
diputar lebih pendek tanpa penjelasan. Kalau **semua** lagunya ditolak, bot tidak
sampai menyambungkan ke voice channel sama sekali dan jawabannya menyebutkan
alasannya.

Live stream diperlakukan sebagai lagu panjang karena durasinya tidak diketahui:
tidak ada yang bisa menjamin stream berhenti dalam 30 menit.

**Lirik: mengikuti baris yang sedang berbunyi**

`/lyrics` menampilkan lirik lagu yang **sedang diputar**; `/lyrics <judul>`
mencari lirik lagu apa pun dari kanal teks, tanpa perlu ada musik yang berbunyi.

Sumbernya **LRCLIB** (gratis, tanpa API key) dengan **lirik ikut timing**.
Kalau LRCLIB tidak punya lirik untuk sebuah lagu, bot memakai Genius — tapi
**hanya kalau `GENIUS_ACCESS_TOKEN` diisi** di `.env`; kosong (default) berarti
bot tidak pernah menyentuh Genius sama sekali.

Yang perlu diketahui:

- **Baris aktif ditandai `▶`.** Lirik sinkron tidak ditampilkan semuanya
  sekaligus: yang muncul adalah 3 baris sebelum + baris aktif + 4 baris
  sesudah, jadi orang bisa ikut menyanyikan tanpa menggulir ratusan baris.
  Lirik tanpa timing (atau lirik polos dari Genius) ditampilkan dari atas
  sampai 20 baris, lalu dipotong dan jumlah barisnya disebut di footer.
- **Tidak ada lirik ≠ ada yang rusak.** Sumber yang memang tidak punya lirik
  dibalas "tidak ditemukan" (dengan saran pakai `/lyrics <judul>`), sedangkan
  sumber yang sedang bermasalah dibalas berbeda — jadi tidak ada pesan "tidak
  ada lirik" yang sebenarnya berarti "LRCLIB sedang down".
- **Tidak ada yang disimpan ke database.** Lirik disimpan di memori selama 6 jam
  supaya orang tidak mengetuk API berulang, lalu dibuang — tidak ada satu pun
  baris lirik yang ditulis ke database Harmony.
- **Pencarian lagunya dibersihkan dulu**: `(Official Music Video)`, `[HD]`,
  `feat. ...`, dan akhiran `- Topic` dibuang sebelum dikirim ke sumber, karena
  judul mentah dari YouTube hampir tidak pernah cocok dengan judul di
  database lirik.
- Genre instrumental sengaja dilewati — liriknya cuma "[Instrumental]", bukan
  sesuatu yang perlu ditampilkan.

**`/search`: pilih dari daftar, bukan mengetik URL**

`/search <kata kunci>` mencari lewat YouTube lalu menampilkan **5 hasil teratas**
dalam string select menu. Memilih satu akan memutar lagu itu (atau menambahkannya
ke antrean kalau sudah ada yang berbunyi).

Dua hal yang perlu diketahui:

- **Hasilnya dikirim ephemeral** dan berlaku **15 menit**. Pilihannya private,
  jadi tidak ada yang perlu dilihat member lain dan tidak ada yang ditulis ke
  database.
- **Session-nya disimpan di store kunci-nilai bersama** dengan TTL 15 menit, jadi
  select menu tetap bekerja meski guild-nya ditangani proses berbeda (§5.3).
  Kalau bot restart atau Redis sempat kosong, menunya menjawab “sudah tidak
  berlaku” dan menyuruh mengulang `/search` — bukan gagal diam-diam.
- **Kalau session tidak bisa disimpan**, `/search` menjawab “coba lagi” dan tidak
  mengirim menunya sama sekali, daripada mengirim menu yang pasti sudah basi.

Yang membuat menu ini tidak bisa dipalsukan: `customId` milik Discord ikut
terkirim ke siapa pun yang menyalin payload interaksi, jadi isinya harus
dianggap terbaca publik. Karena itu **nilai opsi hanya indeks (`0`, `1`, …),
bukan data lagu** — session-nya ditunjuk lewat token acak 8 karakter hex, dan
hanya orang yang menjalankan `/search` itu yang boleh memakainya. Satu pilihan
sekali: session **diklaim** (dibaca sekaligus dihapus) dari store hanya setelah
pemilik dan servernya cocok, jadi klik ganda tidak menambahkan lagu dua kali,
bahkan kalau dua shard kebetulan memproses klik yang sama. Klaim yang gagal
karena store bermasalah diperlakukan sebagai “sudah dipakai”: lebih baik satu
permintaan diulang daripada satu lagu masuk dua kali.
**Loop: tiga mode, tiga perilaku berbeda**

| Mode | Saat lagu selesai |
| --- | --- |
| `off` | Lanjut ke lagu berikutnya; berhenti kalau antrean habis |
| `track` | Lagu yang sama diputar ulang |
| `queue` | Lanjut seperti biasa; kalau antrean habis, satu putaran diulang dari awal |

Yang perlu diketahui soal implementasi `queue`: bot menyimpan **lagu-lagu yang
sudah diputar dalam satu putaran** (dibatasi 100 lagu) supaya bisa mengulang
tanpa memuat ulang dari Lavalink — antrean sendiri hanya berisi lagu yang belum
diputar. Karena lagu yang baru selesai dicatat di **akhir** riwayat, satu putaran
diulang persis dalam urutan semula: lagu terakhir berbunyi lagi paling akhir,
bukan di awal. `/skip` selalu benar-benar melewati, bahkan saat `track` aktif —
kalau tidak, tombol skip jadi tidak melakukan apa pun. `/stop` dan `/disconnect`
membuang riwayat itu; jejaknya tidak berguna setelah tidak ada yang diputar.

Loop disimpan **per server di memori**, sama seperti antrean: restart bot
mengosongkan antrean dan mengembalikan loop ke `off`.

**Mode 24/7: satu channel yang dijaga, bukan sekadar "tidak keluar otomatis"**

`/247 join` (dari dalam voice channel, atau `/247 join channel:#musik`)
menyimpan channel tujuan ke konfigurasi server lalu menyambungkan bot ke sana.
Selama mode ini aktif, dua hal berlaku:

- **Bot tidak keluar otomatis.** Hitungan mundur `idleTimeoutSec` dibatalkan
  setiap kali antrean habis, jadi channel itu tidak pernah kosong karena bot
  yang pergi duluan.
- **Bot kembali sendiri.** Job penyapuan (`STAY_SWEEP_MINUTES`, default 5 menit)
  mengecek tiap server: bot yang ter-kick, shard yang reconnect, atau
  `stay-channel` yang diganti akan disambungkan lagi tanpa perlu perintah.

Tiga hal yang sengaja tidak diputuskan bot sendiri:

- **Bot tidak pindah channel di tengah lagu.** Kalau admin mengganti channel
  24/7 saat ada yang memutar, perpindahan menunggu lagu selesai — memotong
  lagu orang demi pengaturan admin lebih buruk daripada menunggu sebentar.
- **Mematikan mode tidak langsung menarik bot.** `/247 leave` mematikan mode;
  kalau sedang ada lagu, bot menyelesaikan lagu itu lalu keluar mengikuti
  `idleTimeoutSec`, dan kalau tidak ada yang diputar bot langsung keluar.
- **Server tanpa channel 24/7 tidak tersentuh.** Job hanya berlaku di server
  yang memang mencalonkan sebuah channel.

`/247 status` menampilkan channel tujuan, posisi bot sekarang, apakah keluar
otomatis masih berlaku, dan keputusan apa yang akan diambil job berikutnya.
Mematikan mode selalu perlu DJ atau Manage Server; `/247 status` boleh dilihat
siapa saja.

**Aturan yang berlaku**

- **Role DJ** diambil dari konfigurasi server. Kalau belum diatur, semua orang
  boleh mengontrol; pemegang **Manage Server** selalu boleh.
- Bot yang sedang memutar di satu channel tidak bisa dikendalikan dari channel
  lain — user diminta pindah (kecuali Manage Server).
- Antrean dibatasi `MAX_QUEUE_SIZE` (default 500). Kelebihan lagu dari sebuah
  playlist dipotong dan jumlahnya dilaporkan di embed.
- Setelah antrean habis, bot menunggu `idleTimeoutSec` (lihat `/config set`)
  lalu keluar sendiri dari voice channel.
- Selama mode 24/7 aktif di server itu, hitungan mundur itu **tidak dijalankan
  sama sekali** — lihat sub-bagian mode 24/7.
- Bot bergabung sebagai *deafened* supaya tidak memproses audio yang tidak perlu.
- Kesalahan (bukan di voice channel, bukan DJ, antrean penuh) dibalas sebagai
  pesan privat, sedangkan hasil yang perlu dilihat semua orang tetap publik.

### Statistik server (Fase 3, §5.3)

`/stats` menampilkan dua angka untuk server ini: **lagu yang paling sering
diputarkan** dan **perintah yang paling sering dipakai**, plus grafik harian.
Dengan ini KPI §13 bisa diukur langsung dari database.

**Yang dikumpulkan, dan yang tidak.**

- Satu baris per (server, jenis, item, hari) di `playback_stat`.
  `kind` bisa `track` (lagu) atau `command` (nama perintah saja).
- **Tidak ada `userId` di tabel ini, dan tidak pernah ada.** Bot tidak
  merekam siapa yang memutar apa, dari channel mana, atau apa yang mereka
  cari. Karena itu modul ini tidak punya jalur `/privacy` atau
  `/data-delete` — tidak ada yang bisa disalin untuk seseorang (§12).
- **Argumen perintah tidak pernah ikut tersimpan.** Yang ditulis hanya
  `/play`, bukan `/play situs Rahasia`. Kalau teks pencarian ikut
  masuk, tabel "lagu terpopuler" akan jadi salinan semua yang pernah diketik
  siapa pun di server itu — dan tabel seperti itu tidak punya jalur hapus.

**Empat keputusan yang menentukan angkanya berarti atau tidak:**

- **Yang dihitung waktu dengar, bukan durasi lagu.** Satu `/play` lalu
  `/skip` tidak boleh membuat lagu mana pun terlihat seperti yang paling
  sering didengarkan; lagu baru dihitung setelah bunyi 10 detik.
- **Satu baris per hari, bukan per pemutaran.** Tabelnya jauh lebih kecil
  dan query-nya ikut kecil; leaderboard dihitung dengan menjumlahkan
  hari-hari itu.
- **Hari dihitung dalam UTC.** Server Discord ada di ribuan zona waktu, jadi
  "hari" tidak punya satu makna untuk semua orang; UTC membuat angka antarserver
  bisa dibandingkan dan tidak berubah sendiri saat daylight saving bergeser.
- **Leaderboard seri dipecah stabil.** Urutannya ditentukan jumlah, lalu
  label, supaya `/stats` yang dibuka dua kali punya urutan baris yang sama —
  angka yang berganti urutan terlihat seperti angkanya ikut berubah.

Grafik harian ditampilkan per hari sampai 14 hari, lalu dijumlahkan per
minggu, dan pergantian itu disebut apa adanya di footer. Rentang maksimum
90 hari; baris yang lebih lama dihapus oleh job retensi (lihat bagian 11) —
bukan karena masalah privasi, tapi supaya tabel ini tidak tumbuh tanpa
batas di server yang aktif lama.

Pencatatan terjadi di dua tempat: `onTrackFinished` pada `MusicService`
(dilewati lewat DI supaya modul musik tidak perlu tahu soal database) dan
setelah gerbang izin serta cooldown pada `interactionCreate`. Keduanya
**best-effort**: statistik yang gagal disimpan tidak pernah menggagalkan
pemutaran atau perintahnya, tapi dicatat ke log supaya tidak hilang diam-diam.

### Cara bot memegang state

`player.track` milik Lavalink hanya berisi data base64 — tanpa judul, artis, atau
metadata lain. Karena itu **lagu yang sedang diputar disimpan oleh bot**
([musicService.ts](src/modules/music/musicService.ts)), dan perpindahan lagu
dikendalikan event `end` dari Lavalink (event `replaced` diabaikan agar tidak
melompat dua kali). Yang **tidak** disimpan bot adalah antrean: itu ditulis ke
store bersama seperti cooldown dan session `/search` (lihat
[Antrean musik di store bersama](#antrean-musik-di-store-bersama)), jadi **antrean
tidak hilang saat bot restart** dan bisa dibaca proses lain.

Kalau Lavalink mati saat memutar, node akan dicoba sambung ulang dan player
dipindahkan ke node lain **bila ada node lain** (`moveOnDisconnect`).
Perintah musik memberi pesan jelas “Lavalink belum terhubung” alih-alih gagal
diam-diam.

### Multi-node Lavalink

NFR §11 menjanjikan “tambah node Lavalink tanpa mengubah kode bot”. Dulu itu
hanya tertulis: `LAVALINK_HOST` dan `LAVALINK_PORT` cuma punya satu pasangan dan
service selalu membangun persis satu node, jadi node kedua berarti mengubah kode
lalu deploy ulang. Sekarang daftar node masuk lewat environment:

```env
# Kosong = pakai LAVALINK_HOST/LAVALINK_PORT di bawah, jadi konfigurasi lama tetap berlaku
LAVALINK_NODES=lavalink-a:2333,lavalink-b:2333
```

Formatnya `host:port` dipisah koma, dan **port boleh tidak ditulis** —
`lavalink-a,lavalink-b` memakai `LAVALINK_PORT`. IPv6 wajib pakai kurung siku
(`[fd00::2]:2333`) karena `fd00::2` tanpa kurung tidak bisa dibedakan dari
`host:port`. Parser-nya ada di [nodes.ts](src/modules/music/nodes.ts) dan murni,
jadi aturannya bisa diuji tanpa Lavalink.

Empat hal yang perlu diketahui:

- **Semua node didaftarkan ke Shoukaku sekaligus**, dan pembagian bebannya
  memakai `nodeResolver` bawaannya: player baru goes ke node paling sepi. Jadi
  tidak ada load balancer di depan yang perlu disiapkan.
- **Entri rusak dibuang, bukan menggagalkan startup.** Salah ketik satu node di
  antara lima node lain tidak boleh membuat bot tidak mau menyala sama sekali:
  node yang sehat tetap dipakai, dan entri yang dibuang dicatat di log lengkap
  dengan alasannya (`lava-b:port`, `lavalink:70000`, `lava-3 (duplikat)`).
- **Batas 16 node.** Di atas itu hampir pasti salah ketik, bukan cluster
  sungguhan, jadi sisanya juga dibuang dan disebut alasannya.
- **Jumlah player per node** dibaca dari laporan `/stats` node itu
  (`MusicService.nodeReport()`). Angka 0 sebelum laporan pertama masuk berarti
  “belum dilaporkan”, bukan “node ini kosong”.

Yang **belum** ada: menambah atau mencabut node saat bot sedang jalan
(`Shoukaku.addNode()` memang tersedia, tapi kalau tidak disimpan ke mana pun
perubahan itu hilang saat restart, jadi lebih baik konfigurasi lewat environment
daripada fitur setengah jadi).

---

## 5. Moderasi & onboarding (M3)

| Perintah | Fungsi | Izin |
| --- | --- | --- |
| `/ban <user> [reason] [delete-messages 0–7]` | Ban member; opsional hapus pesannya + lampiran riwayat target | Ban Members |
| `/kick <user> [reason]` | Kick member | Kick Members |
| `/timeout <user> <duration> [reason]` | Bisukan sementara (`30s`, `10m`, `2h`, `7d`; maks 28 hari) | Moderate Members |
| `/warn <user> <reason>` | Peringatan tersimpan | Moderate Members |
| `/warnings <user>` | Riwayat peringatan (10 terbaru + total) | Moderate Members |
| `/unwarn <case>` | Cabut peringatan (`#CASE-0007` atau `7`) | Moderate Members |
| `/case <kasus>` | Halaman ringkasan satu kasus + aksi & log terkait | Moderate Members |
| `/modprofile <moderator>` | Halaman profil moderator: seluruh kasusnya + statistik aksi | Moderate Members |
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

**`/case` — halaman ringkasan kasus**

Satu perintah untuk meninjau satu kasus, tanpa harus mengumpulkan data dari
beberapa tempat. Balasannya ephemeral (berisi data member) dan berisi tiga
embed:

```bash
/case kasus:#CASE-0142
/case kasus:142
/case kasus:CASE 142
```

1. **Ringkasan** — target (mention member atau channel, sesuai jenis aksinya),
   moderator, status (`✅ Aktif` / `♻️ Dicabut` / `❌ Nonaktif`), waktu, alasan,
   dan masa berlaku. Untuk **ban** & **timeout** ada field **Kondisi sekarang**
   yang mengecek langsung ke Discord: masih diblokir atau tidak, masih timeout
   sampai kapan. Aksi lain tidak punya field ini karena tidak bisa dibatalkan.
   Untuk aksi yang memang mengirim DM ke target (warn, timeout, ban, kick)
   ada field **Notifikasi** yang berisi hasil pengiriman DM-nya: terkirim,
   gagal (DM-nya tertutup atau bot diblokir), atau tidak tercatat. Aksi yang
   tidak mengirim DM sama sekali (`/note`, slowmode, lock, unlock) tidak punya
   field ini.
2. **Riwayat target** — 5 kasus lain atas target yang sama (warn, timeout, ban,
   note sebelumnya) supaya moderator bisa langsung melihat pola, bukan cuma satu
   kejadian.
3. **Log terkait** — entri log yang menilibkan target dalam jendela **±1 jam**
   dari waktu kasus, dengan entri yang tertaut ke kasus itu sendiri di paling
   atas. Setiap baris punya tautan lompat ke pesan log aslinya.

Kalau panel log kosong padahal kasusnya jelas ada, itu berarti logging belum
menyala atau riwayat log sudah melewati masa simpan 30 hari — bukan berarti kasus
tidak ada. Gunakan `/logs case:#CASE-0142` untuk melihat daftar kasus itu saja.

Panel log tidak pernah menggagalkan halaman: kalau database log sedang bermasalah,
ringkasan dan riwayat kasus tetap tampil.

**Riwayat target yang ikut muncul di `/ban`**

`/ban` membalas dengan **dua embed** kalau targetnya punya riwayat — yang kedua
adalah “kasus sebelumnya atas orang ini”, jadi moderator tidak perlu membuka
`/case` satu per satu untuk tahu apakah ini pola pertama atau yang kelima:

```
🗂️ Riwayat terkait <@Raka>
⚠️ **2 peringatan masih aktif** — target sudah diberi tahu sebelumnya.
🔁 Target **pernah di-ban 1×** di server ini.
📋 Total **7** kasus sebelumnya — ⚠️ Warn `4` · 📝 Catatan `2` · 🔨 Ban `1`.

`138` ⏳ Timeout · <t:…:R> · oleh <@Dimas>
`96` ⚠️ Warn · <t:…:R> · oleh <@Dimas> · *nonaktif*
```

Aturan yang dipakai supaya angkanya tidak menyesatkan:

- **Hanya kasus yang tercatat lewat Harmony** dan berumur di bawah 12 bulan.
  Ban atau timeout yang dilakukan manual dari Discord tidak akan pernah muncul.
- **Member yang benar-benar bersih tidak mendapat embed kedua** — tidak ada
  “riwayat kosong” yang cuma menambah tinggi balasan.
- **Kasus yang sedang dibuat dikecualikan**, jadi ban ini tidak melaporkan dirinya
  sendiri sebagai “pernah di-ban sebelumnya”.
- **Ban yang gagal dieksekusi tidak dihitung sebagai pernah di-ban.** Kasus ban
  nonaktif berarti Discord menolaknya, jadi tidak ada yang pernah diblokir.
- **Peringatan aktif dihitung dari tabel peringatan**, bukan dari kasus `warn` —
  peringatan yang sudah dicabut moderator tidak muncul sebagai yang “masih aktif”.
- Balasannya tetap ephemeral (hanya untuk moderator), dan riwayat yang ditampilkan
  **tidak memuat alasan lengkap** — alasan lengkap tetap di `/case`.
- `/case` butuh izin Moderate Members sedangkan `/ban` butuh Ban Members, jadi
  moderator yang hanya punya Ban Members tidak bisa membuka detailnya.

Kalau database sedang bermasalah, embed kedua dilewati dan balasan ban tetap
tampil utuh — riwayat adalah tambahan, bukan syarat ban berhasil.

**`/modprofile` — halaman profil moderator**

`/case` menjawab "kasus ini terjadi bagaimana". `/modprofile` menjawab "kebiasaan
moderator ini seperti apa". Satu perintah, dua embed ephemeral:

```bash
/modprofile moderator:@Raka
```

Embed pertama: total kasus, target unik, rentang waktu aktif, aktivitas 30 hari
terakhir, dan **sebaran aksi** lengkap dengan batang perbandingan:

```
🔨 **Ban** ██████████ `12` (39%)
⚠️ **Warn** ████████░░ `9` (29%)
⏳ **Timeout** █████░░░░░ `6` (19%)
👢 **Kick** █░░░░░░░░░ `1` (3%) · ⚠️ 1 gagal
```

Embed kedua: 10 kasus terakhir, dengan arah ke `/case` untuk detail lengkapnya.

**Yang perlu dibaca dengan hati-hati**

- **Statistik ini bisa dipakai untuk mengadili, jadi sengaja dibuat jujur.**
`active: false` pada `warn` berarti peringatan **dicabut**, bukan aksi yang gagal —
mencampurkannya akan terlihat seperti moderator yang gagal 6 kali padahal habis
mencabut peringatannya sendiri. Karena itu keduanya dihitung dan ditampilkan
terpisah, dan hanya kasus **gagal** yang diberi tanda `⚠️`.
- **Rasio kasus per target** hanya muncul kalau di atas 1,5. Moderator yang
memang butuh beberapa kali untuk satu orang berbeda dari moderator yang
menyerang target yang sama berulang-ulang.
- **Cakupan datanya terbatas dan itu ditulis di footer**: hanya kasus yang
tercatat lewat Harmony, dan kasus lama dihapus setelah 12 bulan. Ban atau
timeout yang dilakukan manual dari Discord **tidak punya kasus** sama sekali —
profil yang terlihat bersih belum tentu berarti moderatornya jarang bekerja.
- Moderator tanpa kasus mendapat penjelasan yang jelas, bukan "tidak ditemukan".

Agregasi dihitung di database lewat `groupBy`, bukan memuat semua kasus ke
memory; hanya 10 kasus terbaru yang benar-benar ditarik. Query-nya dilayani
indeks baru `(guildId, moderatorId, createdAt)` — tanpa itu, halaman ini akan
memindai seluruh tabel kasus setiap kali dibuka.

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
`active`, dan `dmStatus` hasil pengiriman notifikasi DM ke target
(`sent` / `failed`, kosong kalau aksinya memang tidak mengirim DM atau kasusnya
dibuat sebelum status ini dicatat). Catatan `/note` juga tersimpan di sini
dengan tipe `note`.
- `warning` — baris peringatan yang menunjuk kasusnya; `/unwarn` menghapus baris
ini dan menonaktifkan kasusnya (data tidak hilang untuk audit).
- Nomor kasus yang sama ikut menempel di log kategori (lihat bagian 7) dan di
riwayat `/logs`, jadi satu aksi bisa ditelusuri dari kasus sampai pesan log-nya.

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

### `/logs` — cari riwayat log

Setiap event yang lolos modul logging juga **disimpan ke database** (tabel
`log_entry`): kategori, kunci event, judul, ringkasan isi embed, executor,
target, channel asal, dan ID pesan log. Jadi log tetap bisa dicari walau
channel log dihapus atau embed-nya sudah tak terlihat.

| Opsi | Contoh | Fungsi |
| --- | --- | --- |
| `category` | `member,message` | Batasi kategori (boleh beberapa, dipisah koma) |
| `user` | `@sasha` | Aksi atas dirinya **atau** aksi yang dilaulunya |
| `channel` | `#general` | Channel tempat aksi terjadi |
| `keyword` | `spam` | Cari di judul & ringkasan isi log |
| `case` | `#CASE-0142` | Hanya aksi dari satu kasus moderasi Harmony |
| `from` / `to` | `7d`, `24h`, `2026-10-01`, `02/10/2026` | Rentang waktu (relatif atau kalender) |
| `page` | `2` | Halaman hasil (10 entri per halaman) |
| `stats` | — | Statistik ringkas untuk periode ini, bukan daftar entri (lihat di bawah) |
| `format` | `json` / `csv` | Ekspor hasil pencarian sebagai file (lihat di bawah) |

```bash
/logs category:member from:7d
/logs user:@sasha category:member,role
/logs case:#CASE-0142
/logs channel:#pengumuman keyword:lagu from:2026-09-01 to:2026-10-01
```

Setiap hasil menampilkan waktu, target, executor, dan **tautan lompat** ke pesan
log aslinya (kalau masih ada). Butuh izin **Manage Server**, dan balasannya
ephemeral karena dapat berisi data member.

### `/logs … format:` — ekspor untuk arsip

Tambahkan `format:json` atau `format:csv` untuk mengubah hasil pencarian menjadi
file. Semua filter lain tetap berlaku, hasilnya dilampirkan ke balasan (ephemeral)
**dan** diarsipkan di host bot pada `data/exports/` (ubah dengan
`LOG_EXPORT_DIR`):

```bash
/logs format:csv from:2026-09-01 to:2026-10-01 category:member
/logs format:json case:#CASE-0142
/logs format:csv user:@sasha keyword:lagu
```

- **JSON** — arsip audit: memuat `generatedAt`, identitas server, **filter
  asal**, jumlah total, dan seluruh entri. Arsipnya bisa dibaca ulang tanpa
  harus mengingat filter-nya.
- **CSV** — kolom tetap `timestamp, category, event_key, title, case_id,
  executor_id, target_id, channel_id, log_channel_id, log_message_id, summary`
  supaya aman dibuka di Excel/Sheets atau diimpor ke alat audit lain.
- Maksimal **500 entri** terbaru. Kalau hasil lebih banyak, ringkasan
  mengatakannya eksplisit dan menyarankan memperkecil filter.
- Nama file memakai stempel UTC: `harmony-logs-<guildId>-<YYYYMMDD-HHmm>.csv`.
- Nilai yang diawali `=`, `+`, `-`, atau `@` diberi awalan tanda kutip tunggal
  supaya Excel tidak mengeksekusinya sebagai formula — ringkasan log bisa berisi
  teks dari pesan user.

Folder `data/` sudah masuk `.gitignore` dan `.dockerignore`, jadi arsip tidak
pernah ikut ter-commit atau masuk image Docker. Kalau foldernya tidak writable,
file tetap dikirim sebagai lampiran dan kegagalan penulisan hanya muncul di log bot.

### `/logs … stats:true` — statistik ringkas

Tambahkan `stats:true` untuk mengganti daftar entri dengan satu ringkasan
periode: jumlah event per kategori, event yang paling sering muncul, dan member
yang paling sering terlibat. Semua filter lain tetap berlaku.

```bash
/logs stats:true
/logs stats:true from:7d
/logs stats:true from:2026-09-01 to:2026-10-01 category:member
/logs stats:true user:@sasha
```

Embed-nya berisi tiga bagian:

- **Event per kategori** — enam kategori (member, pesan, channel, role, voice,
  server) lengkap dengan batang proporsi terhadap kategori teramai, jumlah
  absolut, dan persentase dari total.
- **Aksi teratas** — 5 `eventKey` yang paling sering muncul, lengkap dengan
  label Bahasa Indonesia (`guildMemberAdd` → “Member bergabung”,
  `moderation.ban` → “Ban”, memakai label yang sama dengan perintah moderasi).
- **Member paling sering terkait** — 5 member yang paling sering muncul di
  `targetId` **atau** `executorId`, dipisahkan jadi 🎯 jadi target dan
  ⚡ melakukan. Aksi pada diri sendiri (mis. member mengatur timeout sendiri)
  dihitung **satu kali**, bukan dua. Target dari kategori `channel` & `role`
  sengaja tidak ikut: `targetId` di sana berisi ID channel/role, bukan orang.

Periode memakai `from`/`to` seperti biasa. Kalau `from` tidak diisi,
statistik otomatis dibatasi ke **30 hari terakhir** — sama dengan masa simpan
riwayat — dan embed menyebutinya eksplisit supaya angkanya tidak disalahartikan
sebagai “sepanjang masa lalu”. Kueri agregasi berjalan di database, bukan di
memori: bot tidak menarik ribuan baris log ke process.

`stats:true` tidak bisa digabung dengan `format:` (keduanya mode tampilan yang
berbeda); kalau keduanya dipakai, bot menolak dengan pesan yang jelas.

### Kasus moderasi & sumber aksi

Aksi yang dijalankan Harmony lewat perintahnya (`/ban`, `/kick`, `/timeout`,
`/slowmode`, `/lock`, `/unlock`) **terhubung** dengan event Discord yang menyusul.
Saat perintah selesai, bot menyimpan tautan singkat antara kasus dan target-nya;
event `guildBanAdd`, `guildMemberRemove`, `guildMemberUpdate`, atau
`channelUpdate` yang tiba beberapa saat kemudian mengambil tautan itu dan
menandai embed log seperti ini:

```
🔨 Member Ban (Harmony)
Member: @sasha        ID: 2222…
Sumber: 🤖 Harmony (perintah bot)
Kasus:   #CASE-0142
Moderator: @mod_harfi
```

Kalau tidak ada tautan, log ditandai jelas sebagai aksi luar Harmony:

```
🔨 Member Ban
Sumber: 👤 Moderator lain (@mod_lain)
```

Log kasus yang dikirim perintah (`#CASE-0142`, alasan, moderator, status DM)
ikut mengikuti routing per kategori — jadi `/logging set member:#log-member`
menangkap `/warn` juga, bukan hanya ban/kick/timeout. Agar tidak dobel di
channel yang sama, embed event dari aksi Harmony dibuat ringkas: ia hanya
mengaffirmasi event-nya dengan menautkan kasus, sementara alasan lengkapnya
tetap ada di log kasus.

Tiga kemungkinan sumber yang dibedakan: **kasus Harmony** (punya nomor kasus),
**bot lain / bot tanpa kasus** (`🤖 Bot — di luar kasus Harmony`, mis. aksi yang
tautannya sudah lewat 60 detik), dan **moderator manusia**.

Agar `/logs` tidak menampilkan satu aksi dua kali, kasus yang sudah dicatat oleh
perintahnya menjadi satu-satunya baris riwayat — event Discord yang menyusul
hanya menempelkan nomor kasus pada embed kategorinya. Aksi tanpa kasus
(moderator lain, Discord) tetap dicatat utuh dari sisi event.

> Retensi riwayat log adalah **30 hari** (`DEFAULT_LOG_RETENTION_DAYS`): setiap
> entri diisi `expiresAt` saat disimpan, dan job retensi menghapusnya kalau
> tanggal itu sudah lewat. Pencatatan juga melompat kalau modul logging mati
> atau database offline — `/logs` akan menjelaskan kondisinya. Baris dengan
> `expiresAt` kosong **tidak** ikut terhapus, karena tidak pernah menetapkan
> batas; menghapusnya butuh keputusan eksplisit, bukan disimpulkan.

---

## 8. Reaction Roles (M5, Fase 2)

Panel self-assign role: member mengambil atau melepas role sendiri lewat
**string select menu** pada satu pesan. Tidak ada role yang bisa diganti bot
secara diam-diam — setiap perubahan selalu karena pilihan member.

```bash
/config set reactions:true

/reactionrole post channel:#pengaturan roles:@Pemain @Penggemar
/reactionrole post channel:#acara roles:@Peserta duration:7d
/reactionrole add panel:3 roles:@Developer
/reactionrole remove panel:3 roles:@Developer
/reactionrole list
/reactionrole close panel:3
/reactionrole delete panel:3
```

| Perintah | Fungsi |
| --- | --- |
| `/reactionrole post` | Kirim panel baru + select menu (maks 25 role), opsional `duration` |
| `/reactionrole add panel roles` | Tambah role ke panel yang ada; pesan panel diedit otomatis |
| `/reactionrole remove panel roles` | Hapus role dari panel (opsi terakhir tidak boleh dihapus) |
| `/reactionrole list` | Daftar panel: nomor, channel, jumlah role, sisa masa hidup |
| `/reactionrole close panel` | Tutup panel sekarang: select menu dilepas, pesan & data tetap ada |
| `/reactionrole delete panel` | Hapus panel beserta pesannya di channel |

Butuh izin **Manage Server**.

**Cara menulis role**: pilih lewat autocomplete `@` supaya Discord menyimpan
mention-nya (`<@&123…>`). Role yang diketik manual sebagai `@Nama Biasa` tidak
bisa dibaca — bot hanya menerima ID.

**Yang dijamin sistem**

- **Toggle**: memilih role yang sudah dimiliki akan melepaskannya. Select menu
  tidak punya tampilan centak, jadi aturan ini ditulis di embed panel.
- Role `@everyone`, role yang posisinya di atas bot, dan server tanpa izin
  **Manage Roles** untuk bot ditolak **saat panel dibuat** — bukan nanti saat
  member menyadarinya gagal.
- Role yang dihapus dari server, atau modul dimatikan, tidak membuat select menu
  diam-diam gagal: member dapat penjelasan dan diminta bicara ke moderator.
- Maksimal 25 role per panel karena itulah batas opsi string select menu
  Discord. Role lebih dari itu butuh panel terpisah.
- Opsi terakhir tidak bisa dihapus; hapus panelnya dengan
  `/reactionrole delete` kalau memang tidak dipakai lagi.

Data panel disimpan di `reaction_role_panel` + `reaction_role_option`. Opsi
memakai ID baris sebagai `customId`, jadi mengganti label atau urutan tidak
mematahkan tombol yang sudah aktif.

### Panel sementara (basi bayangan)

Panel yang hanya perlu hidup selama acara bisa diberi masa hidup:

```bash
/reactionrole post channel:#acara roles:@Peserta @Panitia duration:7d
```

| Input | Arti |
| --- | --- |
| `duration:7d`, `6h`, `30m` | Panel mati otomatis setelah itu |
| `duration:2` | Tanpa satuan dibaca sebagai **jam** |
| `duration:permanen` | Sama seperti tidak diberi `duration` |
| *(kosong)* | **Permanen** — perilaku bawaan, tidak berubah |

Batasnya 10 menit sampai 365 hari. Input yang tidak terbaca ditolak **saat
perintah dijalankan**, bukan diabaikan diam-diam — panel yang tanpa sengaja
menjadi permanen baru ketahuan berminggu-minggu kemudian.

**Yang terjadi saat panel berakhir**

1. Job penyapuan (setiap `PANEL_EXPIRY_SWEEP_MINUTES`, default 15 menit) mengedit
   pesan panel: **select menu dilepas** dan embed diganti pengumuman "sudah
   ditutup". Pesannya **tidak dihapus** — jejaknya tetap bisa dibaca admin, dan
   member yang masih menyimpan tautan ke pesan lama punya penjelasan.
2. Baris datanya tetap ada dengan `closedAt` terisi, jadi `/reactionrole list`
   membedakan "sudah ditutup" dari "aktif" dan sapuan berikutnya tidak bekerja
   dua kali untuk panel yang sama.

Penegasannya ada di dua tempat, karena keduanya menutup celah yang berbeda:

- **Penjaga utama ada di select menu.** Bahkan kalau bot mati atau keceplosan
  tepat saat masa hidup habis — sehingga pesan di Discord masih punya select
  menu — member tetap ditolak dengan jelas. Panel yang terlihat aktif tapi sudah
  berakhir adalah kondisi yang membingungkan; ini yang paling sering dikeluhkan
  orang soal bot sejenis.
- **Penyapuan hanya-appearance work.** Ia membersihkan tampilan, tidak
  memegang kebenaran. Kalau Discord sedang lambat atau guild-nya belum ada di
  cache, panel tetap benar-benar ditolak.

`/reactionrole close` memakai jalur yang sama persis dengan penyapuan otomatis,
seperti penutupan tiket: database dan pesan tidak mungkin berbeda pendapat.

Untuk menutup total beserta pesannya, tetap pakai `/reactionrole delete`.

---

## 9. Tiket (M5, Fase 2)

Sistem tiket dasar: satu **channel privat** per tiket di bawah kategori yang
ditentukan admin, terlihat hanya oleh pembuat tiket dan role staff.

```bash
/config set tickets:true
/ticket setup category:#tiket staff:@Staff channel:#support
/ticket list
/ticket close
/ticket panel
```

Butuh izin **Manage Server**. Semua perintah membalas ephemeral.

**Alur**

1. `/ticket setup` menyimpan kategori, role staff, dan channel panel, lalu
   mengirim pesan berisi tombol **Buat Tiket**.
2. Member menekan tombolnya → bot membuka modal singkat untuk **mengisi topik
   tiket** (satu text input, 3–45 karakter, wajib diisi).
3. Setelah topik dikirim → bot membuat channel `ticket-0007-sasha` yang hanya
   bisa dilihat dan diketik oleh pembuat tiket dan staff, lalu mengirim embed
   pembuka berisi tombol **Klaim** dan **Tutup Tiket**.
4. Staff menekan **Klaim** → tiket ditandai ditangani staff tersebut.
5. Staff **atau** pembuat tiket menekan **Tutup Tiket** (atau menjalankan
   `/ticket close` di channelnya) → channel diarsipkan: diganti jadi
   `closed-0007` dan dikunci. Isi tiket **tidak dihapus**, jadi riwayatnya masih
   bisa dibaca staff.

**Yang dijamin sistem**

- Topik tiket diminta lewat modal, bukan diketik member di channel: staff tahu
  harus menyiapkan apa sebelum member mengetik pesan pertama. Topik yang hanya
  spasi atau terlalu pendek ditolak **sebelum** tiket tercatat, jadi tidak ada
  tiket dengan topik kosong yang memblokir member membuka tiket baru.
- Konfigurasi server dicek ulang saat modal dikirim, bukan hanya saat modal
  dibuka — di antara keduanya admin bisa saja mematikan modul atau memindahkan
  kategori tiket.
- Satu member hanya boleh punya **satu tiket terbuka**; menekan tombol lagi
  diberi tahu tiket yang sudah ada, bukan dibuatkan duplikat.
- Tombol tutup memakai jalur yang sama dengan `/ticket close`, jadi database dan
  channel tidak mungkin berbeda pendapat: satu sudah tertutup, yang lain masih
  bisa diketik.
- Izin `SendMessages` untuk pembuat tiket ikut dicabut saat penguncian —
  overwrite level member mengalahkan `@everyone`, jadi hanya menolak
  `@everyone` tidak cukup untuk mengunci channel.
- Kalau pembuatan channel gagal, tiket yang sudah tercatat langsung ditutup
  kembali. Tanpa itu tiket "hantu" akan memblokir member membuka tiket baru
  selamanya.
- Channel yang dihapus manual tidak membuat state rusak: tiketnya tetap
  tercatat dan bisa ditutup lewat `/ticket close`.

**Perintah**

| Perintah | Fungsi |
| --- | --- |
| `/ticket setup category staff channel [description]` | Konfigurasi + kirim panel (panel lama dihapus) |
| `/ticket panel` | Kirim ulang panel ke channel panel yang sudah diatur |
| `/ticket list` | Tiket yang masih terbuka (20 terbaru + total) |
| `/ticket close` | Tutup & arsipkan tiket di channel ini |
| `/ticket transcript [ticket]` | Baca transkrip percakapan (staff atau pembuat tiketnya) |

Data tiket disimpan di tabel `ticket` (nomor, pembuat, subjek, status, siapa
yang mengklaim, waktu tutup). Baris yang sudah ditutup dan lewat 12 bulan
dihapus oleh job retensi yang sama dengan kasus moderasi — tiket yang masih
terbuka tidak pernah dihapus diam-diam.

### Transkrip percakapan

Saat tiket ditutup, isi channelnya diambil dan disimpan di kolom `transcript`
pada **baris tiket yang sama**. Berkas `.txt` lengkapnya bisa dibaca lagi
nanti:

```bash
/ticket transcript              # tiket di channel ini (sudah ditutup pun)
/ticket transcript ticket:7     # lewat nomor tiket
```

Yang boleh membaca: **staff tiket** (role staff atau Manage Server) atau **member
yang membuka tiket itu sendiri**. Member lain mendapat penolakan, termasuk yang
memang masih ada di channel itu saat ini — yang tercatat di database hanyalah
`openerId`.

**Kenapa disimpan di baris tiket, bukan tabel terpisah**

Ini keputusan yang tidak bisa dipindah dengan mudah: retensi menghapus baris
tiket, jadi transkrip ikut hilang **di operasi yang sama**. Tidak ada data
percakapan yang bisa tertinggal sebagai baris yatim, dan "hapus tiket = hapus
transkrip" jadi satu fakta, bukan dua hal yang harus dijaga sinkron.

**Yang dijamin sistem**

- Transkrip diambil **sebelum** channel diarsipkan, saat bot pasti masih punya
  akses baca. Diambil setelah penguncian, penyimpangan kecil pada hak akses bot
  bisa membuat transkrip hilang tanpa jejak.
- Kegagalan transkrip **tidak** menggagalkan penutupan: isinya masih ada di
  Discord dan bisa disalin manual staff.
- Maksimal **500 pesan terakhir** per tiket, sisanya ditandai "dipotong" di
  embed dan diberi catatan di akhir file — tidak ada yang mengira
  transkripnya lengkap padahal tidak.
- Hanya pesan berisi teks yang disimpan; pesan sistem (join, pin) dibuang. URL
  lampiran ikut disimpan, filenya sendiri tidak pernah diunduh atau disalin.
- Isi pesan dipotong ke batas 2.000 karakter Discord. Nama yang tersimpan adalah
  nama tampilan **saat pesan dikirim**, bukan nama user sekarang.
- Transkrip tidak pernah ditulis ke disk lokal; hanya dilampirkan ke balasan.

> **Catatan privasi.** Fitur ini membuat bot menyimpan isi percakapan member,
> bukan hanya metadata aksi. Job retensi 12 bulan sekarang ikut menjadi
> kewajiban privasi, bukan sekadar pembersihan database — dan kalau
> `RETENTION_SWEEP_HOURS=0` (cron luar) atau job-nya mati, isi percakapan bisa
> tersimpan jauh lebih lama dari yang dijanjikan.

---

## 10. Perintah Custom (M5, Fase 2)

Balasan admin yang dipanggil member dengan mengetik pemicunya di channel teks:
`!ping` → bot membalas `pong`.

| Perintah | Fungsi | Izin |
| --- | --- | --- |
| `/customcommand list` | Daftar perintah custom di server ini | Manage Server |
| `/customcommand add <nama> <balasan>` | Buat perintah baru, atau ganti balasan yang namanya sama | Manage Server |
| `/customcommand edit <nama> <balasan>` | Ganti isi balasan yang sudah ada | Manage Server |
| `/customcommand delete <nama>` | Hapus perintah | Manage Server |
| `/customcommand show <nama>` | Isi balasan + pratinjau apa yang akan dikirim member | Manage Server |

Modul ini **mati secara default**. Nyalakan lebih dulu:

```
/config set custom-commands:true
```

Setelah itu member mengetik `!nama` (atau `<@bot> !nama`) di channel teks.
`/customcommand` tetap bisa dipakai saat modul mati supaya admin bisa menyiapkan
lebih dulu; `/customcommand list` menyebutkan statusnya di footer.

Placeholder yang bisa dipakai di dalam balasan:

| Placeholder | Isi |
| --- | --- |
| `{pengguna}` | mention pemanggil |
| `{nama}` | nama pengguna pemanggil |
| `{server}` | nama server ini |
| `{channel}` | mention channel tempat dipanggil |
| `{args}` | teks setelah nama perintah |

Yang perlu diketahui:

- **Nama divalidasi saat disimpan, bukan saat dipanggil.** Awalnya huruf,
  maksimal 32 karakter, huruf besar dikecilkan, dan **nama perintah slash yang
  sedang aktif ditolak** — `!play` yang memanggil ke `/play` bukan pintasan,
  hanya membingungkan. Nama yang sudah dipakai diperbarui, bukan dibuat dobel.
- **Placeholder yang tidak dikenal dibiarkan tertulis.** Admin yang mengetik
  `{discord}` akan melihatnya utuh di pesan — jauh lebih mudah menemukan
  salahnya daripada melihat teksnya hilang diam-diam. Kalau balasannya jadi
  kosong setelah placeholder diganti (mis. `{args}` tanpa argumen), bot diam.
- **Jeda 5 detik antar pemicu untuk satu member**, dan saat masih dalam jeda
  bot **tidak membalas apa pun**. Balasan pada pesan biasa tidak bisa
  disembunyikan hanya untuk satu orang, jadi membalas "tunggu N detik" akan
  menumpuk jadi pesan baru tepat di channel yang paling tidak butuh itu.
- **Bot tidak akan pernah benar-benar `@everyone`/`@here`** meski admin
  mengetiknya di dalam balasan.
- **Daftar perintah di-cache per server selama 60 detik**, di store kunci-nilai
  bersama — bukan peta in-memory. Menambah/mengubah/menghapus langsung membuang
  cache, jadi admin tidak menunggu satu menit untuk melihat hasilnya, dan kalau
  Redis hidup perubahannya langsung terlihat di proses lain juga. Cache yang
  hilang bukan masalah: `find()` langsung jatuh ke database, jadi `!perintah`
  hanya membayar satu query tambahan, tidak pernah diam.
- **Privasi §12:** kolom pembuat ikut dihitung di `/privacy` dan diganti pseudonim
  saat `/data-delete`; isi balasannya tetap ada karena bukan tentang orang.

---

## 11. Retensi data

PRD Bab 12 menyatakan data tidak disimpan selamanya. Yang sudah berjalan:

| Data | Retensi | Dihapus oleh |
| --- | --- | --- |
| Kasus moderasi (`moderation_case`) | 12 bulan | Job retensi |
| Peringatan (`warning`) | 12 bulan | Job retensi |
| Tiket tertutup (`ticket`) | 12 bulan sejak ditutup | Job retensi (dalam sapuan yang sama) |
| Transkrip percakapan tiket | ikut tiketnya (12 bulan) | Job retensi, **di operasi yang sama** |
| Riwayat log (`log_entry`) | 30 hari (`expiresAt` per baris) | Job retensi (sapuan terakhir) |

Cara kerjanya:

- Job berjalan **di dalam proses bot** — sekali saat start, lalu setiap
  `RETENTION_SWEEP_HOURS` (default 6). Tidak perlu cron di host, dan otomatis
  ikut berhenti ketika bot berhenti.
- Peringatan dihapus lebih dulu, baru kasusnya (yang menarik peringatan dengan
  `onDelete: Cascade`), sehingga hitungan akurat dan tidak meninggalkan baris
  terlantar.
- `active` bukan syarat: ban yang masih aktif tetap berlaku di Discord, tabel
  kasus hanya arsip audit.
- Sapuan yang lambat tidak ditumpuk, dan kegagalannya hanya jadi peringatan —
  bot tidak crash dan mencoba lagi di siklus berikutnya.
- Menghapus kasus lama **tidak** mengubah nomor kasus baru: nomor selalu
  dihitung dari `MAX(case_number) + 1` per server, bukan dari jumlah baris.
- Menghapus tiket lama **juga** menghapus transkripnya, karena keduanya berada
  di satu baris. Tidak ada tabel transkrip terpisah yang bisa meninggalkan data
  percakapan yatim setelah tiketnya hilang — dan tidak ada cascade yang bisa
  gagal di tengah jalan.

Untuk server yang lebih suka membersihkan dari cron luar, setel
`RETENTION_SWEEP_HOURS=0` lalu jalankan skrip sekali-jalan:

```bash
npm run db:prune
# {"cutoff":"2025-10-02T12:00:00.000Z","casesDeleted":12,"warningsDeleted":7,"logsDeleted":340}
```

Riwayat log disapu paling akhir, di try/catch sendiri: retensinya jauh lebih
pendek (30 hari) dan volumenya jauh lebih besar, jadi menggagalkan penghapusan
kasus karena satu query log lambat akan membuat bot menyimpan data yang sudah
dijanjikan dihapus. `logsDeleted` bernilai `null` kalau sapuan log gagal — lebih
baik menyatakan tidak diketahui daripada melaporkan angka nol yang terlalu optimistis.

Ada dua job terpisah. `panelExpiryJob.ts` menonaktifkan panel reaction
role yang lewat masa hidup setiap `PANEL_EXPIRY_SWEEP_MINUTES` (default 15 menit).
Pisah karena sifatnya berbeda — retensi menghapus baris data, sedangkan job ini
mengubah **pesan di Discord** dan butuh gateway yang sudah login, sehingga
kegagalan totalnya tidak pernah ikut menghapus apa pun. Setel `0` untuk
mematikannya; select menu yang sudah lewat masa hidup tetap ditolak walau
penjadwalan dimatikan. `stayJob.ts` menyambungkan bot kembali ke channel 24/7
setiap `STAY_SWEEP_MINUTES` (default 5 menit) — job ini mengubah koneksi voice
bot, bukan data, jadi kegagalannya tidak pernah menyentuh isi database.

---

## 12. Privasi & permintaan penghapusan data (Bab 12)

### `/privacy` — data yang disimpan tentangmu

Satu perintah, jawaban yang bisa diverifikasi sendiri: berapa kasus moderasi,
berapa peringatan yang masih berlaku, berapa catatan internal, berapa tiket,
dan berapa entri log yang menyebut kamu **di server ini**. Angka nol pun
ditampilkan — "0 catatan" itu informasi, bukan baris yang layak disembunyikan
supaya embed terlihat ramping. Ditambah masa simpan tiap kelompok data dan
daftar hal yang tidak pernah disimpan (isi voice, isi pesan, data di luar
Discord).

Tanpa opsi `user`, perintahnya untuk dirimu sendiri. Dengan `user:<member>`,
butuh izin **Moderate Members** — sama persis dengan `/case`, karena membaca
inventaris orang lain setara dengan membaca kasusnya.

### `/data-delete` — meminta data pribvim dihapus

Dua langkah: jalankan tanpa `confirm:true` untuk melihat proyeksi dampaknya,
lalu ulangi dengan `confirm:true` untuk mengeksekusi. Ini satu-satunya perintah
di bot yang menghapus milik orang, jadi harus dibaca pemohon dulu sebelum
berjalan — bukan dilaporkan sesudahnya.

Yang bot lakukan per member, per server:

| Data | Yang dilakukan |
| --- | --- |
| Kasus moderasi & catatan internal | ID target diganti pseudonim (`anon:…`), isi alasan/catatan diganti penanda |
| Peringatan | Sama seperti kasusnya (baris peringatan ikut dilepas) |
| Tiket | ID pembuka diganti pseudonim, topik diganti penanda, **transkrip dihapus** |
| Entri log | **Dihapus seluruhnya** (sebagai target maupun pelaku) |
| Rekaman Discord | Tidak menyentuh — bot tidak memiliki data di luar database-nya sendiri |

Yang **tidak** dihapus: kerangka kasusnya — tipe aksi, kapan terjadi, moderator
mana yang bertindak, masih aktif atau tidak. Alasannya bukan sekadar mengganti
kata di PRD: moderator sering perlu tahu bahwa seorang member pernah diberi
peringatan tiga kali lalu di-ban, dan menghapus jejaknya sepenuhnya membuat
keputusan berikutnya berjalan tanpa konteks. Yang tidak bisa dipertahankan
adalah mengaitkan semua itu kembali ke orangnya. Embed hasilnya menyatakan ini
dengan eksplisit supaya tidak ada yang mengira permintaannya sudah tuntas.

Tindakan yang **kamu** lakukan sebagai moderator tidak ikut berubah — itu
catatan tanggung jawabmu di server ini. Permintaan atas nama orang lain butuh
izin **Manage Server** (bukan Moderate Members: menghapus bersifat merusak),
dan selalu dicatat ke channel log server dengan pelaku dan targetnya terlihat.

**Pengulangan aman.** Pseudonim dihitung stabil dari `guildId:userId`, dan
pencarian selalu ikut mencocokkan pseudonim itu. Jadi menjalankan `/data-delete`
dua kali tidak akan membuat identitas kedua untuk orang yang sama, dan
permintaan kedua tetap menemukan baris yang sudah dianonimkan alih-alih
melaporkan "tidak ada data" padahal datanya masih ada.

Kalau ada modul yang gagal di tengah, perintahnya **melempar** dan bilang
terbuka — bukan melaporkan "selesai" sementara masih ada data yang bisa
ditelusuri. Dua modul yang sudah berhasil tidak dibatalkan, jadi jalankan lagi
untuk menyelesaikan sisanya.

---

## 13. Struktur proyek

```
prisma/
├─ schema.prisma            # model database (sumber kebenaran skema)
├─ migrations/              # migrasi SQL yang bisa diaudit
└─ seed?                    # (belum ada — belum dibutuhkan)

src/
├─ commands/
│  ├─ core/                 # /ping, /help, /config, /setup         (M0–M1 ✅)
│  ├─ music/                # /play, /queue, /nowplaying, /skip, /247,
│  │                        # /pause, /resume, /stop + _shared.ts   (M2 ✅)
│  └─ admin/                # /ban … /note, /case (M3 ✅), /automod, /logging, /logs (M4 ✅)
│                           # _shared.ts berisi gate & alur aksi bersama
├─ events/                  # satu file = satu event Discord
│  └─ logging/              # 22 event → embed 6 kategori (M4 ✅)
│  # messageCreateCustomCommand.ts = pemicu !nama; listen ke event yang sama
│  # dengan automod, sengaja terpisah supaya tidak saling memblokir
├─ handlers/                # loader perintah, event, & router komponen (auto-discovery)
├─ modules/
│  ├─ config/               # konfigurasi per-server (M1 ✅)
│  ├─ music/                # antrean, pemutar Lavalink, izin musik (M2 ✅)
│  │                        # queue.ts, idleTimer.ts, musicService.ts, track.ts
│  │                        # searchSession.ts = state /search di store bersama, searchSelect.ts = pilihannya
│  │                        # searchSessionCodec.ts = serialisasi session (toleran terhadap data rusak)
│  │                        # limits.ts = batas durasi track §6.2 (6 jam & >30 menit butuh DJ)
│  │                        # stay.ts = aturan mode 24/7 (murni), stayService.ts = penerapan
│  │                        # queuePage.ts = pagination antrean (murni), queueNav.ts = tombol navigasi
│  │                        # sharedState.ts = antrean + mode loop di store bersama (§5.3)
│  │                        # sharedStateCodec.ts = serialisasinya (toleran: rusak = antrean kosong)
│  │                        # nodes.ts = parser LAVALINK_NODES multi-node & laporan status node
│  ├─ stats/                # statistik playback & perintah (Fase 3 §5.3)
│  │                        # day.ts = bucket UTC, aggregate.ts = leaderboard & grafik (murni)
│  │                        # validation.ts = kunci/lagu, retention.ts = batas 90 hari
│  ├─ lyrics/               # lirik LRCLIB + cadangan Genius (Fase 2 ✅)
│  │                        # lrc.ts = parser LRC & baris aktif, query.ts = judul + HTML Genius
│  │                        # service.ts = sumber lirik + cache, embeds.ts = tampilan
│  ├─ spotify/               # metadata Spotify untuk /play (Fase 2 ✅)
│  │                        # parse.ts = tautan, match.ts = pencocokan ke hasil Lavalink
│  │                        # service.ts = token client-credentials + HTTP, bridge.ts = orkestrasi
│  ├─ health/                # endpoint /health, /ready & /metrics untuk monitoring (PRD §5.1 & §11 ✅)
│  ├─ metrics/               # penghitung metrik proses (PRD §11 ✅)
  ├─ i18n/                  # bahasa server ID/EN (PRD §5.3)
  │                        # types.ts = locale & alias, catalog.ts = teks runtime
  │                        # commandTranslations.ts = nama & deskripsi perintah
  │                        # applyTranslations.ts = penyisip ke payload deploy
  │                        # service.ts = bahasa per server (cache 30 detik)
│  │                        # registry.ts = counter, format.ts = teks Prometheus, probe.ts = latensi Lavalink
│  │                        # report.ts = aturan status (murni), server.ts = HTTP-nya
│  ├─ customcommands/        # balasan admin yang dipanggil !nama (Fase 2 ✅)
│  │                        # trigger.ts = parser pemicu & placeholder, validation.ts = nama & isi
│  │                        # service.ts = CRUD + cache per server di store bersama (60 detik)
│  │                        # cacheCodec.ts = serialisasi cache (toleran terhadap data rusak)
│  ├─ moderation/           # kasus, warning, hierarki, greeting      (M3 ✅)
│  │                        # caseLink.ts menjembatani aksi ↔ event Discord
│  │                        # caseView.ts = isi halaman /case
│  │                        # modProfile.ts = statistik & isi halaman /modprofile
│  ├─ automod/              # engine 7 rule + tracker state          (M4 ✅)
│  ├─ logging/              # routing channel per kategori + diff/audit helper (M4 ✅)
│  │                        # searchQuery.ts, summary.ts, record.ts untuk riwayat log
│  │                        # stats.ts = agregasi /logs stats:true (groupBy Prisma)
│  ├─ reactionroles/        # panel self-assign role via select menu (M5 ✅)
│  │                        # select.ts = handler saat member memilih role
│  │                        # expire.ts = lepas select menu saat panel berakhir
│  └─ tickets/              # tiket: channel privat, klaim, arsip (M5 ✅)
│                           # lifecycle.ts = buat channel privat, kunci saat tutup, simpan transkrip
│                           # transcript.ts = ambil isi channel & susun file .txt
├─ services/                # logger, Prisma client, deteksi error database
│                           # retentionJob.ts = pembersihan data berkala
│                           # panelExpiryJob.ts = matikan panel reaction role lewat masa hidup
│                           # stayJob.ts = jaga channel 24/7 tiap server (PRD §5.2)
│                           # kvStore.ts = store kunci-nilai (Redis atau memori): rate limit,
│                           #   cache perintah custom, dan session /search
├─ utils/                   # cooldown, embed, durasi, izin, module loader
├─ config/                  # env (zod) + konstanta
├─ generated/               # Prisma Client hasil generate — JANGAN diedit, tidak di-commit
├─ client.ts                # BotClient: intents + registry perintah
├─ deploy-commands.ts       # daftarkan slash command ke Discord
├─ prune-retention.ts       # sekali-jalan: bersihkan data kedaluwarsa (cron)
└─ index.ts                 # entrypoint + graceful shutdown

tests/                      # unit test vitest; setup.ts menyetel env minimal
tsconfig.test.json          # typecheck untuk src/ + tests/
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

### Rate limit

Dua lapis (§16 PRD), keduanya lewat store kunci-nilai bersama:

| Lapis | Kunci | Default | Konfigurasi |
| --- | --- | --- | --- |
| Slash command | `user:nama-perintah` | per perintah | `cooldownSeconds` pada file perintah |
| Komponen (tombol/select/modal) | `user + jenis + prefix fitur` | 3 detik | `cooldownSeconds` pada handler di [componentRouter.ts](src/handlers/componentRouter.ts) |

Prinsipnya sama untuk keduanya: klik/ketikan berulang yang cepat dibalas pesan
privat berisi sisa detik dan **tidak pernah sampai ke handler** — spam tombol
tiket tidak mengubah database, spam select menu tidak mengirim puluhan
panggilan ke Discord API. Yang penting soal kunci komponen: ia memakai
**awalan fitur, bukan customId penuh**. Token `/search` berubah di setiap
pencarian; kalau customId penuh yang dipakai, setiap klik mendapat bucket
kosong dan rate limit-nya tidak pernah berbunyi.

Tombol tiket diberi 5 detik (membuat/menutup channel itu mahal), select menu
reaction role dan pencarian 3 detik. Perintah tanpa `cooldownSeconds` tidak
dikenai apa-apa; `/play` memakai 10 detik sesuai PRD §6.2.

**Sekarang keduanya lewat store kunci-nilai bersama**, bukan peta in-memory: kalau
Redis hidup, cooldown berlaku lintas proses (§9.4 & §5.3). Redis sejak awal sudah
ada di `docker-compose.yml` dan `REDIS_URL` sudah jadi env yang wajib, tapi
sebelum ini tidak satu baris kode pun memakainya — bot menuntut infrastruktur
yang tidak pernah disentuh. Sekarang ada dua implementasi di balik satu
antarmuka: [kvStore.ts](src/services/kvStore.ts) (Redis) dan memori.

Empat hal yang perlu diketahui soal pilihan ini:

- **Redis mati tidak mematikan bot.** `createKeyValueStore()` mencoba sebentar lalu
  jatuh ke store memori dengan peringatan di log yang menyebut konsekuensinya
  (rate limit kembali per proses, sharding belum aman). Mati total karena cache
  tidak tersedia lebih buruk daripada berjalan tanpa rate limit lintas proses
  selama beberapa menit.
- **Kesalahan store saat cooldown dicek tidak membuat perintah gagal.** Cooldown
  dihitung dari store memori cadangan, jadi perlindungannya tetap ada. Konsekuensinya
  jujur: satu pemakaian tambahan boleh lolos sesaat setelah Redis sempat putus.
- **TTL dikirim sebagai milidetik (`PX`).** Pembulatan ke detik membuat rate limit
  2 detik jadi 3, dan orang merasa aturannya tidak berlaku.
- **Yang disimpan adalah waktu berakhir mutlak**, bukan sisa relatif — supaya
  pesan "tunggu N detik" benar, bukan angka yang tidak pernah berkurang. TTL di
  sisi store tetap dipasang supaya key hilang tepat saat jendela habis.

**Yang sudah pindah ke store bersama:** rate limit, cache daftar perintah custom,
session `/search` (termasuk klaim sekali pakainya), dan **antrean musik** —
serta `take()` dan `compareAndSet()`, dua operasi yang benar-benar atomik di
Redis dan tidak bisa ditiru dengan GET lalu SET.

### Antrean musik di store bersama

Dulu antrean ada di dua `Map` di dalam [musicService.ts](src/modules/music/musicService.ts):
lagu yang belum diputar dan mode loop. Keduanya hilang saat bot restart dan
tidak terlihat oleh shard lain, jadi guild yang ditangani dua shard akan melihat
antrean berbeda tergantung shard mana yang menjawab. Sekarang keduanya lewat
[sharedState.ts](src/modules/music/sharedState.ts), satu record per guild dengan
TTL 12 jam.

Yang dipindahkan adalah bagian state yang **benar-benar boleh dibagi**. Player
Lavalink, koneksi voice, lagu yang sedang diputar, posisi, filter, dan riwayat
siklus tetap milik satu proses — koneksi voice cuma bisa dipegang satu proses,
jadi memindahkannya ke store tidak akan membuat dua proses bisa memutar lagu
yang sama. Yang harus diperbaiki adalah antreannya, supaya proses lain tidak
lagi menampilkan "antrean kosong" padahal isinya ada.

Lima aturan yang perlu diketahui:

- **Setiap perubahan membaca dulu, baru menulis.** Jadi penambahan dari proses
  lain ikut terbaca dan tidak hilang diam-diam.
- **Penulisannya bersyarat dan atomik.** Sebelum menulis, bot cek bahwa nilai di
  store masih persis sama dengan yang tadi dibaca; kalau ada proses lain yang
  menyisip duluan, perubahan itu **dibaca ulang dan diterapkan di atasnya**, bukan
  menimpanya. Di Redis ini satu skrip Lua (`compareAndSet` di [kvStore.ts](src/services/kvStore.ts)),
  jadi tidak ada jeda antara membaca dan menulis. Maksimal tiga percobaan; kalau
  masih berebut, perubahan hanya berlaku di proses itu dan dicatat di log —
  memaksa penulisan di titik itu berarti menimpa orang lain.
- **Baca yang gagal berarti jangan tulis.** Perubahan tetap berjalan di salinan
  lokal, tapi tidak menimpa record yang tidak bisa dibaca — menebak-nebak di atas
  state orang lain lebih merusak daripada kehilangan satu perubahan.
- **Record yang tidak berubah tidak ditulis ulang**, supaya lagu yang berakhir
  dengan antrean kosong tidak membanjiri store dengan record identik.
- **Tanpa `EVAL`, jaminan ini hilang.** Redis sangat lama (dan beberapa klien
  tiruan) tidak punya `EVAL`; store lalu turun ke baca-lalu-tulis biasa dan
  **menyinggirkan batas itu di log**, bukan diam-diam berpura-pura atomik.

Serialization-nya ada di [sharedStateCodec.ts](src/modules/music/sharedStateCodec.ts)
dan **toleran**: JSON rusak dibaca sebagai antrean kosong, bukan error. Berbeda
dengan session `/search` yang dibuang seluruhnya, di sini keadaan kosong selalu
benar dan selalu bisa dipulihkan — user mengetik `/play` lagi. Membatalkan
pemutaran yang sedang berjalan demi satu baris JSON yang salah baca adalah
kerugian yang jauh lebih besar daripada mengulang satu lagu. Satu track salah
bentuk cukup dilewati, bukan membatalkan seluruh antrean.

**Multi-node Lavalink** juga sudah memakai store bersama ini — lihat bagian
[Multi-node Lavalink](#multi-node-lavalink).

**Sharding sendiri masih belum boleh diaktifkan**, tapi blokernya tinggal satu:
player Lavalink, yang emang hanya bisa dipegang satu proses karena koneksi voice
begitu. Yang sudah beres adalah state yang boleh dibagi — antrean, mode loop,
cooldown, cache, session — dan penulisan yang raced tidak lagi saling menimpa.
Yang belum: `ShardManager` benar-benar dipakai saat `DISCORD_MAX_SHARDS > 1`,
dan penjadwalan job per shard.

### Cakupan tes

`npm run test:coverage` mengukur `src/` (laporan teks + HTML di `coverage/`,
yang tidak di-commit). Angka saat ini: **~57,0% statements** dari **1.318 tes di 70
file** (naik dari ~43% waktu playlist, filter, lirik, health check, statistik,
store bersama, metrik, state musik bersama, multi-node Lavalink, penulisan
atomik, dan multi-bahasa).

Pembacaannya perlu jujur: setengah yang belum tercover adalah **lapisan lem** —
fungsi `execute` 46 perintah, repository Prisma, dan barrel `index.ts` — yang
sengaja dibuat tipis dan hanya bisa diuji dengan Discord/Postgres yang hidup.
Logika inti justru tercover tinggi: mesin automod, mapping & hierarki
moderasi, agregasi log, loop/posisi/shuffle/filter musik, parser lirik, privasi,
dan validasi tiket semuanya di atas 90%, begitu juga perhitungan statistik
per server, perhitungan halaman antrean, session `/search` (97% termasuk jalur
gagal store), modul metrik (98%), modul health (94%), modul i18n (98%), modul
moderasi (84%), modul logging (72%), modul privasi (95%), dan kedua
implementasi store. Menaikkan angka global dengan mem-bypass lapisan lem
lewat mock besar akan menguji mock itu sendiri, bukan bot.
---

## 14. Perintah npm

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
| `npm run db:prune` | Sekali jalan: hapus kasus, peringatan & riwayat log yang lewat retensi (cron) |
| `npm run typecheck` | TypeScript strict tanpa emit — mencakup `src/` dan `tests/` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm test` / `test:watch` | Vitest |
| `npm run test:coverage` | Vitest + laporan coverage v8 (teks + HTML di `coverage/`) |

CI (`.github/workflows/ci.yml`) menjalankan lint → typecheck → test → build di
setiap push/PR.

---

## 15. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `Used disallowed intents` | Privileged intents belum aktif di Developer Portal (lihat bagian 1) |
| Pesan “Lavalink belum terhubung” | `docker compose ps` → pastikan `harmony-lavalink` jalan. Plugin diunduh saat start pertama, jadi butuh internet. Cek `docker compose logs lavalink` |
| `Modul perintah tidak valid ...` saat start | Ada file di `src/commands/**` (atau `src/events/**`) tanpa `default export BotCommand` — beri nama diawali `_` atau pindahkan keluar folder itu |
| Bot keluar sendiri dari voice channel | Auto-disconnect setelah `idleTimeoutSec` tanpa lagu. Atur lewat `/config set idle-timeout` |
| Log menyebut "Redis tidak bisa dihubungi" | Bot tetap jalan dengan store memori: rate limit berlaku per proses dan sharding belum aman. Periksa `docker compose ps redis` atau `REDIS_URL` di `.env` |
| Tombol halaman antrean tidak bereaksi | Pesan `/queue` yang lama tidak bisa diubah Discord (interaksi hanya berlaku 15 menit). Jalankan `/queue` lagi untuk dapat tombol baru; antrean sendiri tidak hilang |
| `/stats` selalu nol padahal ada yang sering `/play` | Baris statistik hanya terbentuk setelah **lagu selesai berbunyi** minimal 10 detik, dan hanya di server yang sama. Kalau tetap nol, cek log untuk pesan `Gagal menyimpan statistik playback` (biasanya database sedang bermasalah) |
| Mode 24/7 aktif tapi bot tidak ada di channel | `/247 status` akan menyebut alasannya. Yang paling sering: bot sedang memutar di channel lain (perpindahan menunggu lagu selesai), channel dihapus admin, atau bot kehilangan izin **Connect**/**Speak** di channel itu |
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

### Permintaan takedown (PRD §15)

Sumber audio (YouTube lewat Lavalink) adalah bagian yang paling mungkin
meneruskan permintaan penghak cipta. Prosedur di bot ini, dengan target
**< 48 jam**:

1. **Catat permintaan** di issue/tiket internal: URL sumber, Judul, hak cipta
   yang diklaim,  dan lamanya. Bot tidak menyimpan data member soal ini.
2. **Nonaktifkan sumbernya** di sisi Lavalink: hapus plugin terkait dari
   [docker-compose.yml](docker-compose.yml) (mis. `youtube-source`), lalu
   `docker compose up -d lavalink`. Bot otomatis melapor "Lavalink belum
   terhubung" untuk `/play` — pesan itu memang sudah menjelaskan ke user.
3. **Kalau hanya satu lagu/penyanyi** yang diklaim, nonaktifkan **modul musik**
   server terkait lewat `/config set music:false` daripada mematikan bot
   seutuhnya — moderasi, tiket, dan logging tetap berjalan.
4. **Jawab pemohon** dengan apa yang berubah, kapan, dan kontak lanjutan.

Sebelum rilis publik, isi alamat kontak takedown di metadata bot Developer Portal
dan di [PRD.md](PRD.md); jalur ini belum bisa otomatis karena tidak ada sumber
data takedown yang integrasinya pernah diuji.

Lihat juga bagian **Legal, Privasi & Kepatuhan** di PRD — sumber audio dan
kewajiban takedown bukan detail teknis yang bisa ditunda.
