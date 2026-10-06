import { interpolate } from '@bot/modules/i18n/catalog.js';
import { LOCALES, type Locale } from '@bot/modules/i18n/types.js';

/**
 * Katalog teks milik dashboard.
 *
 * Yang **tidak** ada di sini: nama field dan nama modul. Itu diambil dari
 * katalog bot (`config.field.*`, `config.module.*.label`) supaya `/config` dan
 * dashboard tidak punya dua nama untuk hal yang sama, dan supaya mengetik satu
 * huruf yang salah di sini gagal saat build, bukan diam-diam jatuh ke teks
 * Bahasa Indonesia di server berbahasa Inggris.
 *
 * Yang ada di sini: teks antarmuka yang benar-benar tidak punya padanan di bot —
 * judul halaman, tombol, pesan konfirmasi, dan penjelasan field. Bot menyimpan
 * deskripsi opsi `/config` sebagai kalimat Indonesia di dalam berkasnya, jadi
 * tidak ada katalog yang bisa dipinjam tanpa menyalin teks yang tidak-versioned.
 *
 * Aturan yang dijaga `tests/messages.test.ts`:
 *
 * 1. Setiap kunci punya terjemahan di **kedua** bahasa. Katalog setengah terisi
 *    lebih buruk daripada kosong — orang melihat dua bahasa dalam satu layar dan
 *    tidak bisa menebak mana yang belum diterjemahkan.
 * 2. Tidak ada kunci dashboard yang sama dengan kunci bot. Kalau nanti ada, itu
 *    dua definisi untuk satu teks, dan hanya satu yang dipakai.
 * 3. Tidak ada nilai yang sama persis dengan nilai katalog bot. Dua teks
 *    identik di dua tempat tetap dua tempat untuk diperbarui.
 */

const idMessages = {
  // ── Halaman masuk ──────────────────────────────────────────────────────────
  'login.title': 'Harmony Dashboard',
  'login.subtitle': 'Lihat dan ubah konfigurasi bot untuk server Discord kamu.',
  'login.cta': 'Masuk dengan Discord',
  'login.ctaPending': 'Menghubungkan ke Discord…',
  'login.consentNote':
    'Dashboard hanya meminta izin untuk tahu siapa kamu dan server mana yang kamu ikuti. Izin Manage Server tetap dibaca langsung dari Discord setiap kali kamu menyimpan perubahan.',
  'login.failed': 'Gagal masuk. Silakan coba lagi.',
  'login.staleState': 'Sesi login sudah kedaluwarsa. Silakan ulangi dari awal.',

  // ── Daftar server ──────────────────────────────────────────────────────────
  'guilds.title': 'Pilih server',
  'guilds.subtitle': 'Hanya server yang bisa diubah dari sini yang ditampilkan.',
  'guilds.empty': 'Tidak ada server yang bisa kamu atur lewat dashboard.',
  'guilds.emptyHint':
    'Kamu harus punya izin Manage Server di server itu, dan Harmony harus sudah ada di sana.',
  'guilds.open': 'Buka pengaturan',
  'guilds.badgeCanManage': 'Bisa diubah',
  'guilds.badgeNoAccess': 'Tidak bisa diubah',

  // ── Halaman konfigurasi ────────────────────────────────────────────────────
  'config.title': 'Pengaturan bot',
  'config.subtitle': 'Perubahan berlaku tanpa restart bot.',
  'config.sectionValues': 'Nilai',
  'config.sectionModules': 'Modul',
  'config.sectionModulesHint':
    'Modul yang dimatikan langsung menghentikan pemrosesannya. Mematikannya butuh konfirmasi.',
  'config.valueNotSet': 'Belum diatur',
  'config.valueChannelMissing': 'Tidak ditemukan di server ini (ID {id})',
  'config.valueRoleMissing': 'Tidak ditemukan di server ini (ID {id})',
  'config.channelNone': '— tidak ada —',
  'config.selectPlaceholder': 'Pilih…',
  'config.localeLabel': 'Bahasa halaman mengikuti bahasa server',

  // ── Penjelasan tiap field ──────────────────────────────────────────────────
  'help.logChannel': 'Channel tempat riwayat audit dikirim. Kosongkan untuk berhenti mengirim.',
  'help.welcomeChannel': 'Channel tempat pesan sambutan dikirim.',
  'help.goodbyeChannel': 'Channel tempat pesan perpisahan dikirim.',
  'help.djRole': 'Role yang boleh mengatur pemutaran selain Manage Server.',
  'help.autorole': 'Role yang otomatis diberikan ke member yang baru bergabung.',
  'help.autoroleBot': 'Role yang otomatis diberikan ke bot yang baru bergabung.',
  'help.welcomeMessage': 'Pesan sambutan. Placeholder: {user} {mention} {server} {count}.',
  'help.goodbyeMessage': 'Pesan perpisahan. Placeholder: {user} {mention} {server} {count}.',
  'help.defaultVolume': 'Volume awal setiap lagu, dalam persen.',
  'help.idleTimeout': 'Detik sebelum bot keluar dari voice channel setelah antrean habis.',
  'help.stayChannel': 'Voice channel yang diduduki bot terus-menerus tanpa keluar otomatis.',
  'help.locale': 'Bahasa balasan bot dan dashboard ini di server ini.',

  // ── Tombol & hasil ─────────────────────────────────────────────────────────
  'action.save': 'Simpan perubahan',
  'action.saving': 'Menyimpan…',
  'action.cancel': 'Batal',
  'action.confirm': 'Ya, terapkan',
  'action.discard': 'Buang perubahan',
  'action.retry': 'Coba lagi',
  'action.back': 'Kembali ke daftar server',
  'action.signOut': 'Keluar',

  'save.noChanges': 'Tidak ada yang berubah.',
  'save.okTitle': 'Perubahan tersimpan',
  'save.okBody': '{count} field diperbarui. Berlaku tanpa restart bot.',
  'save.okBodySingle': 'Satu field diperbarui. Berlaku tanpa restart bot.',
  'save.fieldTitle': '{field}: {before} → {after}',
  'save.failedTitle': 'Perubahan ditolak',
  'save.failedNetwork': 'Tidak bisa menghubungi server. Perubahan belum tersimpan.',
  'save.failedSession': 'Sesi kamu sudah berakhir. Masuk lagi lalu ulangi.',
  'save.failedForbidden': 'Izin Manage Server kamu sudah tidak berlaku di server ini.',
  'save.failedRateLimit': 'Terlalu banyak perubahan. Tunggu {seconds} detik lalu coba lagi.',
  'save.failedRedisDown':
    'Penyimpanan bersama sedang mati, jadi perubahan belum bisa dijamin berlaku. Nyalakan Redis lalu coba lagi.',
  'save.failedDatabase': 'Database tidak bisa dihubungi, jadi perubahan belum tersimpan.',
  'save.invalid': '{field}: {reason}',

  // ── Keadaan setelah menyimpan ──────────────────────────────────────────────
  'audit.failed':
    'Perubahan tersimpan, tapi jejaknya di riwayat audit gagal ditulis. Periksa koneksi database, lalu ulangi perubahan kalau jejaknya penting.',

  // ── Konfirmasi ber-impact tinggi (US-D3) ───────────────────────────────────
  'confirm.title': 'Perubahan ini berdampak besar',
  'confirm.djRole':
    'Role DJ menentukan siapa yang bolehekeran musik. Saat ini: {before}. Setelah diubah, member yang bukan DJ tidak akan bisa mengatur pemutaran.',
  'confirm.autorole':
    'Setiap member yang baru bergabung langsung mendapat role ini. Saat ini: {before}.',
  'confirm.autoroleBot':
    'Setiap bot yang baru bergabung langsung mendapat role ini. Saat ini: {before}.',
  'confirm.logChannel':
    'Seluruh riwayat audit — ban, warn, perubahan pengaturan — akan dikirim ke channel ini mulai sekarang. Catatan lama tidak ikut pindah. Saat ini: {before}.',
  'confirm.stayChannel':
    'Bot akan menduduki voice channel ini dan tidak keluar otomatis lagi. Saat ini: {before}.',
  'confirm.moduleOff':
    'Mematikan modul {module} langsung menghentikan pemrosesannya, tanpa restart. Kasus moderasi yang sedang berjalan tidak ikut dibatalkan.',

  // ── Halaman yang tidak bisa dibuka ─────────────────────────────────────────
  'error.notFoundTitle': 'Halaman tidak ditemukan',
  'error.noSessionTitle': 'Belum masuk',
  'error.noSessionBody': 'Masuk dengan Discord dulu untuk membuka pengaturan server.',
  'error.forbiddenTitle': 'Tidak punya izin',
  'error.forbiddenBody':
    'Kamu tidak punya izin Manage Server di server ini. Izin dicek ulang setiap kali halaman dibuka, jadi kalau baru saja diambil alih, halaman ini akan terbuka lagi.',
  'error.unknownTitle': 'Izin tidak bisa diverifikasi',
  'error.unknownBody':
    'Discord tidak menjawab, jadi izinmu belum bisa dipastikan. Halaman ini sengaja menampilkan pengaturan apa adanya saja, dan menyimpan perubahan sedang dinonaktifkan.',
  'error.guildMissingTitle': 'Server tidak tersedia',
  'error.guildMissingBody':
    'Harmony tidak ada di server itu, atau server sudah tidak bisa diakses. Halaman hanya menampilkan server tempat Harmony benar-benar ada.',
  'error.readOnlyTitle': 'Mode baca saja',
  'error.readOnlyBody':
    'Penyimpanan bersama sedang mati, jadi perubahan tidak bisa dijamin berlaku. Halaman masih menampilkan konfigurasi saat ini.',
  'error.loadFailedTitle': 'Konfigurasi tidak terbaca',
  'error.loadFailedBody':
    'Database tidak menjawab, jadi tidak ada yang bisa ditampilkan. Periksa `DATABASE_URL` dan koneksinya, lalu muat ulang halaman ini.',
  'error.loadFailed': 'Konfigurasi tidak terbaca: {reason}',
  'error.unexpected': 'Terjadi kesalahan yang tidak diharapkan.',
} as const;

/** Kunci katalog dashboard; dipakai tipe `helpKey` di katalog field. */
export type DashboardMessageKey = keyof typeof idMessages;

const enMessages: Record<DashboardMessageKey, string> = {
  'login.title': 'Harmony Dashboard',
  'login.subtitle': 'View and change your Discord server settings for Harmony.',
  'login.cta': 'Sign in with Discord',
  'login.ctaPending': 'Connecting to Discord…',
  'login.consentNote':
    'The dashboard only asks permission to know who you are and which servers you are in. Manage Server is still read straight from Discord every time you save.',
  'login.failed': 'Sign-in failed. Please try again.',
  'login.staleState': 'This sign-in link has expired. Please start over.',

  'guilds.title': 'Choose a server',
  'guilds.subtitle': 'Only servers you can actually change are listed here.',
  'guilds.empty': 'There are no servers you can configure from here.',
  'guilds.emptyHint':
    'You need Manage Server in that server, and Harmony must already be in it.',
  'guilds.open': 'Open settings',
  'guilds.badgeCanManage': 'Editable',
  'guilds.badgeNoAccess': 'Not editable',

  'config.title': 'Bot settings',
  'config.subtitle': 'Changes apply without restarting the bot.',
  'config.sectionValues': 'Values',
  'config.sectionModules': 'Modules',
  'config.sectionModulesHint':
    'A disabled module stops processing immediately. Turning one off asks for confirmation.',
  'config.valueNotSet': 'Not set',
  'config.valueChannelMissing': 'Not found in this server (ID {id})',
  'config.valueRoleMissing': 'Not found in this server (ID {id})',
  'config.channelNone': '— none —',
  'config.selectPlaceholder': 'Pick…',
  'config.localeLabel': "This page follows the server's language",

  'help.logChannel': 'The channel audit history is sent to. Leave it empty to stop sending.',
  'help.welcomeChannel': 'The channel welcome messages are sent to.',
  'help.goodbyeChannel': 'The channel goodbye messages are sent to.',
  'help.djRole': 'The role allowed to control playback besides Manage Server.',
  'help.autorole': 'The role automatically given to members who join.',
  'help.autoroleBot': 'The role automatically given to bots that join.',
  'help.welcomeMessage': 'The welcome message. Placeholders: {user} {mention} {server} {count}.',
  'help.goodbyeMessage': 'The goodbye message. Placeholders: {user} {mention} {server} {count}.',
  'help.defaultVolume': 'The starting volume of every track, in percent.',
  'help.idleTimeout': 'Seconds before the bot leaves the voice channel once the queue is empty.',
  'help.stayChannel': 'A voice channel the bot keeps sitting in instead of leaving on its own.',
  'help.locale': 'The language the bot and this dashboard use in this server.',

  'action.save': 'Save changes',
  'action.saving': 'Saving…',
  'action.cancel': 'Cancel',
  'action.confirm': 'Yes, apply it',
  'action.discard': 'Discard changes',
  'action.retry': 'Try again',
  'action.back': 'Back to server list',
  'action.signOut': 'Sign out',

  'save.noChanges': 'Nothing changed.',
  'save.okTitle': 'Changes saved',
  'save.okBody': '{count} fields updated. They apply without a bot restart.',
  'save.okBodySingle': 'One field updated. It applies without a bot restart.',
  'save.fieldTitle': '{field}: {before} → {after}',
  'save.failedTitle': 'Change rejected',
  'save.failedNetwork': 'Could not reach the server. Nothing was saved.',
  'save.failedSession': 'Your session has ended. Sign in again and retry.',
  'save.failedForbidden': 'Your Manage Server permission is no longer valid in this server.',
  'save.failedRateLimit': 'Too many changes. Wait {seconds} seconds and try again.',
  'save.failedRedisDown':
    'Shared storage is down, so changes cannot be guaranteed to apply. Start Redis and try again.',
  'save.failedDatabase': 'The database is unreachable, so nothing was saved.',
  'save.invalid': '{field}: {reason}',

  // ── Keadaan setelah menyimpan ──────────────────────────────────────────────
  'audit.failed':
    'The change was saved, but its audit trail entry could not be written. Check database connectivity; repeat the change if the trail matters.',

  'confirm.title': 'This change has a big impact',
  'confirm.djRole':
    'The DJ role decides who can control playback. Currently: {before}. After this change, members without that role will not be able to manage playback.',
  'confirm.autorole':
    'Every member who joins will immediately get this role. Currently: {before}.',
  'confirm.autoroleBot':
    'Every bot that joins will immediately get this role. Currently: {before}.',
  'confirm.logChannel':
    'The whole audit trail — bans, warns, setting changes — goes to this channel from now on. Older entries do not move. Currently: {before}.',
  'confirm.stayChannel':
    'The bot will sit in this voice channel and stop leaving on its own. Currently: {before}.',
  'confirm.moduleOff':
    'Turning {module} off stops it processing immediately, with no restart. A moderation case already in progress is not cancelled.',

  'error.notFoundTitle': 'Page not found',
  'error.noSessionTitle': 'Not signed in',
  'error.noSessionBody': 'Sign in with Discord to open your server settings.',
  'error.forbiddenTitle': 'No permission',
  'error.forbiddenBody':
    'You do not have Manage Server in this server. Permission is rechecked every time this page opens, so if you have just taken over, it will open again.',
  'error.unknownTitle': 'Permission could not be verified',
  'error.unknownBody':
    'Discord did not answer, so your permission is not confirmed. This page deliberately shows settings read-only, and saving is disabled.',
  'error.guildMissingTitle': 'Server unavailable',
  'error.guildMissingBody':
    'Harmony is not in that server, or the server is no longer accessible. Only servers where Harmony is actually present are shown.',
  'error.readOnlyTitle': 'Read-only mode',
  'error.readOnlyBody':
    'Shared storage is down, so changes cannot be guaranteed to apply. This page still shows the current settings.',
  'error.loadFailedTitle': 'Settings could not be read',
  'error.loadFailedBody':
    'The database did not answer, so there is nothing to show. Check DATABASE_URL and the network, then reload this page.',
  'error.loadFailed': 'Settings could not be read: {reason}',
  'error.unexpected': 'Something unexpected went wrong.',
};

const catalogs: Record<Locale, Record<DashboardMessageKey, string>> = {
  id: idMessages,
  en: enMessages,
};

/** Semua kunci dashboard; dipakai tes kelengkapan terjemahan. */
export const DASHBOARD_MESSAGE_KEYS = Object.keys(idMessages) as DashboardMessageKey[];

export type DashboardTranslator = (
  key: DashboardMessageKey,
  params?: Record<string, string | number>,
) => string;

/**
 * Teks dashboard dalam satu bahasa.
 *
 * Aturan fallback-nya sama dengan bot: bahasa yang diminta, lalu Bahasa
 * Indonesia, lalu kunci itu sendiri. Tidak pernah melempar — teks yang gagal
 * menerjemahkan harus tetap menampilkan sesuatu yang bisa dicari di log.
 */
export function dashboardTranslate(
  locale: Locale,
  key: DashboardMessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalogs[locale]?.[key] ?? catalogs.id[key] ?? key;

  return interpolate(template, params);
}

export function dashboardTranslator(locale: Locale): DashboardTranslator {
  return (key, params) => dashboardTranslate(locale, key, params);
}

/** Bahasa yang punya katalog dashboard lengkap. */
export const DASHBOARD_LOCALES: readonly Locale[] = LOCALES;