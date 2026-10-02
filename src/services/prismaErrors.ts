/**
 * Deteksi error "database tidak bisa dijangkau" — dipakai untuk memberi pesan
 * yang bisa ditindak, bukan error generik.
 *
 * Catatan: Prisma menaruh kode koneksi (mis. ECONNREFUSED) di properti `code`,
 * bukan di `message`, jadi keduanya harus diperiksa.
 */
const UNAVAILABLE_CODES = /^(P100[0-2]|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EAI_AGAIN)$/i;

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error.name === 'PrismaClientInitializationError') return true;

  const { code } = error as { code?: unknown };
  if (typeof code === 'string' && UNAVAILABLE_CODES.test(code)) return true;

  return /P100[0-2]|ECONNREFUSED|ETIMEDOUT|Can't reach database server|Connection refused/i.test(error.message);
}
