import type { CSSProperties, ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { toLocale } from '@bot/modules/i18n/types.js';
import { dashboardTranslator } from '@/lib/messages.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';
import { listManageableGuilds } from '@/app/guilds.js';

export const metadata: Metadata = { title: 'Pilih server — Harmony' };
export const dynamic = 'force-dynamic';

/**
 * Daftar server yang bisa diubah.
 *
 * **Halaman ini tidak pernah menggambar tautan ke server yang tidak bisa diubah.**
 * Yang punya izin saja yang punya tombol. Server tanpa izin tetap tampil, karena
 * "kenapa server saya tidak ada di sini" adalah pertanyaan yang perlu jawaban,
 * dan jawabannya jauh lebih berguna daripada daftar yang sunyi.
 *
 * **`unknown` (Discord tidak menjawab) tampil sebagai peringatan**, bukan sebagai
 * "tidak punya izin". Membedakan keduanya penting: yang pertama adalah masalah sementara,
 * yang kedua permanen, dan mengatakannya salah akan membuat orang mengejar izin
 * yang sebenarnya masih berlaku.
 *
 * **Perambig selection server disimpan lewat POST**, bukan link biasa. Server
 * yang dipilih ikut cookie sesi, dan mengubah cookie harus POST; kalau ini GET,
 * situs lain bisa memaksa victim masuk ke server tertentu.
 */
export default async function ServersPage() {
  const session = await readSessionOrDev();
  if (!session) redirect('/');

  const t = dashboardTranslator(toLocale('id'));
  const guilds = await listManageableGuilds(session.accessToken, session.userId);

  const unavailable = t('error.unknownBody');

  return (
    <main>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('guilds.title')}</h1>
          <p style={{ color: '#b5bac1', margin: 0 }}>{t('guilds.subtitle')}</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" style={buttonStyle}>
            {t('action.signOut')}
          </button>
        </form>
      </header>

      {guilds === null ? (
        <Notice tone="warn">{unavailable}</Notice>
      ) : guilds.length === 0 ? (
        <Notice tone="info">
          <strong>{t('guilds.empty')}</strong>
          <br />
          {t('guilds.emptyHint')}
        </Notice>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: 10 }}>
          {guilds.map((guild) => (
            <li
              key={guild.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                border: '1px solid #2f3136',
                borderRadius: 10,
                background: '#232428',
              }}
            >
              <GuildIcon icon={guild.icon} name={guild.name} />
              <span style={{ flex: 1, fontWeight: 600 }}>{guild.name}</span>

              {guild.verdict === 'allowed' ? (
                <>
                  <Badge tone="ok">{t('guilds.badgeCanManage')}</Badge>
                  <Link
                    href={`/servers/${guild.id}`}
                    style={{ ...buttonStyle, textDecoration: 'none', color: '#fff' }}
                  >
                    {t('guilds.open')}
                  </Link>
                </>
              ) : null}

              {guild.verdict === 'denied' ? <Badge tone="muted">{t('guilds.badgeNoAccess')}</Badge> : null}

              {guild.verdict === 'unknown' ? <Badge tone="warn">?</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const buttonStyle: CSSProperties = {
  background: '#4e5058',
  color: '#f2f3f5',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  font: 'inherit',
  cursor: 'pointer',
};

function GuildIcon({ icon, name }: { icon: string | null; name: string }) {
  if (!icon) {
    return (
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#4e5058',
          display: 'grid',
          placeItems: 'center',
          fontSize: 14,
        }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  // Gambar dari CDN Discord adalah aset eksternal; `unoptimized` + `<img>`
  // biasa dipakai karena `next/image` akan mem-proxy-nya lewat server dashboard
  // yang tidak punya alasan untuk menambah satu outing HTTP per guild.
  return (
    // `<img>` biasa dipakai, bukan `next/image`: asetnya dari CDN Discord dan
    // mem-proxy-nya berarti satu permintaan HTTP keluar per guild yang tampil.
    <img
      src={`https://cdn.discordapp.com/icons/${icon}.png?size=64`}
      alt=""
      width={32}
      height={32}
      style={{ borderRadius: '50%' }}
    />
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const colors = {
    ok: { bg: '#1f3a2a', fg: '#8fe0b0', border: '#2f6b46' },
    warn: { bg: '#4a3a12', fg: '#f2d59b', border: '#d9a441' },
    muted: { bg: '#2f3136', fg: '#949ba4', border: '#3a3d44' },
  }[tone];

  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const colors =
    tone === 'warn'
      ? { bg: '#4a3a12', fg: '#f2d59b', border: '#d9a441' }
      : { bg: '#232428', fg: '#b5bac1', border: '#2f3136' };

  return (
    <div
      role={tone === 'warn' ? 'alert' : undefined}
      style={{
        marginTop: 24,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      {children}
    </div>
  );
}

