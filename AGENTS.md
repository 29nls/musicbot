# AGENTS.md — Aturan kerja Harmony

Aturan ini berlaku untuk semua perubahan di repo ini. Isinya diadaptasi dari
skill [`karpathy-guidelines`](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT), yang juga tersedia lokal di `.agents/skills/karpathy-guidelines/`.

## 1. Pahami dulu, jangan berasumsi

- Baca kode dan dokumentasi yang relevan sebelum mengubah apa pun.
- Nyatakan asumsi yang dipakai. Kalau ragu, tanyakan.
- Kalau ada beberapa tafsir yang masuk akal, sebutkan semuanya; jangan memilih
  diam-diam.
- Kalau ada cara yang lebih sederhana, katakan. Koreksi arah pekerjaan lebih
  murah daripada menyelesaikan pekerjaan yang salah.
- Kalau ada yang tidak jelas, berhenti dan sebutkan bagian yang membingungkan.

## 2. Sederhana dulu

- Tulis kode minimum yang menyelesaikan permintaan. Tidak ada fitur spekulatif.
- Jangan membuat abstraksi untuk pemakaian tunggal.
- Jangan menambah opsi konfigurasi, fleksibilitas, atau dependency yang tidak
  diminta.
- Jangan menambah penanganan error untuk skenario yang tidak mungkin terjadi.
- Kalau 200 baris bisa menjadi 50 baris, tulis ulang.

Pertanyaan penjaga: apakah senior engineer akan menyebut ini overcomplicated?

## 3. Perubahan harus surgical

- Sentuh hanya yang perlu. Jangan merapikan kode, komentar, atau format di
  sekitarnya.
- Jangan me-refactor sesuatu yang tidak rusak.
- Ikuti gaya yang sudah ada, meskipun akan ditulis berbeda dari awal.
- Kalau menemukan dead code yang tidak terkait, sebutkan; jangan hapus.
- Bersihkan hanya import, variabel, atau fungsi yang menjadi yatim karena
  perubahan sendiri.
- Setiap baris yang berubah harus bisa dilacak langsung ke permintaan pengguna.

## 4. Kerjakan dengan kriteria sukses yang bisa diverifikasi

- Ubah permintaan menjadi target yang bisa diperiksa.
  - "Tambahkan validasi" → tulis tes input tidak valid, lalu buat lulus.
  - "Perbaiki bug" → tulis tes yang mereproduksi bug, lalu buat lulus.
  - "Refactor X" → pastikan tes lulus sebelum dan sesudah.
- Untuk tugas beberapa langkah, tulis rencana singkat dengan cara verifikasi tiap
  langkah.
- Jalankan pemeriksaan terkecil yang relevan. Jangan mengklaim sesuatu lulus
  tanpa menjalankannya.
- Laporkan pemeriksaan yang gagal atau tidak bisa dijalankan sebagai batasan,
  bukan sebagai keberhasilan.

## 5. Anti-slop (UI dan komentar kode)

Skill lokal: `.agents/skills/antislop/` dan `.agents/skills/antislop-code/`. Aturan
lengkap ada di file `SKILL.md` masing-masing; ringkasan di bawah ini wajib
dipakai.

- Mode antislop (`during` = ikuti saat menulis, `after` = audit setelah selesai)
  ditentukan per sesi; kalau belum dipilih, tanyakan sekali, jangan menebak.
- Untuk pekerjaan UI: baca `DESIGN.md` (jika ada) untuk arah, lalu pakai
  `antislop.md` sebagai filter. Jangan menghasilkan UI generik: setiap teknik
  visual harus punya alasan satu baris; jangan ada em dash (`—`) di teks UI;
  jangan ada statistik/testimonial palsu; jangan ada kontrol mati; wajib state
  kosong/loading/error; wajib aksesibilitas keyboard dan kontras WCAG AA.
- Sebelum mengirimkan UI, jalankan Delivery Gate di `antislop.md` dan laporkan
  PASS/FAIL per item dengan bukti konkret.
- Untuk komentar kode: hanya ubah komentar, jangan ubah kode yang bisa
  dieksekusi. Hapus komentar yang mendekorasi, mengulang hal yang jelas, menarasi
  langkah demi langkah, label kosong, TODO vagu, emoji dekoratif, atau penanda
  akhir blok. Pertahankan komentar yang menjelaskan alasan, batasan, workaround,
  keputusan arsitektur, keamanan, performa, dan kontrak API. Setiap komentar
  harus menambah informasi yang tidak ditunjukkan kode.

## 6. Agen spesialis

Persona dari [`agency-agents`](https://github.com/msitarzewski/agency-agents)
(MIT, commit `8ae6164`) ada di `.agents/agents/`; daftarnya di
`.agents/agents/SOURCE.md`.

- Panggil hanya saat tugasnya cocok: review → `engineering-code-reviewer.md`,
  diff minimum → `engineering-minimal-change-engineer.md`, kode asing →
  `engineering-codebase-onboarding-engineer.md`, skema/query →
  `engineering-database-optimizer.md`, audio/voice →
  `engineering-voice-ai-integration-engineer.md`, UI dashboard →
  `design-ui-finish-gate-reviewer.md`, tes →
  `testing-test-automation-engineer.md`, klaim selesai →
  `testing-reality-checker.md`, keamanan → `security-appsec-engineer.md`,
  kebocoran token atau kredensial → `security-secrets-credential-engineer.md`,
  audit kode hasil AI → `security-ai-generated-code-auditor.md`, retensi dan
  penghapusan data → `data-privacy-officer.md`, lingkup dan prioritas →
  `product-manager.md`, selisih dokumen dengan kode →
  `specialized-codebase-archaeologist.md`.
- Baca file persona-nya, jangan menyalin seluruh isinya ke jawaban.
- Urutan menang: permintaan pengguna, lalu `AGENTS.md` ini, baru persona agen.
  Persona tidak boleh melonggarkan aturan di atas atau menambah dependency,
  file, atau refactor yang tidak diminta.
- Kalau tidak ada yang cocok, kerjakan tanpa persona. Jangan memaksakan peran.
