import { z } from 'zod';

/**
 * Environment dashboard.
 *
 * Sengaja terpisah dari `src/config/env.ts` milik bot: skema bot mewajibkan
 * `LAVALINK_PASSWORD` dan lain-lain yang tidak dipakai dashboard, dan menuntut
 * keduanya sama berarti dashboard tidak bisa dijalankan tanpa menyalin rahasia
 * yang bukan urusannya. Yang benar-benar dipakai bersama (token bot, kredensial
 * database, Redis) dibaca dari environment yang sama, jadi di compose keduanya
 * memang berbagi satu berkas `.env`.
 *
 * Tidak ada satu pun nilai rahasia di sini yang boleh berawalan `NEXT_PUBLIC_`:
 * apa pun yang berawalan itu ikut ke bundel peramban, dan token bot di peramban
 * berarti siapa pun bisa membaca seluruh server tempat bot berada.
 */

const snowflake = z.string().regex(/^\d{17,20}$/, 'harus berupa ID Discord (17-20 angka)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ── Discord ─────────────────────────────────────────────────────────────────
  /** Token bot: dipakai HANYA di server, untuk memeriksa izin dan mengirim audit. */
  DISCORD_TOKEN: z.string().min(20, 'wajib diisi (Developer Portal → Bot → Reset Token)'),
  /** Application id; sama dengan client id OAuth. */
  DISCORD_CLIENT_ID: snowflake,
  /** Kosong = memakai DISCORD_CLIENT_ID (biasanya memang sama). */
  OAUTH_CLIENT_ID: snowflake.optional(),
  OAUTH_CLIENT_SECRET: z.string().min(1, 'wajib diisi (Developer Portal → OAuth2 → Client Secret)'),
  /** Kosong = `${DASHBOARD_URL}/api/auth/callback`. */
  OAUTH_REDIRECT_URI: z.string().url().optional(),

  // ── Dashboard ───────────────────────────────────────────────────────────────
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Kunci enkripsi cookie sesi. Harus panjang: ini yang menjaga sesi. */
  DASHBOARD_SECRET: z
    .string()
    .min(32, 'minimal 32 karakter — cookie sesi dienkripsi dengan ini (openssl rand -hex 32)'),

  // ── Data & kanal bersama ────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'wajib diisi; sama dengan milik bot'),
  REDIS_URL: z.string().min(1, 'wajib diisi; sama dengan milik bot'),

  // ── Hanya untuk pengembangan ────────────────────────────────────────────────
  /**
   * Menyalakan sesi uji tanpa Discord OAuth.
   *
   * Ditolak keras di `NODE_ENV=production`: tanpa penolakan itu, satu variabel
   * yang tertinggal di server produksi berarti siapa pun bisa masuk sebagai
   * pemilik server mana pun.
   */
  DASHBOARD_DEV_FAKE_SESSION: z.enum(['true', 'false']).default('false'),
  DEV_GUILD_ID: snowflake.optional(),
});

export type DashboardEnv = z.infer<typeof schema> & {
  /** Client id OAuth yang benar-benar dipakai (sudah termasuk fallback-nya). */
  oauthClientId: string;
  /** Redirect URI yang benar-benar dipakai. */
  oauthRedirectUri: string;
  /** Sesi uji boleh dipakai? Sudah memperhitungkan NODE_ENV. */
  devSessionEnabled: boolean;
};

let cached: DashboardEnv | undefined;

/** Pesan yang menyebut variabel mana yang salah, bukan "env tidak valid". */
export function formatEnvError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `• ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Env dashboard. Melempar dengan daftar variabel yang bermasalah.
 *
 * Dievaluasi malas supaya impor modul (di tes, atau saat `next build`) tidak
 * gagal hanya karena environment belum lengkap.
 */
export function getEnv(source: NodeJS.ProcessEnv = process.env): DashboardEnv {
  if (source === process.env && cached) return cached;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Environment dashboard tidak lengkap:\n${formatEnvError(parsed.error)}`);
  }

  const value = parsed.data;
  const oauthClientId = value.OAUTH_CLIENT_ID ?? value.DISCORD_CLIENT_ID;
  const env: DashboardEnv = {
    ...value,
    oauthClientId,
    oauthRedirectUri: value.OAUTH_REDIRECT_URI ?? `${value.DASHBOARD_URL}/api/auth/callback`,
    // Sesi uji hanya mungkin di luar produksi. Ini satu-satunya tempat
    // keputusan itu diambil, supaya tidak ada jalur kedua yang bisa lupa.
    devSessionEnabled: value.NODE_ENV !== 'production' && value.DASHBOARD_DEV_FAKE_SESSION === 'true',
  };

  if (source === process.env) cached = env;
  return env;
}

/** Buang cache env — dipakai tes yang mengganti environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
