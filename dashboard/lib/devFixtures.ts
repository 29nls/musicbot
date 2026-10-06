import { PERMISSION_MANAGE_GUILD, type PermissionDeps } from './permissions.js';
import { getEnv } from './env.js';
import type { GuildChannel, GuildRole, OAuthGuild } from './discord.js';

/**
 * Data tiruan untuk pemeriksaan lokal.
 *
 * **Kenapa ini ada.** Tanpa kredensial Discord yang sah, satu-satunya cara
 * memeriksa halaman konfigurasi adalah tumultuous melihat halaman yang menolak
 * dibuka — dan itu tidak memeriksa apa pun yang penting: form-nya, select
 * channel, dialog konfirmasi, dan alur simpan tidak pernah ter-render. Code
 * review bisa membaca kodenya, tapi tidak bisa memastikan halamannya bekerja.
 *
 * **Kapan aktif.** Hanya kalau `DASHBOARD_DEV_FAKE_SESSION` menyala, dan itu
 * sendiri sudah mustahil di produksi: `getEnv()` memaksa `devSessionEnabled`
 * false begitu `NODE_ENV=production`. Jadi variabel yang tertinggal di server
 * tidak membuka jalan ke mana pun — yang terjadi adalah fixture dimatikan.
 *
 * **Yang TIDAK ditirukan: database dan Redis.** Keduanya nyata. Jadi menulis lewat
 * fixture tetap menulis ke `guild_config` sungguhan, tetap membuat `log_entry`,
 * dan tetap menerbitkan invalidasi ke proses bot sungguhan. Yang dipalsukan hanya
 * Discord, karena itulah satu-satunya pihak yang tidak bisa diganti diam-diam.
 */

export function devFixturesEnabled(): boolean {
  return getEnv().devSessionEnabled;
}

export const DEV_GUILD_ID = '1234567890123456789';
export const DEV_USER_ID = '100000000000000001';

export const DEV_CHANNELS: GuildChannel[] = [
  { id: '1234567890123456790', name: 'general', type: 0, parent_id: null },
  { id: '1234567890123456791', name: 'sampah', type: 0, parent_id: null },
  { id: '1234567890123456792', name: 'pengumuman', type: 5, parent_id: null },
  { id: '1234567890123456793', name: 'Musik', type: 2, parent_id: null },
  { id: '1234567890123456794', name: 'Panggung', type: 13, parent_id: null },
  { id: '1234567890123456795', name: 'Channel dihapus', type: 0, parent_id: null },
];

export const DEV_ROLES: GuildRole[] = [
  { id: '1234567890123456800', name: 'Admin', color: 0xed4245 },
  { id: '1234567890123456801', name: 'DJ', color: 0x9b59b6 },
  { id: '1234567890123456802', name: 'Member', color: 0x747f8d },
];

/**
 * Deps izin yang selalu `allowed`.
 *
 * Bentuknya tetap `PermissionDeps` yang sama, jadi jalur kode yang
 * diuji persis sama dengan yang produksi — hanya sumber jawabannya yang
 * ditukar. Kalau fixture ini punya bentuk sendiri, tes UI tidak lagi
 * membuktikan apa pun tentang perilaku penolakan.
 */
export const DEV_PERMISSION_DEPS: PermissionDeps = {
  getGuild: async () => ({
    id: DEV_GUILD_ID,
    owner_id: DEV_USER_ID,
    roles: [
      { id: DEV_GUILD_ID, permissions: '0' },
      { id: '1234567890123456801', permissions: PERMISSION_MANAGE_GUILD.toString() },
    ],
  }),
  getMember: async () => ({ user: { id: DEV_USER_ID }, roles: ['1234567890123456801'] }),
};

export function devUserGuilds(): OAuthGuild[] {
  return [
    { id: DEV_GUILD_ID, name: 'Server Uji Harmony', icon: null, owner: false },
    { id: '2234567890123456789', name: 'Server Tanpa Izin', icon: null, owner: false },
  ];
}