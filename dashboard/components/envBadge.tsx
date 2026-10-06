import { getEnv } from '@/lib/env.js';

/**
 * Lencana mode uji.
 *
 * Hanya dirender kalau `DASHBOARD_DEV_FAKE_SESSION` benar-benar menyala. Yang
 * penting: lencana ini tidak pernah muncul di produksi, karena `getEnv()`
 * memaksa `devSessionEnabled` false saat `NODE_ENV=production` — jadi kalau
 * variabelnya tertinggal di server, yang terjadi adalah sesi uji **tidak
 * menyala**, bukan lencana yang tampil.
 */
export function EnvBadge() {
  const env = getEnv();
  if (!env.devSessionEnabled) return null;

  return (
    <p
      data-testid="dev-session-badge"
      style={{
        marginTop: 32,
        padding: '8px 12px',
        borderRadius: 8,
        background: '#4a3a12',
        border: '1px solid #d9a441',
        color: '#f2d59b',
        fontSize: 13,
      }}
    >
      Mode uji aktif: sesi dibuat tanpa OAuth karena <code>DASHBOARD_DEV_FAKE_SESSION</code> menyala.{' '}
      {env.DEV_GUILD_ID ? <>Guild uji: <code>{env.DEV_GUILD_ID}</code>.</> : null} Ini tidak mungkin
      terjadi di <code>NODE_ENV=production</code>.
    </p>
  );
}