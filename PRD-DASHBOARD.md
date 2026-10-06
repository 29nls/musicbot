# PRD — Web Dashboard Harmony (Next.js)

| Field | Value |
| --- | --- |
| Dokumen induk | [PRD.md](PRD.md) §5.3 Fase 3 |
| Versi | v0.1 (rancangan, belum ada kode) |
| Tanggal | 4 Oktober 2026 |
| Status | Menunggu keputusan §4.2 |
| Penulis | Buffy |

> **Batas dokumen ini, ditulis lebih dulu supaya tidak disalahartikan.**
> Ini rancangan, bukan laporan. Tidak ada Next.js yang terpasang, tidak ada
> container yang dibangun, tidak ada baris kode dashboard yang ditulis. Isinya
> pemetaan kebutuhan terhadap kode yang benar-benar ada di repo ini, ditambah
> delapan keputusan arsitektur yang harus dijawab sebelum implementasi dimulai.
> Semua temuan di §4.1 berasal dari membaca kode, bukan menjalankannya. Tidak ada
> Redis, PostgreSQL, Lavalink, maupun token Discord yang pernah hidup di
> lingkungan penulisan dokumen ini.

---

## 1. Ringkasan Eksekutif

### 1.1 Masalah

Pemilik server harus membuka Discord lalu mengetik `/setup` atau `/config set`
untuk mengubah satu nilai. Satu perubahan berarti: ketik command, tunggu
balasan, baca embed. Perubahan yang lebih besar, misalnya mematikan lima modul
sekaligus, harus diulang lima kali, dan tiap perintah bisa gagal dengan alasan
yang berbeda.

Akibatnya konfigurasi bot yang benar jarang dipakai di server dengan lebih dari
satu moderator. PRD §3.1 G4 menyebut "user baru bisa memutar lagu dalam < 3
perintah" sebagai target. Target itu sudah tercapai lewat `/play`. Yang belum
adalah biaya pengubahan konfigurasi.

### 1.2 Solusi yang diusulkan

Aplikasi web Next.js yang melakukan dua hal, dan hanya dua hal:

1. **Menampilkan konfigurasi server saat ini** dalam satu halaman, dengan
   bahasa yang mengikuti `guild_config.locale`.
2. **Mengubah bagian `guild_config`** yang persis sama dengan yang bisa diubah
   lewat `/config set` dan `/setup`.

Segala sesuatu yang lain tidak masuk v1. Alasannya bukan soal hemat waktu:
setiap permukaan tambahan adalah permukaan data pribadi baru yang harus ikut
PRD §12, dan itu tidak layak ditambahkan sebelum dasarnya benar.

### 1.3 Kriteria sukses

| # | Kriteria | Cara ukur | Target |
| --- | --- | --- | --- |
| SC-1 | Perubahan dari dashboard berlaku tanpa restart bot | Ubah `defaultVolume` dari 100 ke 40, lalu jalankan `/volume` di Discord | Nilai baru berlaku ≤ 2 detik, p95 ≤ 5 detik, pada 100% percobaan |
| SC-2 | Paritas field dengan `/config` | Daftar field di §4.6 dibandingkan dengan [config.ts](src/commands/core/config.ts) | Selisih 0 field, dijaga tes yang membandingkan kedua daftar |
| SC-3 | Tidak ada tulis tanpa izin yang sah | 3 skenario negatif di §2.4 | 0 penulisan berhasil tanpa Manage Server yang masih berlaku saat permintaan dilayani |
| SC-4 | Waktu muat halaman konfigurasi | p95 di VPS 2 vCPU / 2 GB, Supabase seberang | ≤ 800 ms server-render, LCP ≤ 2,0 detik |
| SC-5 | Tidak ada kebocoran antar server | 2 akun di 2 guild, satu mencoba akses silang | 0 data lintas-guild terbaca, 100% ditolak 403 |
| SC-6 | Cakupan tes modul dashboard | `vitest run --coverage` untuk `dashboard/` | Modul validasi dan otorisasi ≥ 90% statements |

SC-1 yang paling menentukan. Ia satu-satunya kriteria yang membuktikan
dashboard ini bukan tampilan saja.

---

## 2. User Experience & Functionality

### 2.1 Persona

| Persona | Kebutuhan | Yang berubah dengan dashboard |
| --- | --- | --- |
| **Rian, pemilik server** | Setup cepat, satu tempat, tidak hafal semua nama opsi | Semua channel dan role yang terhubung terlihat dalam satu layar, tanpa menggali `/config show` |
| **Dita, moderator** | Tidak salah mengubah pengaturan | Field ber-impact tinggi meminta konfirmasi, dan tiap perubahan menampilkan nilai lama dan nilai baru |
| **Sari, developer** | Arsitektur jelas, mudah di-fork | Satu layanan tambahan yang tidak menahan bot kalau mati |

Persona yang tidak mendapat manfaat: **Bagas**, anggota biasa. PRD §4
menggambarkan dia sebagai penikmat musik. Dashboard bukan untuk dia.

### 2.2 Alur pengguna

```
Masuk
  -> pilih server (guild dari OAuth, hanya yang bot-nya ada)
  -> lihat halaman konfigurasi (semua field, bahasa server)
  -> ubah satu atau beberapa field
  -> konfirmasi untuk field ber-impact tinggi
  -> simpan
  -> konfirmasi berhasil, menampilkan nilai lama, nilai baru, dan waktu berlaku
```

Setelah Discord OAuth, guild yang dipilih menentukan halaman. Server tidak bisa
dipindah dari dalam aplikasi kecuali mengulang OAuth. Ini disengaja: memindahkan
satu browser ke server lain adalah cara paling umum untuk menulis ke server yang
salah.

### 2.3 User stories dan acceptance criteria

**US-D1, melihat konfigurasi**

> Sebagai pemilik server, saya ingin melihat seluruh konfigurasi bot dalam satu
> halaman agar tidak perlu menggali `/config show` tiap kali mencari satu nilai.

- **AC:** Halaman menampilkan seluruh field `guild_config` yang relevan, dalam
  bahasa `guild_config.locale`, bukan bahasa peramban.
- **AC:** Nilai kosong (null) tampil sebagai kosong yang eksplisit, bukan sebagai
  celah yang bisa disalahartikan sebagai belum termuat.
- **AC:** Channel dan role ditampilkan memakai nama di server, bukan ID-nya.
  Orang yang mengatur konfigurasi mengenali namanya dan tidak mengenali ID-nya.
  Kalau nama tidak bisa diambil, tampilkan ID dengan penanda.
- **AC:** Saat Discord sedang tidak bisa dihubungi, halaman tetap terbuka:
  nama ditampilkan sebagai ID dengan penanda, dan halaman tidak gagal total.

**US-D2, mengubah konfigurasi**

> Sebagai pemilik server, saya ingin mengubah pengaturan dari peramban agar tidak
> harus mengetik command untuk tiap nilai.

- **AC:** Daftar field yang bisa diubah identik dengan `/config set`. Lihat
  tabel paritas di §4.6. Tidak ada field tambahan, tidak ada field kurang.
- **AC:** Validasi memakai aturan yang sama dengan bot: `defaultVolume` 0 sampai
  200, `idleTimeoutSec` 30 sampai 86400, `welcomeMessage` dan `goodbyeMessage`
  maksimal 1500 karakter, dan hanya channel atau role dari server ini yang
  diterima.
- **AC:** Nilai tidak valid ditolak sebelum dikirim ke database, dengan pesan yang
  menyebut batasnya dalam bahasa server.
- **AC:** Setelah berhasil, halaman menampilkan nilai lama, nilai baru, dan waktu
  berlaku.
- **AC:** Perubahan beberapa field sekaligus disimpan sebagai satu transaksi.
  Tidak ada keadaan setengah tertulis.

**US-D3, melindungi dari perubahan yang tidak sengaja**

> Sebagai pemilik server, saya ingin perubahan ber-impact tinggi meminta
> konfirmasi agar tidak mematikan bot saya karena satu klik.

- **AC:** Field berikut meminta konfirmasi eksplisit: `djRoleId`, `autoroleId`,
  `autoroleBotId`, `stayChannelId`, `logChannelId`, dan setiap `modules.*` yang
  menjadi `false`. Alasannya masing-masing. Tiga yang pertama mengubah siapa yang
  boleh mengendalikan musik, atau apa yang terjadi saat member baru bergabung.
  `logChannelId` mengarahkan seluruh riwayat audit ke tempat lain. Modul yang
  dimatikan langsung menghentikan pemrosesan pesan atau pembuatan tiket.
- **AC:** Dialog konfirmasi menyebut nilai lama dengan kalimatnya, bukan hanya
  nama field.

**US-D4, meninggalkan jejak perubahan**

> Sebagai pemilik server, saya ingin tahu siapa mengubah apa dan kapan agar
> perubahan konfigurasi bisa dipertanggungjawabkan seperti perubahan
> moderasi.

- **AC:** Setiap penulisan tercatat sebagai entri `log_entry` kategori `server`,
  dengan `executor_id` = user Discord yang menandatangani lewat OAuth, bukan
  token bot.
- **AC:** Entri itu muncul di `/logs` di Discord dengan executor yang benar.
- **AC:** Nilai lama ikut tersimpan di ringkasan. Perubahan dari 100 ke 40 jauh
  lebih berguna dicatat daripada perubahan ke 40 saja.

**US-D5, bot tetap jalan tanpa dashboard**

> Sebagai pemilik server, saya ingin dashboard mati tidak membuat bot mati.

- **AC:** Bot tidak tahu dan tidak peduli apakah dashboard hidup. Menghentikan
  layanan `dashboard` di compose tidak mengubah perilaku `/config`.
- **AC:** Nilai yang sudah ada di `guild_config` tetap dibaca bot dengan validasi
  bot sendiri, apa pun yang terjadi di dashboard.

### 2.4 Skenario keamanan yang harus ditolak

| Skenario | Hasil yang diharapkan |
| --- | --- |
| User kehilangan Manage Server setelah memberi izin OAuth | Ditolak pada setiap penulisan, bukan hanya saat login. Izin dicek ulang lewat token bot ke `GET /guilds/{id}/members/{userId}` |
| User mengarang `guildId` di body permintaan | Ditolak 403. Tidak ada kueri database yang memakai `guildId` dari body tanpa verifikasi keanggotaan |
| Dashboard diberi `logChannelId` milik guild lain | Ditolak saat validasi, sebelum menulis |
| Token OAuth kedaluwarsa atau dicabut | Sesi berakhir dengan pesan jelas, bukan error 500 |
| Dua orang menyunting field berbeda bersamaan | Penulisan terakhir menang per field, dan halaman menampilkan nilai yang benar-benar tersimpan, bukan yang diketik |
| Percobaan otomatis 100 kali per detik dari satu akun | Dibatasi. Lihat §4.5 |

### 2.5 Non-goals v1

Semua hal berikut tidak dibangun. Batas ini melindungi privasi dan keutuhan,
bukan sekadar menghemat waktu:

- Melihat atau mengubah data member: kasus moderasi, peringatan, catatan,
  tiket, transkrip, entri log, playlist.
- Memutar atau mengatur musik dari web.
- Membuat panel reaction role, tiket, atau perintah custom dari web.
- Mengatur rule automod dan routing log, meski tabel `automod_rule` dan
  `guild_log_subscription` terlihat mirip `guild_config`. Keduanya punya bentuk
  JSON dan aturan sendiri, jadi keduanya tidak masuk v1.
- Statistik dan grafik `/stats`.
- Manajemen invite, peran server, atau channel di luar milik bot.
- Aplikasi mobile, notifikasi, atau mode banyak pengguna per server.

Yang wajib tetap berlaku: dashboard tidak membaca atau menulis `guild_config`
milik guild yang penggunanya tidak punya Manage Server saat permintaan dilayani.

---

## 3. AI System Requirements

**Tidak berlaku.** Tidak ada model, inferensi, embedding, atau evaluasi output
di dalam dashboard. Ini murni form yang membaca dan menulis baris konfigurasi.

Ini disebut eksplisit supaya tidak ada anggapan bahwa "dashboard AI" berarti
sesuatu yang tidak dijelaskan di sini. Kalau nanti ada fitur yang menghasilkan
rekomendasi atau ringkasan otomatis, fitur itu masuk lewat revisi dokumen ini dan
wajib mendapat bagian evaluasi tersendiri.

---

## 4. Technical Specifications

### 4.1 Architecture Overview

#### 4.1.1 Keadaan repo yang relevan

Lima fakta dari kode yang menentukan bentuk rancangan ini. Dua di
antaranya diperbarui setelah implementasi (baris tanpa tanda adalah
fakta asli saat dokumen ditulis) — lihat Lampiran C:

| Fakta | Lokasi | Kenapa menentukan |
| --- | --- | --- |
| Cache konfigurasi bertahan 60 detik per proses | [guildConfigService.ts:48](src/modules/config/guildConfigService.ts#L48) | Perubahan dari luar proses baru terlihat paling lama 60 detik |
| `invalidate(guildId?)` sudah ada; kini dipanggil lintas proses untuk kelima cache lewat `invalidationWiring.ts` | [guildConfigService.ts:106](src/modules/config/guildConfigService.ts#L106), [invalidationWiring.ts](src/modules/config/invalidationWiring.ts) | Hook-nya sudah disiapkan tepat untuk kasus ini; pemanggilnya dipasang bersama dashboard (D2) |
| `KeyValueStore` punya `publish` dan `subscribe` **opsional**; `RedisKeyValueStore` mengimplementasikan keduanya dengan koneksi langganan terpisah | [kvStore.ts:86](src/services/kvStore.ts#L86) | Kanal invalidasi lintas proses sudah ada, dan bot memakainya sejak D2 terimplementasi |
| Bot tidak punya permukaan HTTP sama sekali, hanya health check tanpa autentikasi | [health/server.ts](src/modules/health/server.ts) | Dashboard harus membuat jalur komunikasinya sendiri |
| Database adalah Supabase, bukan container di stack ini; `DATABASE_URL` plus `DIRECT_URL` | [docker-compose.yml](docker-compose.yml) | Dashboard butuh kredensial database, dan itu kredensial produksi |

Ada satu titik positif yang layak dicatat: `GuildConfigService` sudah punya
`invalidate(guildId?)` dengan komentar "dipakai setelah perubahan dari luar
proses ini". Saat PRD ini ditulis itu baru prasyarat; kini hook itu benar-benar
dipakai — kelima cache dibuang lewat `invalidationWiring.ts` setiap kali pesan
`harmony:config:changed` datang (D2).

#### 4.1.2 Cache yang akan menjadi basi

Kalau dashboard menulis langsung ke database, lima cache di proses bot tidak ikut
tahu. Masing-masing milik tiap proses shard, jadi di dua shard ada dua
salinan.

| Cache | Umur | Berkas |
| --- | --- | --- |
| Konfigurasi guild | 60 detik | [guildConfigService.ts](src/modules/config/guildConfigService.ts) |
| Bahasa server (locale) | 30 detik | [i18n/service.ts](src/modules/i18n/service.ts) |
| Rule automod | per server | [automod/service.ts](src/modules/automod/service.ts) |
| Routing log | per server | [logging/service.ts](src/modules/logging/service.ts) |
| Daftar perintah custom | 60 detik | [customcommands/service.ts](src/modules/customcommands/service.ts) |

Ini bisa diperbaiki dengan invalidasi lintas proses, atau dikurangi dengan TTL
pendek. Keduanya punya harga, dan harganya berbeda (§4.2, D2).

#### 4.1.3 Bentuk yang usulan

```
                    +---------------------------+
                    |  Discord OAuth2 (authorize)|
                    +------------+--------------+
                                 | token user
                                 v
+------------------+   guildId   +---------------------------+
|  Peramban        +------------->|  Dashboard Next.js        |
|  (halaman config)|              |  - Server Component        |
+------------------+               |  - Route Handler /api      |
                                  |  - Otorisasi Manage Server |
                                  +-----+-------------+--------+
                                        |             |
                       Prisma (baca + tulis)          | publish config:changed
                                        v             v
                              +--------------+   +--------------+
                              |  Supabase    |   |  Redis        |
                              |  PostgreSQL  |   |  (KeyValueStore)|
                              +--------------+   +-------+--------+
                                                          |
                            +-----------------------------+--- subscribe
                            v                                v
                    +----------------+              +----------------+
                    | proses shard 0 |              | proses shard N |
                    | buang cache   |              | buang cache    |
                    +----------------+              +----------------+
```

Bot **tidak** berubah sama sekali selain tambahan satu langganan pada `RedisKeyValueStore` — dan itu sudah terimplementasi: `src/index.ts` berlangganan kanal `harmony:config:changed` saat start dan berhenti berlangganan saat shutdown. Tidak ada HTTP API di bot, tidak ada endpoint baru di proses bot, tidak ada cara dashboard memanggil bot.

### 4.2 Keputusan arsitektur yang harus diambil sebelum menulis kode

Delapan keputusan. Yang ditandai **MENGHAMBAT** tidak boleh mulai ditulis
kodenya sebelum dijawab, karena membangun ulang setelah salah jawaban jauh lebih
mahal daripada menjawab sekarang.

---

#### D1. Siapa yang menulis ke database? — **MENGHAMBAT**

| Opsi | Bentuk | Yang terjadi |
| --- | --- | --- |
| A | Dashboard bicara Prisma langsung ke Supabase | Satu penulis. Bot jadi pembaca. |
| B | Dashboard bicara HTTP API di dalam proses bot | Bot jadi satu-satunya penulis. |
| C | Service API terpisah, bot dan dashboard dua klien | Tiga layanan, logika bisnis terpecah tiga tempat. |

**Rekomendasi: A.**

Opsi B kedengarannya paling rapi karena logika bisnis tetap di satu tempat, tapi ia
tidak menyelesaikan masalah yang sebenarnya. Dengan sharding, proses bot yang
menerima permintaan HTTP **bukan** proses yang memegang shard guild itu. Jadi
cache di proses penulis bukan cache yang perlu dibuang. Opsi B menambah
permukaan HTTP ke proses yang sekarang sengaja tidak punya permukaan HTTP,
dan masalah cache tetap ada.

Opsi C menambah layanan ketiga untuk sesuatu yang bentuknya satu tabel dengan 17
kolom. Tidak sepadan.

Konsekuensi A: dashboard harus membawa validasinya sendiri, dan harus menulis
`log_entry` sendiri. Keduanya bisa disalin dari [validation.ts](src/modules/config/validation.ts)
dan [logging/record.ts](src/modules/logging/record.ts) — bukan dari nol.

---

#### D2. Bagaimana perubahan sampai ke cache bot? — **MENGHAMBAT, yang paling sulit**

Ini inti dari seluruh rancangan. Empat opsi:

| Opsi | Cara kerja | Harga |
| --- | --- | --- |
| A | Tambah `publish` dan `subscribe` ke `KeyValueStore` | ioredis sudah jadi dependensi, jadi nol dependensi baru. Butuh subscribe per proses shard. |
| B | Penghitung generasi di store, bot memeriksa tiap N detik | Tidak perlu koneksi subscribe. Tambah satu perjalanan ke store per interval per shard. |
| C | Turunkan TTL cache konfigurasi jadi 5 detik | Paling sederhana. Tapi tetap tidak deterministik, dan memperbanyak query ke Supabase pada setiap server aktif. |
| D | Terima basi sampai 60 detik, tulis di README | Nol kode. Tapi melanggar AC US-05 PRD §8, "langsung berlaku tanpa restart bot". |

**Rekomendasi: A, dengan D3 sebagai syarat.**

Opsi C menggoda karena hanya satu baris perubahan. Tapi ia memperlambat setiap
server aktif dengan query tambahan, untuk menyelesaikan masalah yang bisa
diselesaikan tepat. Opsi D melanggar AC yang sudah tertulis di PRD.

Kekhawatiran nyata pada A: kalau Redis mati, `createKeyValueStore()` jatuh ke
store memori **tanpa pub/sub**, dan tidak ada cara apa pun untuk memberi tahu
proses bot. Itu bukan kondisi kecil. Lihat D3.

---

#### D3. Apa yang dilakukan dashboard saat Redis tidak hidup? — **MENGHAMBAT**

`assertShardingReady()` di [index.ts](src/index.ts) sudah menetapkan pola untuk
ini: menolak jalan lebih jujur daripada menjalankan konfigurasi yang merusak
state diam-diam.

Tiga pilihan:

| Opsi | Perilaku |
| --- | --- |
| A | Dashboard menolak menulis, dengan pesan "penyimpanan bersama tidak aktif, coba lagi" |
| B | Dashboard menulis saja, menerima basi sampai 60 detik, mencatat peringatan |
| C | Menolak start sama sekali |

**Rekomendasi: A.**

Menolak menulis memberi tahu operator satu hal yang bisa diperbaiki: nyalakan
Redis. Menulis diam-diam memberi tahu satu hal yang tidak bisa: kalau perubahan
tidak berlaku, orang akan menyimpulkan dashboardnya rusak. Menolak start tidak
menarik seluruh bot bersama-sama.

Batas yang harus ditulis terang: kalau Redis mati, **dashboard hanya bisa
membaca**. Ini bukan bug, itu konsekuensi yang tidak dihindari, dan harus
tertulis di README.

---

#### D4. Cakupan tulis v1 — **MENGHAMBAT**

**Rekomendasi: hanya `guild_config`, dengan paritas persis `/config` dan
`/setup`.**

Sebelas model lain di [schema.prisma](prisma/schema.prisma) tidak disentuh di
v1. Alasannya tiga, dan semuanya nyata:

1. Tabel `automod_rule` dan `guild_log_subscription` menyimpan JSON dengan
   bentuk masing-masing. Menyalinnya ke form web berarti membangun ulang editor
   JSON, dan setiap kunci yang terlewat akan menghasilkan aturan yang salah.
2. Tabel `ticket`, `reaction_role_panel`, dan `playlist` menyimpan data pribadi
   (§12). Membuka permukaan baca dari peramban berarti menambah satu tempat lagi
   untuk data yang diakses tanpa jejak.
3. `/config` dan `/setup` sudah menyediakan permukaan yang cukup. Kalau paritas
   sudah benar, manfaat dashboard sudah tercapai penuh untuk kasus yang
   ditujunya.

Risiko menolak perlu dinyatakan: admin akan minta "tambahkan juga
automod" sebelum stabil. Non-goal §2.5 adalah yang menahan itu, dan tes paritas
SC-2 adalah yang membuatnya tidak bisa longgar diam-diam.

---

#### D5. Bagaimana autentikasi dan otorisasi? — **MENGHAMBAT**

**Rekomendasi: Discord OAuth2 Authorization Code dengan PKCE, scope
`identify guilds`, lalu verifikasi Manage Server lewat token bot pada setiap
penulisan.**

Alasannya, dan ini tidak bisa ditawar:

- Otorisasi dicek **setiap kali menulis**, bukan sekali saat login. Izin bisa
  berubah di tengah sesi, dan sesi bisa bertahan berhari-hari.
- Sumber kebenaran adalah `GET /guilds/{guildId}/members/{userId}` memakai
  `DISCORD_TOKEN` yang sudah dimiliki proyek. Field `permissions` di payload
  OAuth bisa basi dan tidak boleh dijadikan rujukan.
- Callback harus memvalidasi `state` untuk mencegah CSRF pada alur OAuth.

Alternatif yang ditolak: session berbasis token bot sendiri. Itu memberi
dashboard kekuatan penuh atas database tanpa perlu memeriksa izin Discord, dan
token bot tidak pernah boleh keluar dari proses bot.

Konsekuensi: dashboard butuh kredensial OAuth baru di Developer Portal, dan
perlu menyimpan session. Sesi disimpan sebagai cookie `httpOnly`, `secure`,
`sameSite=lax`, berisi id opaque yang menunjuk baris session di database.
Bukan JWT, karena pencabutan sesi harus mungkin dilakukan.

---

#### D6. Struktur repository dan katalog bahasa

Bot hidup di repo ini. Dashboard Next.js punya build toolchain sendiri, TypeScript
sendiri, dan siklus rilis sendiri.

Tiga pilihan:

| Opsi | Bentuk | Harga |
| --- | --- | --- |
| A | Repo terpisah | Tidak ada yang bisa diimpor. Katalog bahasa, validasi, dan skema Prisma harus disalin. |
| B | Monorepo, satu repo dengan dua paket | Katalog dan skema bisa dibagikan. Coupling jadi dua arah. |
| C | Repo terpisah, tapi `src/modules/config` dijadikan paket yang dipublikasikan | Nol duplikasi, tapi perlu paket privat dan langkah rilis tambahan. |

**Rekomendasi: A, repo terpisah, dengan satu pengecualian yang dijaga tes.**

Alasannya: menyatukan build Next.js dengan proses bot berarti satu
`npm install` bisa gagal karena konflik dependensi, dan kegagalan itu akan
didiagnosis sebagai bot rusak ketika botnya baik saja. Mengubah repo bot
menjadi monorepo demi fitur Fase 3 yang belum ada sama sekali adalah
perombakan besar yang belum ada yang menanggung biayanya.

Pengecualiannya: validasi tidak disalin bebas. Modul validasi dashboard harus
**mengimpor** dari satu sumber. Selama masih satu repo, opsi paling murah
adalah dashboard memakai path relatif ke modul yang sama lewat konfigurasi
alias, dan tes paritas SC-2 memastikan hasilnya tidak menyimpang.

Kalau nanti repo sudah dipisah permanen, langkah kedua adalah mengeluarkan modul
validasi ke paket `@harmony/config-schema` yang dipakai dua-duanya. Itu
keputusan tahap berikutnya, bukan keputusan sekarang.

Untuk bahasa: dashboard punya katalog sendiri, tapi **tes kesetaraan** membandingkan
kunci dan nilainya dengan [catalog.ts](src/modules/i18n/catalog.ts) untuk
semua kunci yang dipakai dashboard. Katalog setengah terisi lebih buruk daripada
kosong, alasan yang sama seperti bot.

---

#### D7. Deployment

**Rekomendasi: layanan terpisah di compose yang sama.**

- Container sendiri, build sendiri, port hanya di-bind ke `127.0.0.1`.
- `depends_on: migrate: service_completed_successfully`, sama seperti bot.
- Dashboard **tidak pernah** menjalankan `prisma migrate dev` atau
  `migrate deploy`. Migrasi tetap milik repo bot. Kalau dashboard menjalankan
  migrasi sendiri, dua layanan bisa menerapkan migrasi berbeda pada waktu
  berbeda.
- `HEALTH_PORT` bot tidak dipakai ulang. Dashboard punya `DASHBOARD_PORT`
  sendiri dengan endpoint `/api/health` yang memeriksa database.
- Batas sumber daya: PRD §11 menyebut target VPS 2 vCPU / 2 GB untuk bot.
  Dashboard adalah layanan tambahan di mesin yang sama, jadi ia memakan
  sebagian RAM yang sekarang dipakai bot. Itu harus ikut dihitung saat rilis.

Variabel lingkungan baru:

```
DASHBOARD_URL=https://...            # untuk callback OAuth dan tautan di UI
DASHBOARD_SECRET=                    # penanda cookie sesi, wajib diisi
DASHBOARD_PORT=3000
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
OAUTH_REDIRECT_URI=                  # bawaan: DASHBOARD_URL/api/auth/callback
```

**Terimplementasi (improv v1).** Bentuknya persis seperti rekomendasi:

- [dashboard/Dockerfile](dashboard/Dockerfile): build multi-stage
  (`deps` → `build` → `runtime`). **Konteks build adalah akar repo**, bukan
  `dashboard/` — dashboard mengimpor modul bot lewat alias `@bot/*`
  (validasi, tipe, katalog bahasa, kanal invalidasi) dan memakai client
  Prisma hasil generate milik bot. Membangun dari `dashboard/` saja berarti
  harus menyalin modul-modul itu, dan salinan adalah cara paling pasti untuk
  membuat paritas `/config` basi tanpa ada tes yang gagal.
- `prisma generate` dijalankan eksplisit di dua tahap (bukan diserahkan ke
  postinstall), supaya client pasti sesuai schema yang disalin. Tahap
  `runtime` membuang devDependencies dan berjalan sebagai user `node`
  bawaan image (non-root, uid 1000).
- Port dibaca dari `DASHBOARD_PORT` lewat wrapper `CMD`, supaya satu
  variabel mengatur port di mana pun dashboard dijalankan (compose,
  systemd, manual).
- `docker-compose.yml` (akar) dan `deploy/casaos/docker-compose.yml`
  sama-sama memuat layanan `dashboard`: `depends_on` migrate selesai +
  Redis sehat, port hanya di-bind ke `127.0.0.1:3000`, `mem_limit: 256m`,
  dan healthcheck yang memprobe `/api/health`. Compose memaksa
  `DASHBOARD_PORT=3000` supaya tidak bisa melenceng dari port yang
  dipublish — pola yang sama dengan `HEALTH_PORT` milik bot.

---

#### D8. Rate limit dan audit

Rate limit memakai `KeyValueStore` yang sama dengan bot, dengan kunci
`dash:<guildId>:<userId>`. Batas yang dipilih: 30 penulisan per menit per
pengguna per server, dan 10 pembacaan dari `log_entry` per menit.

Setiap penulisan menghasilkan satu `log_entry` kategori `server` (US-D4). Yang
penting dan mudah terlewat: `executor_id` harus user Discord, bukan ID bot.
Kalau diisi ID bot, `/logs` akan menampilkan Harmony yang mengubah konfigurasi,
padahal yang mengubah adalah manusia. Itu bentuk kebohongan yang harus
dihindari meski terlihat kecil.

---

### 4.3 Integration Points

| Titik | Arah | Bentuk | Catatan |
| --- | --- | --- | --- |
| Discord OAuth2 | Masuk | HTTPS | Scope `identify guilds`. Client id dan secret baru. |
| Discord REST (token bot) | Otorisasi | HTTPS | `GET /guilds/{id}/members/{userId}`, `GET /guilds/{id}/channels`, `GET /guilds/{id}/roles`. Dipanggil server-side saja. |
| Supabase PostgreSQL | Baca + tulis | Prisma | `DATABASE_URL`. `DIRECT_URL` tidak dipakai runtime. |
| Redis | Baca, tulis, publish | `ioredis` | Hanya untuk publish invalidasi dan rate limit. Tidak menyimpan data konfigurasi. |
| `log_entry` | Tulis | Prisma | Satu baris per perubahan. |
| Bot | Pesan | Redis publish-subscribe | Satu arah: dashboard memberi tahu, bot membuang cache. Tidak ada panggilan balik. |

### 4.4 Security & Privacy

**Ancaman dan penanganannya:**

| Ancaman | Penanganan |
| --- | --- |
| User kehilangan izin setelah login | Izin dicek ulang tiap penulisan lewat token bot. Lihat D5. |
| CSRF | Token state pada alur OAuth, plus cookie `sameSite=lax` dan pemeriksaan origin pada setiap POST. |
| XSS dari `welcomeMessage` | Dashboard menampilkan teks apa adanya sebagai teks, bukan HTML. React meng-escape secara bawaan; tidak ada `dangerouslySetInnerHTML` di mana pun. |
| SSRF lewat channel atau role yang dikirimi | ID divalidasi terhadap daftar channel dan role guild itu dari Discord, bukan dipercaya. |
| SQL injection | Prisma parameterisasi. Tidak ada query mentah. |
| Pembacaan `log_entry` yang berlebihan | Dibatasi rate limit, dan hanya menampilkan ringkasan yang sudah disimpan. |
| Bocor data antar guild | Setiap route mengambil `guildId` dari session terverifikasi, tidak pernah dari body permintaan. |
| Isi `welcomeMessage` yang berbahaya | Diisi admin server sendiri, sama seperti lewat `/config`. Tidak ada perbedaan risiko antara dua jalur. |

**Privasi §12:**

- Dashboard **tidak** menambah data pribadi baru. Ia hanya membaca dan menulis
  `guild_config` milik server, yang isinya ID channel dan ID role, bukan data
  orang.
- Yang dicatat adalah `executor_id`, dan itu sudah tercakup di `log_entry` yang
  punya jalur retensi 30 hari. Dashboard tidak menambah retensi baru.
- `/privacy` dan `/data-delete` **tidak** berubah, dan tidak boleh berubah,
  karena tidak ada tabel baru.
- Alamat kontak takedown yang PRD §12 mewajibkan tidak berkaitan dengan
  dashboard, tapi tetap belum diisi. Lihat §5.

### 4.5 Observability

- `GET /api/health` di dashboard: 200 saat database terjangkau, 503 saat tidak.
  Tanpa autentikasi, karena isinya hanya status, sama seperti `/health` bot.
  `HEAD` dijawab sama dengan `GET` untuk monitor yang hanya memakai HEAD.
  Route wajib `force-dynamic` dan `cache-control: no-store`: health check
  yang ter-cache melaporkan keadaan lama.
- Endpoint itu memeriksa **dua hal, bukan satu**: database (ping Prisma) dan
  kanal bersama (increment di Redis). Keduanya bisa mati sendiri-sendiri, dan
  hanya memeriksa database akan melaporkan "sehat" saat setiap penulisan
  sedang ditolak (D3). Badan respons memuat `database`, `sharedStore`, dan
  `readWrite` (konjungsi keduanya) supaya operator bisa membedakannya.
- Metrik: `harmony_dashboard_writes_total` dan
  `harmony_dashboard_write_denied_total`. Yang kedua penting, karena
  kegagalan otorisasi adalah indikator paling awal bahwa ada yang salah.
  **Terimplementasi sebagai penghitung di penyimpanan bersama** (kunci
  `harmony:dashboard:writes:total` dan `harmony:dashboard:writeDenied:total`,
  tanpa TTL — lihat D9), bukan penghitung in-process: angka di memori hilang
saat restart dan tidak terlihat instance lain. Empat kebijakan, semuanya
disengaja:
  - Pencacahan **terbaik-usaha**. `increment` yang gagal hanya mencatat
    `warn` di log (`metrics.increment.failed`); ia tidak pernah menolak atau
    menunda penulisan. Metrik adalah pelengkap, bukan bagian kontrak tulis.
  - Pembacaan **tidak pernah melempar**: kunci belum ada atau Redis mati
    menjawab nol, dengan `warn` di log. Monitoring yang memakai endpoint
    ini tidak boleh ikut mati saat penyimpanannya tidak stabil.
  - Tidak ada data pribadi di kedua kunci — global, bukan per guild atau
    per user — jadi aman ditampilkan tanpa autentikasi.
  - Penolakan dihitung **apa pun alasannya** (izin, rate limit, nilai tidak
    valid, origin salah, infrastruktur), termasuk penolakan origin yang
    terjadi sebelum jalur tulis dipanggil. Di operasi normal jumlahnya nol,
    jadi angka yang bukan nol berarti ada yang salah.
- Log terstruktur lewat pola yang sama dengan bot: JSON ke stdout, tanpa nilai
  rahasia, tanpa isi `welcomeMessage`.
- D3 harus menghasilkan **peringatan** saat menulis ditolak karena Redis mati,
  supaya operator tidak mengira dashboard rusak. Penolakan infrastruktur
  (`shared-store-down`, `database-down`) dilog `error`; penolakan yang memang
  tidak layak dilayani (sesi hilang, izin dicabut) dilog `warn` — operator
  tidak perlu membaca isi permintaan untuk membedakan dua masalah yang
  perbaikannya tidak sama.

---

### 4.6 Paritas field dengan `/config`

Tabel ini adalah Acceptance Criteria SC-2. Kolom terakhir harus dijaga tes
yang membacanya dan membandingkannya dengan
[config.ts](src/commands/core/config.ts). Kalau `/config` berubah dan tabel ini
tidak, tes harus gagal.

| Field `guild_config` | `/config set` | `/setup` | Dashboard v1 | Catatan |
| --- | --- | --- | --- | --- |
| `logChannelId` | ya | ya | ya | Perlu konfirmasi (US-D3) |
| `welcomeChannelId` | ya | ya | ya | |
| `goodbyeChannelId` | ya | tidak | ya | Lihat catatan di bawah |
| `djRoleId` | ya | ya | ya | Perlu konfirmasi |
| `autoroleId` | ya | tidak | ya | Perlu konfirmasi |
| `autoroleBotId` | ya | tidak | ya | Perlu konfirmasi |
| `welcomeMessage` | ya | tidak | ya | Maksimal 1500 karakter |
| `goodbyeMessage` | ya | tidak | ya | Maksimal 1500 karakter |
| `defaultVolume` | ya | tidak | ya | 0 sampai 200 |
| `idleTimeoutSec` | ya | tidak | ya | 30 sampai 86400 |
| `stayChannelId` | ya | tidak | ya | Perlu konfirmasi |
| `locale` | ya | tidak | ya | Menerima alias, menolak nilai asing |
| `modules.music` | ya | ya | ya | Mati = perlu konfirmasi |
| `modules.moderation` | ya | ya | ya | Mati = perlu konfirmasi |
| `modules.automod` | ya | ya | ya | Mati = perlu konfirmasi |
| `modules.logging` | ya | ya | ya | Mati = perlu konfirmasi |
| `modules.customCommands` | ya | ya | ya | Mati = perlu konfirmasi |
| `modules.reactions` | **tidak** | ya | **tidak** | Lihat catatan |
| `modules.tickets` | **tidak** | ya | **tidak** | Lihat catatan |
| `ticketPanelChannelId` | **tidak** | tidak | **tidak** | Diatur perintah `/ticket` |
| `ticketCategoryId` | **tidak** | tidak | **tidak** | Diatur perintah `/ticket` |
| `ticketStaffRoleId` | **tidak** | tidak | **tidak** | Diatur perintah `/ticket` |
| `ticketPanelMessageId` | **tidak** | tidak | **tidak** | Diatur tim tiket saat panel dikirim ulang |

**Dua asimetri yang ditemukan di bot, dan sengaja tidak diselesaikan dashboard:**

1. `/config set` punya lima tombol modul, `/setup` punya tujuh. `reactions` dan
   `tickets` tidak bisa dimatikan lewat `/config`. Ini bukan bug: keduanya
   bisa dinyalakan lewat `/setup`, dan sengaja dimatikan lewat perintah masing-masing
   (`/reactionrole`, `/ticket`) supaya tidak ada jalan yang bisa meninggalkan
   panel setengah jadi.
2. `goodbyeChannelId` ada di `/config` tapi tidak di wizard `/setup`. Itu
   ketidaksamaan yang nyata di sisi bot, bukan di dashboard.

Dashboard mengikuti `/config`, bukan `/setup`, karena `/config` yang menyediakan
set lengkap. Menyalin ketidaksamaan `/setup` ke dashboard akan menjadi bug baru,
bukan paritas. Dua asimetri di atas sebaiknya dicatat sebagai pekerjaan terpisah,
di luar ruang lingkup dokumen ini.

---

## 5. Risks & Roadmap

### 5.1 Risiko teknis

| Risiko | Dampak | Kemungkinan | Mitigasi |
| --- | --- | --- | --- |
| Invalidasi pub/sub tidak sampai ke semua shard | Perubahan tidak berlaku di sebagian server | Sedang | Subscription terhubung pada tiap proses shard, dan tes yang memeriksa semua proses menerima pesan. Kalau pesan tidak sampai, konsekuensinya harus jelas dan tertulis |
| Redis mati saat ada yang menulis | Perubahan tidak berlaku, atau hilang | Sedang | D3: menolak menulis, bukan menerima basi. Peringatan di log |
| Dashboard punya kredensial database produksi | Kebocoran data penuh kalau bocor | Rendah tapi besar | Kredensial hanya di server, tidak pernah ke peramban. Tidak ada `NEXT_PUBLIC_` untuk nilai rahasia sama sekali |
| Tidak ada uji end-to-end | Bug di alur OAuth baru ketahuan setelah rilis | Tinggi | Scope v1 dibatasi supaya alur OAuth adalah satu-satunya bagian yang besar, dan ia diuji manual checklist sebelum rilis |
| Biaya RAM di VPS 2 GB | Bot ikut melambat | Sedang | Node runtime untuk dashboard, dan diukur sebelum dan sesudah |
| Skema database berubah dan dashboard belum sinkron | Halaman error atau salah baca | Sedang | Dashboard membaca skema lewat Prisma yang sama, dan CI menjalankan typecheck-nya |
| Cache bot tidak terbuang sehingga dashboard terlihat benar sementara bot masih memakai nilai lama | Admin mengambil kesimpulan salah | Rendah | Bot tetap satu-satunya pembaca. Dashboard tidak menyimpan salinan konfigurasi sendiri |

### 5.2 Rencana bertahap

Tiap tahap punya kriteria selesai yang bisa diperiksa. Tidak ada tahap yang
dimulai sebelum kriteria tahap sebelumnya terpenuhi.

**F0 — Keputusan arsitektur. Status: dokumen ini.**
Keluaran: delapan keputusan di §4.2 terjawab dan tercatat.
Selesai ketika: tidak ada keputusan berlabel MENGHAMBAT yang belum terjawab.

**F1 — Fondasi dan baca.**
Keluaran: OAuth2 masuk, daftar server tampil, halaman konfigurasi tampil dalam
bahasa server. **Tidak ada satu pun penulisan.**
Selesai ketika: semua AC US-D1 terpenuhi, dan SC-3 sudah diuji untuk jalur
baca juga (membaca `guild_config` guild lain ditolak 403).

**Status: selesai.** OAuth, daftar server, dan halaman konfigurasi multibahasa
terimplementasi dan teruji.

**F2 — Tulis dan invalidasi.**
Keluaran: semua AC US-D2 dan US-D3, plus publish-subscribe.
Selesai ketika: SC-1 terpenuhi 100% dalam 100 percobaan, dan SC-2 terpenuhi.

**Status: selesai.** Tulis, publish-subscribe invalidasi, dan audit semuanya
terimplementasi; bot membuang kelima cache saat menerima pesan kanal.

**F3 — Jejak dan ketahanan.**
Keluaran: US-D4, rate limit, `/api/health`, metrik.
Selesai ketika: setiap perubahan muncul di `/logs` dengan executor=user yang
benar, dan D3 berperilaku seperti yang ditulis.

**Status: selesai.** Rate limit, `/api/health`, dan metrik §4.5 semuanya
terimplementasi; metrik ditampilkan di `/api/health` tanpa autentikasi.

**F4 — Pelitura tambahan. Tidak termasuk v1.**
Kandidat, semuanya di luar non-goal §2.5 dan butuh revisi dokumen:
membaca statistik `/stats`, reaction roles, tiket, perintah custom.

### 5.3 Yang belum selesai dan tidak bisa diselesaikan di dokumen ini

- **Keputusan §4.2 belum dijawab.** Ini disengaja. Menulis asumsi di tempat yang
  salah jauh lebih lambat daripada menjawabnya di sini.
- **Alamat kontak takedown.** PRD §12 mewajibkannya sebelum bot publik.
  Tidak ada di repo ini, dan tidak bisa dibuat tanpa keputusan soal domain dan
  email mana yang dipakai.
- **Halaman kebijakan privasi yang dipublikasikan.** PRD §12 mewajibkannya
  juga. Yang ada sekarang hanya `/privacy` di dalam bot, yang bukan halaman
  web. Dashboard tidak menambah kewajiban ini, dan juga tidak menghapus
  satu pun kewajiban yang sudah ada.
- **v1 sudah terimplementasi** (improv): OAuth, baca/tulis konfigurasi dengan
  paritas `/config`, invalidasi pub/sub, audit, rate limit, metrik §4.5, dan
  deployment (Dockerfile + dua berkas compose). 144 tes di `dashboard/`
  hijau. Yang tersisa bukan pekerjaan kode: dua butir di bawah, plus
  verifikasi manual alur OAuth dengan akun Discord sungguhan.

---

## Lampiran A — Ringkasan keputusan

| # | Keputusan | Rekomendasi | Menghambat? |
| --- | --- | --- | --- |
| D1 | Penulis database | Dashboard, lewat Prisma langsung | ya |
| D2 | Invalidasi cache lintas proses | Publish-subscribe di `KeyValueStore` | ya, yang tersulit |
| D3 | Perilaku saat Redis mati | Menolak menulis, tetap bisa membaca | ya |
| D4 | Cakupan tulis v1 | Hanya `guild_config` | ya |
| D5 | Autentikasi | Discord OAuth2 + PKCE, cek izin tiap tulis | ya |
| D6 | Struktur repo | Repo terpisah, validasi diimpor, dijaga tes | tidak |
| D7 | Deployment | Layanan terpisah di compose yang sama | tidak |
| D8 | Rate limit dan audit | `KeyValueStore`, 30 tulis per menit | tidak |
| D9 | Penyimpanan metrik (§4.5) | Penghitung di `KeyValueStore` bersama, tanpa TTL, terbaik-usaha | tidak |
| D10 | Bentuk build dashboard (D7) | Dockerfile multi-stage, konteks build = akar repo | tidak |

Lima dari sepuluh keputusan menghambat. Itu banyak, dan itu sendiri adalah
jawaban: dashboard ini **tidak bisa dimulai dari baris kode pertama**. Ia dimulai
dari jawaban-jawaban itu.

## Lampiran B — Rujukan

- [PRD.md](PRD.md) §5.3 butir dashboard, §3.2 non-goal, §8 US-05, §11 NFR,
  §12 privasi, §18.2 MoSCoW.
- [guildConfigService.ts](src/modules/config/guildConfigService.ts) — cache dan
  `invalidate`.
- [kvStore.ts](src/services/kvStore.ts) — `KeyValueStore`, dengan `publish`/`subscribe` opsional.
- [types.ts](src/modules/config/types.ts) — `GuildConfig` dan `GuildConfigPatch`.
- [config.ts](src/commands/core/config.ts) — daftar setelan `/config`.
- [validation.ts](src/modules/config/validation.ts) — aturan yang harus disalin
  persis.
- [docker-compose.yml](docker-compose.yml) — layanan yang ada sekarang.
- [src/index.ts](src/index.ts) — langganan invalidasi saat bot start (D2).
- [dashboard/Dockerfile](dashboard/Dockerfile) — build multi-stage dashboard (D7).
- [dashboard/lib/metrics.ts](dashboard/lib/metrics.ts) — metrik §4.5 (D9).

## Lampiran C — Catatan improv (implementasi v1)

Dokumen ini ditulis sebelum ada kode. Saat implementasi, dua celah dan
beberapa klaim basi ditemukan; keduanya diperbaiki di dokumen ini:

- **§4.5 belum menyebut bentuk metriknya** (hanya menyebut nama). Diperluas:
  kunci penyimpanan, kebijakan terbaik-usaha, jaminan "baca tidak pernah
  melempar", dan aturan bahwa penolakan dihitung apa pun alasannya.
  Terimplementasi di [dashboard/lib/metrics.ts](dashboard/lib/metrics.ts),
  dikabel di `PATCH /api/config`, dan ditampilkan di `/api/health`.
- **D7 belum menyebut berkas buildnya.** Diperluas dengan strategi
  `dashboard/Dockerfile` dan alasan konteks build = akar repo.
- **§4.1.1 basi sebelum implementasi selesai.** Dua fakta sudah tidak benar
  saat kode ditulis: `KeyValueStore` **sudah** punya `publish`/`subscribe`
  opsional (diimplementasikan `RedisKeyValueStore` dengan koneksi langganan
  terpisah), dan `invalidate` **sudah** punya pemanggil (kelima cache, lewat
  `invalidationWiring.ts`). Tabel diperbaiki. Klaim aslinya adalah alasan
  D2 dirumungkan, bukan deskripsi kode yang harus dipertahankan.
- **§5.3 "belum ada satu baris kode" basi.** F1–F3 terimplementasi: OAuth,
  baca/tulis konfigurasi dengan paritas `/config`, invalidasi pub/sub, audit,
  rate limit, metrik, dan deployment. 144 tes hijau.
- Yang masih terbuka tetap terbuka: alamat kontak takedown dan halaman
  kebijakan privasi publik (§5.3), serta uji manual alur OAuth dengan akun
  Discord sungguhan (lihat README dashboard).