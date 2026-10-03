import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'harus berupa ID Discord (17–20 digit angka)');

/** Ubah string kosong dari .env menjadi undefined supaya opsi tidak dianggap terisi. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Discord
  DISCORD_TOKEN: z.string().min(20, 'wajib diisi (Developer Portal → Bot → Reset Token)'),
  DISCORD_CLIENT_ID: snowflake,
  DEV_GUILD_ID: z.preprocess(emptyToUndefined, snowflake.optional()),

  // Infrastruktur
  DATABASE_URL: z.string().min(1, 'wajib diisi, contoh: postgresql://harmony:pass@localhost:5432/harmony'),
  REDIS_URL: z.string().min(1, 'wajib diisi, contoh: redis://localhost:6379'),

  // Lavalink
  LAVALINK_HOST: z.string().min(1).default('localhost'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65_535).default(2333),
  LAVALINK_PASSWORD: z.string().min(1, 'wajib diisi dan harus sama dengan LAVALINK_SERVER_PASSWORD di container'),

  // Health check (PRD 5.1): port untuk GET /health dan /ready.
  // 0 = matikan endpoint (mis. saat menjalankan lokal tanpa monitoring).
  HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(8080),

  // Perilaku bot
  DEFAULT_VOLUME: z.coerce.number().int().min(0).max(200).default(100),
  MAX_QUEUE_SIZE: z.coerce.number().int().min(1).max(10_000).default(500),

  // Retensi data: berapa jam sekali job membersihkan kasus/peringatan lama.
  // 0 = matikan penjadwalan (mis. kalau pembersihan dijalankan dari cron luar).
  RETENTION_SWEEP_HOURS: z.coerce.number().int().min(0).max(24 * 30).default(6),

  // Berapa menit sekali job menonaktifkan panel reaction role yang lewat masa
  // hidup. 0 = matikan penjadwalan.
  PANEL_EXPIRY_SWEEP_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(15),

  // Mode 24/7 (PRD 5.2): berapa menit sekali job memastikan bot tetap
  // tersambung di channel 24/7 tiap server. Menutup kasus bot ter-kick,
  // shard reconnect, atau perubahan channel saat bot sedang kosong.
  // 0 = matikan penjadwalan.
  STAY_SWEEP_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(5),

  // Lirik (PRD 5.2). LRCLIB gratis dan tanpa API key, jadi ini default-nya.
  GENIUS_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LYRCLIB_BASE_URL: z.string().min(1).default('https://lrclib.net/api'),

  // Metadata Spotify (PRD 5.2). Hanya untuk MEMBACA judul/metadata; audio tetap
  // dicari di Lavalink, jadi tidak butuh Spotify Premium. Kosong = tautan
  // Spotify akan diberi tahu fitur belum aktif, bukan gagal diam-diam.
  SPOTIFY_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SPOTIFY_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

/** Error khusus supaya index.ts bisa tampilkan pesan rapi tanpa stack trace. */
export class EnvError extends Error {
  public override readonly name = 'EnvError';
}

/**
 * Validasi environment. Fungsi ini murni (tidak membaca file) supaya bisa dites.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvError(`Konfigurasi environment tidak valid:\n${details}\n\nSalin .env.example menjadi .env lalu isi nilainya.`);
  }
  return result.data;
}

let cached: Env | undefined;
let dotEnvLoaded = false;

/**
 * Muat file .env (kalau ada) lalu validasi. Dipanggil malas (lazy) supaya
 * urutan import tidak menentukan, dan hanya sekali per proses.
 */
export function getEnv(): Env {
  if (!cached) {
    loadDotEnvFile();
    cached = parseEnv();
  }
  return cached;
}

function loadDotEnvFile(): void {
  if (dotEnvLoaded || process.env.NODE_ENV === 'production') return;
  dotEnvLoaded = true;
  try {
    // Variabel yang sudah ada di environment tidak ditimpa — aman untuk Docker.
    process.loadEnvFile('.env');
  } catch {
    // .env tidak ada: wajar saat berjalan di container (nilai datang dari compose).
  }
}
