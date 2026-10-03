/**
 * Pemilihan URL database untuk Prisma CLI.
 *
 * Dipisah dari `prisma.config.ts` supaya bisa diuji tanpa efek samping: file
 * konfigurasi itu memuat `dotenv/config` dan memanggil `defineConfig` saat
 * diimpor, jadi mengujinya langsung berarti menarik `.env` asli ke dalam tes.
 *
 * **Kenapa ada dua URL.** Supabase (dan hosting Postgres terkelola lain)
 * menaruh pooler di depan database. Prisma CLI — yang menjalankan migrasi,
 * `db push`, dan Studio — butuh satu sesi yang sama terus-menerus, sedangkan
 * Prisma Client di aplikasi boleh lewat pooler. Dua kebutuhan itu berbeda,
 * jadi Prisma sendiri mengaturkannya lewat dua variabel: `DIRECT_URL` untuk
 * CLI, `DATABASE_URL` untuk runtime. Kalau hanya satu diisi, `DATABASE_URL`
 * dipakai untuk keduanya — supaya Postgres lokal (yang tidak punya pooler)
 * tetap jalan tanpa konfigurasi tambahan.
 */

/** Port 6543 = transaction pooler (PgBouncer / Supavisor). */
const TRANSACTION_POOLER_PORT = '6543';

/** String dianggap terisi kalau ada isi setelah dipangkas spasi. */
function filled(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * URL yang dipakai Prisma CLI.
 *
 * `DIRECT_URL` diutamakan kalau ada; kalau tidak, jatuh ke `DATABASE_URL`;
 * kalau keduanya kosong, `undefined` supaya pemanggil bisa memberi pesan yang
 * benar alih-alih diam-diam memakai URL placeholder.
 */
export function resolveCliDatabaseUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return filled(env.DIRECT_URL) ?? filled(env.DATABASE_URL);
}

/**
 * Apakah URL itu menunjuk transaction pooler (port 6543)?
 *
 * Penting karena kegagalannya tidak CELLAT: Prisma Migrate memakai prepared
 * statement, dan transaction mode tidak mendukungnya, jadi migrasi menggantung
 * atau gagal tanpa pesan yang menyebut pooler sebagai penyebabnya.
 */
export function isTransactionPoolerUrl(url: string): boolean {
  try {
    return new URL(url).port === TRANSACTION_POOLER_PORT;
  } catch {
    // URL bukan bentuk baku — biarkan driver yang melaporkannya.
    return false;
  }
}
