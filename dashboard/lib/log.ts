/**
 * Log terstruktur dashboard.
 *
 * Bentuknya sengaja sama dengan bot: JSON satu baris ke stdout, tanpa warna,
 * tanpa timestamp yang ditulis tangan (dipakai `Date.now()` supaya bisa
 * dibandingkan dengan log bot dalam satulini waktu yang sama).
 *
 * Kenapa modul sekecil ini ada, dan bukan `console.log` seadanya:
 *
 * 1. **Harus bisa dipanggil tanpa logger.** `getEnv()` bisa melempar, dan route
 *    handler tidak boleh melempar karena gagal menulis log. Semua fungsi di sini
 *    tidak pernah melempar.
 * 2. **Harus tidak bisa bocorkan rahasia.** Yang menulis ke log adalah kode yang
 *    memanggil, jadi jaminan penuh tidak mungkin datang dari sini — tapi
 *    nilainya bisa dibersihkan per nama, dan itulah yang dilakukan `REDACT_KEYS`. Kalau
 *    ada yang menulis `password`, `token`, atau `secret`, nilainya berubah jadi
 *    `"[disembunyikan]"` sebelum sampai stdout. Ini penting karena log biasanya
 *    dikirim ke pengumpul pihak ketiga.
 * 3. **Harus bisa ditekan di produksi.** Tanpa itu, satu health check yang gagal
 *    setiap 30 detik akan mengisi disk. `DASHBOARD_LOG`=none mematikan stdout
 *    sepenuhnya; default-nya `info`.
 */

/**
 * Sumber environment untuk logger.
 *
 * Sengaja `Record<string, string | undefined>`, bukan `NodeJS.ProcessEnv`:
 * `next-env.d.ts` menambah `NODE_ENV` sebagai kunci wajib, jadi tipe itu tidak
 * bisa diisi dari tes tanpa memalsukan environment. Logger ini hanya membaca
 * satu kunci, jadi tipe sempit ini jujur tentang kebutuhannya.
 */
export type LogSource = Record<string, string | undefined>;

/** Nilai yang akan disembunyikan kalau muncul sebagai nama field. */
const REDACT_KEYS = new Set([
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'code',
  'code_verifier',
  'state',
  'database_url',
  'redis_url',
  'welcomeMessage',
  'goodbyeMessage',
]);

const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LEVELS)[number];

function threshold(source: LogSource = process.env): LogLevel {
  const raw = source.DASHBOARD_LOG?.toLowerCase();
  return LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[kedalaman maksimum]';

  if (value === null || typeof value === 'bigint' || typeof value === 'number') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 197)}…` : value;

  // Error harus diperiksa SEBELUM cabang `object` di bawah. `message` dan
  // `name` adalah properti non-enumerable, jadi `Object.entries(new Error(x))`
  // menghasilkan `[]` — kalau ururannya salah, setiap Error di log berubah jadi
  // `{}` dan penyebab kegagalan hilang tepat saat paling dibutuhkan.
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }

  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.has(key) ? '[disembunyikan]' : redact(item, depth + 1);
    }
    return out;
  }
  return '[tipe tidak dikenal]';
}

function enabled(level: Exclude<LogLevel, 'silent'>, source: LogSource): boolean {
  const at = threshold(source);
  if (at === 'silent') return false;
  return LEVELS.indexOf(level) >= LEVELS.indexOf(at);
}

function emit(
  level: Exclude<LogLevel, 'silent'>,
  event: string,
  fields: Record<string, unknown>,
  source: LogSource,
): void {
  if (!enabled(level, source)) return;

  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: 'dashboard',
    event,
    ...(redact(fields) as Record<string, unknown>),
  });

  // `console` dipilih supaya Next dan Docker menanganinya seperti log biasa.
  // Bungkus: kalau stdout sudah tertutup, log tidak boleh menjatuhkan request.
  try {
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  } catch {
    /* stdout tertutup — diamkan, jangan gagalkan request karena log */
  }
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}, source: LogSource = process.env): void =>
    emit('debug', event, fields, source),
  info: (event: string, fields: Record<string, unknown> = {}, source: LogSource = process.env): void =>
    emit('info', event, fields, source),
  /**
   * Peringatan. Dipakai untuk kondisi yang operator harus tahu tetapi tidak
   * menggagalkan request — terutama D3: penulisan ditolak karena Redis mati.
   * Tanpa baris ini, dashboard hanya terlihat "rusak" tanpa penjelasan.
   */
  warn: (event: string, fields: Record<string, unknown> = {}, source: LogSource = process.env): void =>
    emit('warn', event, fields, source),
  error: (event: string, fields: Record<string, unknown> = {}, source: LogSource = process.env): void =>
    emit('error', event, fields, source),
};
