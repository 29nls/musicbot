/**
 * Halaman antrean (PRD §8 US-02: "antrean berhalaman 10 lagu/halaman dengan
 * tombol navigasi").
 *
 * Semua perhitungan di file ini murni dan tanpa Discord, karena dua hal di
 * sini mudah salah dan tidak terlihat dari satu tampilan:
 *
 * - **Nomor urut harus berasal dari posisi sebenarnya di antrean.** Kalau
 *   nomor dihitung ulang dari isi halaman, `/remove 3` yang tertulis di embed
 *   halaman 3 akan menghapus lagu yang salah.
 * - **Halaman harus dijepit, bukan dipercaya.** Antrean bisa saja menyusut
 *   antara dua klik (lagu selesai, `/stop` jalan); tombol yang menuju halaman
 *   5 saat antrean tinggal 2 halaman harus menampilkan isi yang ada, bukan
 *   kosong atau error.
 */

export const QUEUE_PAGE_PREFIX = 'queue:';

/** Jumlah lagu per halaman, sesuai AC §8 US-02. */
export const QUEUE_PAGE_SIZE = 10;

export interface QueuePage<T> {
  /** Nomor halaman, mulai dari 1. */
  page: number;
  totalPages: number;
  /** Isi halaman ini. */
  items: readonly T[];
  /** Indeks (0-based) item pertama di halaman ini pada antrean utuh. */
  startIndex: number;
  /** Berapa item yang tidak tampil di halaman ini. */
  hiddenCount: number;
}

/** Berapa halaman yang dibutuhkan untuk `total` item; minimal satu. */
export function totalQueuePages(total: number, pageSize = QUEUE_PAGE_SIZE): number {
  const size = Math.max(1, Math.trunc(pageSize));
  const count = Math.max(0, Math.trunc(total));

  return Math.max(1, Math.ceil(count / size));
}

/**
 * Jepit nomor halaman ke rentang yang benar.
 *
 * Halaman selalu minimal 1: `0` atau negatif dari customId berarti tangan
 * yang salah, dan menampilkan "halaman 0 dari 3" lebih membingungkan daripada
 * menampilkan halaman pertama.
 */
export function clampQueuePage(page: number, totalPages: number): number {
  const max = Math.max(1, Math.trunc(totalPages));
  const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;

  return Math.min(max, Math.max(1, wanted));
}

/** Potong daftar item menjadi satu halaman yang sudah dijepit. */
export function buildQueuePage<T>(
  items: readonly T[],
  page: number,
  pageSize = QUEUE_PAGE_SIZE,
): QueuePage<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const totalPages = totalQueuePages(items.length, size);
  const current = clampQueuePage(page, totalPages);
  const startIndex = (current - 1) * size;
  const pageItems = items.slice(startIndex, startIndex + size);

  return {
    page: current,
    totalPages,
    items: pageItems,
    startIndex,
    hiddenCount: items.length - pageItems.length,
  };
}

/**
 * customId tombol halaman.
 *
 * **Hanya nomor halaman yang boleh masuk ke sini.** `customId` ikut terkirim
 * ulang ke siapa pun yang menyalin payload interaksi, jadi apa pun yang
 * ditulis di dalamnya harus dianggap terbaca publik; memakainya untuk
 * membawa judul lagu atau ID gimmick hanya menambah kebocoran yang tidak
 * pernah dibutuhkan.
 */
export function queuePageCustomId(page: number): string {
  return `${QUEUE_PAGE_PREFIX}p:${Math.max(1, Math.trunc(page))}`;
}

/**
 * Baca nomor halaman dari customId; null kalau bukan ours atau bukan angka.
 *
 * `customId` berasal dari klien, jadi bentuknya harus diperiksa sendiri dan
 * tidak boleh diteruskan apa adanya ke perhitungan mana pun.
 */
export function parseQueuePageCustomId(customId: string): number | null {
  if (!customId.startsWith(`${QUEUE_PAGE_PREFIX}p:`)) return null;

  const raw = customId.slice(`${QUEUE_PAGE_PREFIX}p:`.length);
  if (!/^\d{1,4}$/.test(raw)) return null;

  const page = Number(raw);

  return page >= 1 ? page : null;
}