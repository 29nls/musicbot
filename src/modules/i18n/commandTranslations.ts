/**
 * Terjemahan nama & deskripsi slash command ke bahasa Inggris.
 *
 * **Kenapa ini terpisah dari katalog runtime.** Nama dan deskripsi perintah
 * tidak pernah dirender oleh bot — Discord yang menampilkannya, dari data yang
 * dikirim saat deploy. Satu-satunya cara Discord menampilkan perintah dalam
 * bahasa Inggris adalah field `name_localizations` / `description_localizations`
 * di payload perintah, jadi terjemahannya **wajib ikut pada saat deploy**,
 * bukan dicari saat runtime. Dua hal yang kelihatan mirip, mekanismenya beda.
 *
 * Nama perintah **tidak** diterjemahkan di sini. Discord memakai nama
 * Indonesia sebagai nama kanonik, dan `name_localizations` hanya boleh berisi
 * bahasa lain — jadi tabel ini memakai `name` yang sama untuk semua bahasa dan
 * hanya mengisi deskripsinya. Menerjemahkan nama perintah (`/antrean` vs
 * `/queue`) justru merusak: orang yang mengetik `/queue` harus tetap bisa, dan
 * nama perintah adalah bagian antarmuka yang paling sering dibacakan.
 *
 * Batas Discord: nama maksimal 32 karakter, deskripsi 1–100 karakter. Panjang
 * deskripsi Inggris dijaga di sini dan diperiksa tes, karena melewati batas Discord
 * akan membuat **seluruh** deploy perintah gagal — satu deskripsi kepanjangan
 * mematikan 46 perintah sekaligus.
 */

/** Terjemahan satu perintah ke satu bahasa. */
export interface CommandTranslation {
  name: string;
  description: string;
}

/** Kunci = nama perintah kanonik (Indonesia). */
export type CommandTranslations = Record<string, { en: CommandTranslation }>;

export const EN_COMMAND_TRANSLATIONS: CommandTranslations = {
  // ── Musik ──────────────────────────────────────────────
  play: { en: { name: 'play', description: 'Play a track or add it to the queue' } },
  pause: { en: { name: 'pause', description: 'Pause the track that is playing' } },
  resume: { en: { name: 'resume', description: 'Resume the paused playback' } },
  skip: { en: { name: 'skip', description: 'Skip the track that is playing' } },
  stop: { en: { name: 'stop', description: 'Stop playback and clear the queue' } },
  queue: { en: { name: 'queue', description: 'Show the queue on this server' } },
  'nowplaying': { en: { name: 'nowplaying', description: 'Show the track that is playing' } },
  remove: { en: { name: 'remove', description: 'Remove one track from the queue' } },
  move: { en: { name: 'move', description: 'Move a track to another queue position' } },
  shuffle: { en: { name: 'shuffle', description: 'Shuffle the order of the upcoming tracks' } },
  loop: { en: { name: 'loop', description: 'Set the repeat mode: one track or the whole queue' } },
  volume: { en: { name: 'volume', description: 'Set the playback volume' } },
  seek: { en: { name: 'seek', description: 'Jump to a position in the current track' } },
  filter: { en: { name: 'filter', description: 'Change the sound: bassboost, nightcore, vaporwave or 8D' } },
  disconnect: { en: { name: 'disconnect', description: 'Remove the bot from the voice channel and clear the queue' } },
  search: { en: { name: 'search', description: 'Search for a track and pick from the results' } },
  lyrics: { en: { name: 'lyrics', description: 'Show lyrics for the current track, or search by title' } },
  playlist: { en: { name: 'playlist', description: 'Save and play your own track playlists' } },
  '247': { en: { name: '247', description: 'Keep one voice channel occupied by the bot 24/7' } },
  stats: { en: { name: 'stats', description: 'Track and command stats for this server' } },

  // ── Moderasi ───────────────────────────────────────────
  ban: { en: { name: 'ban', description: 'Ban a member from the server' } },
  unban: { en: { name: 'unban', description: 'Unban a user by ID' } },
  kick: { en: { name: 'kick', description: 'Kick a member from the server' } },
  timeout: { en: { name: 'timeout', description: 'Mute a member temporarily (up to 28 days)' } },
  warn: { en: { name: 'warn', description: 'Give a member a stored warning' } },
  warnings: { en: { name: 'warnings', description: 'Show the warning history of a member' } },
  unwarn: { en: { name: 'unwarn', description: 'Remove a warning by case number' } },
  purge: { en: { name: 'purge', description: 'Bulk delete messages in this channel (max 100)' } },
  lock: { en: { name: 'lock', description: 'Lock this channel for @everyone' } },
  unlock: { en: { name: 'unlock', description: 'Unlock this channel for @everyone' } },
  slowmode: { en: { name: 'slowmode', description: 'Set the slowmode of this channel' } },
  note: { en: { name: 'note', description: 'Internal note about a member (changes nothing on Discord)' } },
  case: { en: { name: 'case', description: 'Summary of one moderation case with its actions and logs' } },
  modprofile: { en: { name: 'modprofile', description: 'All cases of one moderator with their action stats' } },
  automod: { en: { name: 'automod', description: 'Manage the automod rules of this server' } },

  // ── Logging, tiket, welcome ────────────────────────────
  logging: { en: { name: 'logging', description: 'Route log channels per category' } },
  logs: { en: { name: 'logs', description: 'Search the server log history' } },
  ticket: { en: { name: 'ticket', description: 'Basic ticket system: private channels for support requests' } },
  reactionrole: { en: { name: 'reactionrole', description: 'Self-assign roles panel (members pick their own roles)' } },
  setup: { en: { name: 'setup', description: 'Guide to set the bot up here (channels, DJ role, modules)' } },
  config: { en: { name: 'config', description: 'View or change the bot configuration on this server' } },

  // ── Perintah custom, privasi, utilitas ─────────────────
  customcommand: {
    en: { name: 'customcommand', description: 'Manage custom commands (replies triggered with !name)' },
  },
  privacy: { en: { name: 'privacy', description: 'See what Harmony stores about you on this server' } },
  'data-delete': {
    en: { name: 'data-delete', description: 'Delete the personal data Harmony stores about you here' },
  },
  help: { en: { name: 'help', description: 'Show the list of available commands' } },
  ping: { en: { name: 'ping', description: 'Check the bot latency and connection status' } },
};

/** Batas Discord untuk deskripsi perintah. */
export const MAX_COMMAND_DESCRIPTION_LENGTH = 100;

/** Nama perintah yang belum punya terjemahan Inggris. */
export function commandsMissingTranslation(commandNames: readonly string[]): string[] {
  return commandNames.filter((name) => EN_COMMAND_TRANSLATIONS[name] === undefined);
}