# DESIGN.md: arah visual dashboard Harmony

Berlaku untuk `dashboard/`. Filter slop-nya ada di `.agents/skills/antislop/`;
dokumen ini memberi arah, bukan aturan tambahan.

## Apa ini

Dashboard web untuk admin server Discord: memilih server, melihat konfigurasi bot,
mengubahnya, dan membaca hasil audit. Bukan halaman pemasaran, bukan aplikasi
konsumen. Orang datang untuk menyelesaikan satu hal lalu pergi.

## Posisi merek

**Harmony terasa seperti perpanjangan klien Discord, bukan SaaS generik.**

Alasannya satu baris: admin sudah hidup di Discord, jadi palet, kepadatan, dan
pola interaksi yang sama menurunkan biaya belajar dan tidak memaksa mereka
mempelajari sistem visual baru untuk mengubah satu channel log.

Ini bukan meniru produk lain (R-30). Discord adalah tempat bot ini tinggal, dan
kesamaan bahasa visual adalah keputusan sadar, bukan tiruan layout Linear atau
Vercel.

## Tiga dial

**ENERGY 1 / RHYTHM 2 / MOTION 1**

- **ENERGY 1**: ini alat operasional. Tidak ada hero, tidak ada ajakan mendaftar,
  tidak ada angka pemasaran. Yang pertama terlihat selalu tugasnya.
- **RHYTHM 2**: sebagian besar halaman seragam (daftar server, form), dengan satu
  jeda yang disengaja: panel ringkasan status di atas form konfigurasi.
- **MOTION 1**: hanya transisi hover, focus, dan buka/tutup dialog. Tidak ada
  animasi masuk, parallax, atau hitungan angka.

## Palet

Latar gelap Discord, satu aksen blurple, tiga warna status. Tidak ada warna lain
tanpa alasan tertulis.

| Peran | Hex | Dipakai untuk |
| --- | --- | --- |
| Latar halaman | `#1e1f22` | `body` |
| Permukaan | `#232428` | kartu, panel |
| Permukaan naik | `#2f3136` | header tabel, input nonaktif |
| Garis | `#3a3d44` | border input dan panel |
| Garis redup | `#2f3136` | pemisah baris |
| Teks utama | `#dbdee1` | isi |
| Teks redup | `#b5bac1` | subjudul, keterangan |
| Teks samar | `#949ba4` | metadata, placeholder |
| Aksen | `#5865f2` | satu tombol utama per layar, tautan fokus |
| Netral tombol | `#4e5058` | tombol sekunder |
| Sukses | `#1f3a2a` / `#8fe0b0` | badge dan notice berhasil |
| Peringatan | `#4a3a12` / `#f2d59b` | badge `unknown`, notice DB mati |
| Bahaya | `#3d1d1f` / `#f5c2c7` | notice gagal, aksi merusak |

Kontras terukur (WCAG AA butuh 4,5:1 untuk teks normal):

| Pasangan | Rasio |
| --- | --- |
| `#dbdee1` di `#1e1f22` | 12,20:1 |
| `#dbdee1` di `#232428` | 11,48:1 |
| `#b5bac1` di `#1e1f22` | 8,44:1 |
| `#949ba4` di `#1e1f22` | 5,87:1 |
| `#949ba4` di `#2f3136` | 4,64:1 |
| `#f2f3f5` di `#4e5058` | 7,24:1 |
| `#fff` di `#5865f2` | 4,61:1 |
| `#8fe0b0` di `#1f3a2a` | 7,93:1 |
| `#f2d59b` di `#4a3a12` | 7,75:1 |
| `#f5c2c7` di `#3d1d1f` | 9,63:1 |

Batas: `#949ba4` di `#2f3136` hanya 4,64:1, dan di atas `#4a3a12` turun ke
3,93:1. Teks samar tidak boleh dipakai di permukaan status berwarna; di sana
pakai warna teks milik status itu (`#f2d59b` atau `#f5c2c7`).

## Tipografi

- Keluarga: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Nol
  unduhan font, dan setiap OS memakai font yang sudah dioptimasi untuk teks kecil.
  Tidak ada font merek khusus: dashboard ini dibaca 20 detik, bukan dipandang.
- Skala: 12 (badge), 13 (metadata), 14 (isi dan kontrol), 18 (judul panel),
  20 (judul bagian), 24 (judul halaman), 28 (judul masuk).
- Berat: 400 untuk isi, 600 untuk judul, label tombol, dan nama server.
- Tinggi baris 1,5. Tanpa huruf kapital semua, tanpa letter-spacing lebar.

## Spasi, radius, lebar

- Satuan dasar 4px. Nilai yang dipakai: 4, 8, 10, 12, 14, 16, 18, 24, 32, 64.
- Radius 8 untuk input dan tombol, 10 untuk baris kartu, 12 untuk panel, 999
  hanya untuk badge status. Jangan membuat semua elemen pil.
- Lebar konten 960px. Halaman masuk 560px. Padding halaman `32px 20px 64px`.

## Komponen

- **Tombol primer**: blurple, teks putih, radius 8, padding `10px 18px`, berat 600.
  Maksimal satu per layar.
- **Tombol sekunder**: `#4e5058`, teks `#f2f3f5`. Untuk Batal, Keluar, dan aksi
  yang tidak mengubah data.
- **Badge status**: selalu teks, tidak pernah warna saja. `ok` hijau, `warn`
  kuning, `muted` abu. Badge `unknown` memakai `?` dan disertai kalimat penjelas.
- **Baris server**: kartu `#232428`, border `#2f3136`, radius 10, ikon 32px bulat.
- **Input dan select**: latar `#1e1f22`, border `#3a3d44`, radius 8. Label selalu
  terlihat di atas kontrol, bukan placeholder sebagai label.
- **Notice**: satu blok dengan latar status, border 1px, radius 8, padding
  `10px 12px`. Notice kegagalan memakai `role="alert"`.
- **Dialog konfirmasi**: satu dialog untuk semua perubahan besar, menyebut nilai
  lama. Bukan dialog per field.

## State yang wajib ada

- **Kosong**: server tanpa hasil, guild tanpa channel. Jelaskan kenapa kosong dan
  apa langkah berikutnya. Jangan tampilkan kartu kosong.
- **Memuat**: tombol berubah teks dan `disabled` selama `busy`. Tidak ada spinner
  dekoratif.
- **Gagal**: notice dengan sebab yang boleh diketahui pengguna, plus satu langkah
  yang bisa dilakukan. Jangan menampilkan pesan internal.
- **Hanya baca**: saat Discord tidak menjawab, form tetap tampil, kontrol
  `disabled`, dan ada satu kalimat yang menyebut alasannya.

## Teks dan suara

- Bahasa Indonesia, sapaan "Anda", kalimat pendek, huruf kalimat biasa.
- Tombol menyebut aksi nyata: "Simpan perubahan", "Keluar", "Buka pengaturan".
  Bukan "Mulai", "Pelajari", "Jelajahi".
- Tanpa em dash. Tanpa kata pemasaran: seamless, powerful, revolusioner, AI-powered.
- Angka hanya dari sumber nyata. Tanpa angka, lebih baik daripada angka palsu.
- Nama modul dan field memakai katalog terjemahan yang sama dengan bot, supaya
  dashboard dan `/config` tidak pernah berbeda kalimat.

## Yang dilarang

Gradient, glassmorphism, glow, bayangan besar, latar grid, ikon sparkle atau
robot, badge "AI", emoji dekoratif, skeleton sebagai tangkapan produk, animasi
masuk, dua aksen bersamaan, dan warna kelima di luar tabel palet.

## Mobile

Di bawah 720px semua menjadi satu kolom. Grid `auto-fit, minmax(260px, 1fr)`
sudah runtuh sendiri, tetapi tabel dan baris server harus diperiksa ulang: tidak
boleh ada overflow horizontal, teks tidak boleh keluar dari kartu, dan target
sentuh minimal 44px.

## Status implementasi

Sudah sesuai: palet, skala tipografi, radius, lebar konten, dan seluruh pasangan
warna teks lulus AA.

Belum sesuai, dan belum diperbaiki:

- Belum ada lapisan CSS. Semua gaya masih inline di tiap file, sehingga state
  hover, focus, dan disabled tidak punya tempat.
- Tidak ada `:focus-visible` sama sekali, dan tidak ada `cursor: pointer` yang
  seragam. Ini pelanggaran R-32 dan R-39.
- Tidak ada media query. Layout mengandalkan `auto-fit`, jadi perilaku di bawah
  480px belum pernah dinyatakan, apalagi diperiksa.
- `dashboard/app/servers/[guildId]/page.tsx:253` menaruh teks `#949ba4` (13px)
  di atas latar `#4a3a12`. Terukur 3,93:1, di bawah ambang 4,5:1. Ini satu-satunya
  pasangan warna di dashboard yang gagal AA.
- Komentar di `dashboard/components/ConfigForm.tsx:232` berakhir dengan potongan
  `jadi_)`, tanda kalimat yang terputus sebelum selesai.

## Cara memakai

1. Baca `AGENTS.md` untuk aturan kerja.
2. Baca dokumen ini untuk arah: palet, tipografi, dial, dan suara.
3. Baca `.agents/skills/antislop/SKILL.md` sebagai filter, lalu kerjakan.
4. Sebelum menyerahkan UI, jalankan Delivery Gate dan laporkan PASS/FAIL per item
   dengan bukti.
