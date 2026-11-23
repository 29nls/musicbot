import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { botPermissionDeps } from '@/lib/discord.js';
import { DEV_PERMISSION_DEPS, devFixturesEnabled } from '@/lib/devFixtures.js';
import { getEnv } from '@/lib/env.js';
import { checkGuildAccess } from '@/lib/permissions.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';
import { MusicDashboard } from '@/components/MusicDashboard.js';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ guildId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { guildId } = await params;

  return { title: `Musik ${guildId} | Harmony` };
}

/**
 * Halaman musik memakai keanggotaan guild, bukan Manage Server.
 *
 * Pemegang role DJ boleh membuka panel ini; keputusan DJ dan voice diambil bot
 * dari gateway setiap perintah. Memakai `checkManageGuild` di sini akan menutup
 * pintu bagi orang yang justru berhak memakai musik menurut aturan bot.
 */
export default async function MusicPage({ params }: PageProps) {
  const { guildId } = await params;
  const session = await readSessionOrDev();
  if (!session) redirect('/');

  const deps = devFixturesEnabled()
    ? DEV_PERMISSION_DEPS
    : botPermissionDeps(getEnv().DISCORD_TOKEN);
  const verdict = await checkGuildAccess(deps, guildId, session.userId);

  if (verdict !== 'allowed') {
    return (
      <main style={{ maxWidth: 620 }}>
        <Link href="/servers" style={{ color: '#949ba4', fontSize: 14 }}>
          ← Kembali
        </Link>
        <div role="alert" style={alertStyle}>
          <h2 style={{ fontSize: 20, marginTop: 0 }}>
            {verdict === 'denied' ? 'Tidak punya akses' : 'Akses belum bisa diverifikasi'}
          </h2>
          <p style={{ marginBottom: 0 }}>
            {verdict === 'denied'
              ? 'Anda bukan anggota server ini atau bot tidak ada di server ini.'
              : 'Discord tidak menjawab saat keanggotaan diperiksa. Coba lagi beberapa saat lagi.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Link href={`/servers/${guildId}`} style={{ color: '#949ba4', fontSize: 14 }}>
        ← Kembali
      </Link>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Musik</h1>
      <p style={{ color: '#b5bac1', marginTop: 0 }}>
        Lihat apa yang sedang diputar, cari lagu, dan kendalikan bot dari sini.
      </p>

      <MusicDashboard guildId={guildId} />
    </main>
  );
}

const alertStyle: CSSProperties = {
  marginTop: 16,
  background: '#4a3a12',
  border: '1px solid #d9a441',
  color: '#f2d59b',
  borderRadius: 10,
  padding: '16px 18px',
};
