import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { LOCALES, LOCALE_LABELS, toLocale, type Locale } from '@bot/modules/i18n/types.js';
import type { GuildConfig } from '@bot/modules/config/types.js';
import { translator } from '@bot/modules/i18n/catalog.js';
import { botPermissionDeps, getGuildChannels, getGuildRoles } from '@/lib/discord.js';
import { dashboardTranslator } from '@/lib/messages.js';
import { getEnv } from '@/lib/env.js';
import { checkManageGuild } from '@/lib/permissions.js';
import { readGuildConfig } from '@/lib/serverDeps.js';
import { readSessionOrDev } from '@/lib/sessionRoute.js';
import { ConfigForm, type ChannelOption, type RoleOption } from '@/components/ConfigForm.js';
import {
  DASHBOARD_MODULES,
  DASHBOARD_VALUE_FIELDS,
  type DashboardFieldKey,
} from '@/lib/fieldCatalog.js';
import { DEV_CHANNELS, DEV_PERMISSION_DEPS, DEV_ROLES, devFixturesEnabled } from '@/lib/devFixtures.js';
import type { DashboardMessageKey } from '@/lib/messages.js';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ guildId: string }>;
}

/**
 * Halaman konfigurasi satu server.
 *
 * **Izin dicek ulang di sini, bukan karena halaman ini baru.** Server
 * component di-render ulang tiap permintaan, jadi `denied` di sini berarti
 * accessor tidak pernah menerima data guild itu — bukan hanya tombol simpan yang
 * mati. Itu yang membuat SC-5 (tidak ada kebocoran antar server) bertahan: tidak
 * ada satu pun jalur di mana baris `guild_config` guild lain keluar dari server.
 *
 * **Halaman tetap terbuka saat Discord tidak menjawab** (AC US-D1 terakhir).
 * Channel dan role ditampilkan sebagai ID dengan penanda, konfigurasi dibaca
 * dari database, dan simpan dinonaktifkan. Menolak membuka halaman karena Discord
 * lambat akan membuat orang mengira server-nya rusak.
 *
 * **`notFound()` kalau bot tidak ada di guild itu.** Halaman lain sudah
 * menyaring, tapi URL bisa diketik langsung, dan 404 lebih jujur daripada
 * menampilkan konfigurasi server yang tidak bisa dibaca proses mana pun.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { guildId } = await params;

  return { title: `Pengaturan ${guildId} — Harmony` };
}

export default async function ConfigPage({ params }: PageProps) {
  const { guildId } = await params;
  const session = await readSessionOrDev();
  if (!session) redirect('/');

  const env = getEnv();
  const token = env.DISCORD_TOKEN;
  const dev = devFixturesEnabled();

  const verdict = await checkManageGuild(dev ? DEV_PERMISSION_DEPS : botPermissionDeps(token), guildId, session.userId);
  if (verdict === 'denied') {
    return (
      <Blocked
        titleKey="error.forbiddenTitle"
        bodyKey="error.forbiddenBody"
        guildId={guildId}
      />
    );
  }
  if (verdict === 'unknown') {
    return (
      <Blocked
        titleKey="error.unknownTitle"
        bodyKey="error.unknownBody"
        guildId={guildId}
      />
    );
  }

  // Channel dan role dikirim Discord, dan `discordRequest` sudah mengubah 401/403/
  // 404 jadi `null` — jadi keduanya tidak pernah melempar. Database berbeda:
  // `findUnique` melempar apa adanya kalau host mati atau kredensial salah, dan
  // kalau itu tidak ditangkap, peramban menampilkan tumpukan error 500 yang
  // tidak menjelaskan apa pun. Halaman harus tetap terbuka dengan alasan yang
  // bisa dibaca orang (US-D1: halaman tidak gagal total).
  let config: GuildConfig | null = null;
  let loadError: string | null = null;
  try {
    config = await readGuildConfig(guildId);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'alasan tidak diketahui';
  }

  const [channels, roles] = await Promise.all([
    dev ? Promise.resolve(DEV_CHANNELS) : getGuildChannels(token, guildId),
    dev ? Promise.resolve(DEV_ROLES) : getGuildRoles(token, guildId),
  ]);

  if (!config) {
    return (
      <ReadFailed
        guildId={guildId}
        reason={loadError ?? 'konfigurasi tidak ditemukan'}
      />
    );
  }

  const locale = toLocale(config.locale);
  const t = dashboardTranslator(locale);
  const botT = translator(locale);

  const channelOptions: ChannelOption[] = (channels ?? []).map((channel) => ({
    id: channel.id,
    name: channel.name,
    type: channel.type,
  }));
  const roleOptions: RoleOption[] = (roles ?? []).map((role) => ({
    id: role.id,
    name: role.name,
  }));

  return (
    <main>
      <Link href="/servers" style={{ color: '#949ba4', fontSize: 14 }}>
        ← {t('action.back')}
      </Link>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('config.title')}</h1>
      <p style={{ color: '#b5bac1', marginTop: 0 }}>
        {t('config.subtitle')} {t('config.localeLabel')}: {LOCALE_LABELS[locale]}.
      </p>

      <ConfigForm
        guildId={guildId}
        locale={locale}
        config={{
          logChannelId: config.logChannelId,
          welcomeChannelId: config.welcomeChannelId,
          goodbyeChannelId: config.goodbyeChannelId,
          djRoleId: config.djRoleId,
          autoroleId: config.autoroleId,
          autoroleBotId: config.autoroleBotId,
          welcomeMessage: config.welcomeMessage,
          goodbyeMessage: config.goodbyeMessage,
          defaultVolume: config.defaultVolume,
          idleTimeoutSec: config.idleTimeoutSec,
          stayChannelId: config.stayChannelId,
          locale: config.locale,
          modules: config.modules,
        }}
        channels={channelOptions}
        roles={roleOptions}
        labels={{
          values: t('config.sectionValues'),
          modules: t('config.sectionModules'),
          modulesHint: t('config.sectionModulesHint'),
          notSet: t('config.valueNotSet'),
          channelNone: t('config.channelNone'),
          save: t('action.save'),
          saving: t('action.saving'),
          cancel: t('action.cancel'),
          confirm: t('action.confirm'),
          discard: t('action.discard'),
          savedTitle: t('save.okTitle'),
          savedOne: t('save.okBodySingle'),
          savedMany: t('save.okBody', { count: '{count}' }),
          changeLine: t('save.fieldTitle', { field: '{field}', before: '{before}', after: '{after}' }),
          rejectedTitle: t('save.failedTitle'),
          forbidden: t('save.failedForbidden'),
          rateLimited: t('save.failedRateLimit', { seconds: '{seconds}' }),
          storeDown: t('save.failedRedisDown'),
          databaseDown: t('save.failedDatabase'),
          sessionGone: t('save.failedSession'),
          network: t('save.failedNetwork'),
          nothingChanged: t('save.noChanges'),
          confirmTitle: t('confirm.title'),
          confirmModuleOff: t('confirm.moduleOff', { module: '{module}' }),
          auditFailed: t('audit.failed'),
          locales: LOCALES.map((code: Locale) => ({ code, label: LOCALE_LABELS[code] })),
          // Label diterjemahkan di sini, di server, lalu dikirim sebagai teks.
          // Fungsi penerjemah tidak boleh dikirim ke client component.
          fieldLabels: Object.fromEntries(
            DASHBOARD_VALUE_FIELDS.map((field) => [field.patchKey, botT(field.labelKey)]),
          ) as Record<DashboardFieldKey, string>,
          moduleLabels: Object.fromEntries(
            DASHBOARD_MODULES.map((module) => [module.moduleKey, botT(module.labelKey)]),
          ) as Record<string, string>,
          // Kalimat konfirmasi dengan `{before}` sengaja dibiarkan apa adanya;
          // penggantinyadepends nilai lama yang hanya boleh diketahui setelah
          // perubahan disimpan — jadi dialog yang menyusunnya, bukan server.
          confirms: Object.fromEntries(
            DASHBOARD_VALUE_FIELDS.filter((field) => field.highImpactConfirmKey).map((field) => [
              field.patchKey,
              t(field.highImpactConfirmKey as DashboardMessageKey),
            ]),
          ),
        }}
        readOnly={!channels || !roles}
      />
    </main>
  );
}

/**
 * Halaman tetap terbuka saat konfigurasi tidak terbaca.
 *
 * Alasannya ditampilkan apa adanya, termasuk pesan dari driver database
 * (`ENOTFOUND`, `tenant/user not found`, `P1001`) — itu yang dibutuhkan operator
 * untuk tahu itu kredensial atau jaringan, bukan kode. Yang disembunyikan hanya
 * stack trace-nya, karena isinya tidak pernah membantu siapa pun selain
 * pengembang dan tidak pernah terlihat oleh pengguna lain.
 */
function ReadFailed({ guildId, reason }: { guildId: string; reason: string }) {
  const t = dashboardTranslator(toLocale('id'));

  return (
    <main style={{ maxWidth: 620 }}>
      <Link href="/servers" style={{ color: '#949ba4', fontSize: 14 }}>
        ← {t('action.back')}
      </Link>
      <div role="alert" style={{ ...alertStyle, marginTop: 16 }}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>{t('error.loadFailedTitle')}</h2>
        <p style={{ marginBottom: 8 }}>{t('error.loadFailedBody')}</p>
        <p style={{ marginBottom: 0, fontSize: 13, opacity: 0.8 }}>
          <code>{guildId}</code> — {reason}
        </p>
      </div>
    </main>
  );
}

function Blocked({
  titleKey,
  bodyKey,
  guildId,
}: {
  titleKey: 'error.forbiddenTitle' | 'error.unknownTitle';
  bodyKey: 'error.forbiddenBody' | 'error.unknownBody';
  guildId: string;
}) {
  const t = dashboardTranslator(toLocale('id'));

  return (
    <main style={{ maxWidth: 620 }}>
      <Link href="/servers" style={{ color: '#949ba4', fontSize: 14 }}>
        ← {t('action.back')}
      </Link>
      <div role="alert" style={{ ...alertStyle, marginTop: 16 }}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>{t(titleKey)}</h2>
        <p style={{ marginBottom: 0 }}>{t(bodyKey)}</p>
        <p style={{ marginBottom: 0, color: '#949ba4', fontSize: 13 }}>Guild {guildId}</p>
      </div>
    </main>
  );
}

const alertStyle: CSSProperties = {
  background: '#4a3a12',
  border: '1px solid #d9a441',
  color: '#f2d59b',
  borderRadius: 10,
  padding: '16px 18px',
};