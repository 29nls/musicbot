import { redirect } from 'next/navigation';
import Link from 'next/link';
import { toLocale } from '@bot/modules/i18n/types.js';
import { dashboardTranslator, type DashboardMessageKey } from '@/lib/messages.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';
import { EnvBadge } from '@/components/envBadge.js';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Harmony — Dashboard' };
export const dynamic = 'force-dynamic';

/** Alasan kegagalan yang boleh ditampilkan peramban; sisanya jadi pesan umum. */
const PUBLIC_REASONS: Record<string, DashboardMessageKey> = {
  invalid_request: 'login.staleState',
  no_pkce: 'login.staleState',
  bad_state: 'login.staleState',
  token_failed: 'login.failed',
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await readSessionOrDev();

  if (session) redirect('/servers');

  // Bahasa halaman depan ikut bahasa default bot, bukan `Accept-Language`:
  // belum ada guild yang dipilih, jadi tidak ada bahasa server untuk diikuti.
  const t = dashboardTranslator(toLocale('id'));
  const reasonKey = params.error ? (PUBLIC_REASONS[params.error] ?? 'login.failed') : null;

  return (
    <main style={{ maxWidth: 560, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>{t('login.title')}</h1>
      <p style={{ color: '#b5bac1', marginTop: 0 }}>{t('login.subtitle')}</p>

      {reasonKey ? (
        <p
          role="alert"
          style={{
            background: '#3d1d1f',
            border: '1px solid #7a2f34',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#f5c2c7',
          }}
        >
          {t(reasonKey)}
        </p>
      ) : null}

      <Link
        href="/api/auth/login"
        style={{
          display: 'inline-block',
          marginTop: 16,
          background: '#5865f2',
          color: '#fff',
          padding: '10px 18px',
          borderRadius: 8,
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        {t('login.cta')}
      </Link>

      <p style={{ color: '#949ba4', fontSize: 14, marginTop: 28 }}>{t('login.consentNote')}</p>
      <EnvBadge />
    </main>
  );
}