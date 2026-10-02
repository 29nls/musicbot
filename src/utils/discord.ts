import type { GuildTextBasedChannel } from 'discord.js';

/**
 * Cek apakah channel dari `interaction.options.getChannel()` bisa dikirim pesan di
 * server ini.
 *
 * Resolusi opsi slash command mengembalikan gabungan channel discord.js dengan
 * bentuk API mentah, dan bentuk API itu tidak punya `isTextBased()`. Guard ini
 * mempersempit kedua-duanya ke channel teks server (bukan DM) dengan memeriksa
 * metode yang benar-benar ada di objeknya.
 */
export function isGuildTextChannel(channel: unknown): channel is GuildTextBasedChannel {
  if (typeof channel !== 'object' || channel === null) return false;

  const candidate = channel as {
    isTextBased?: () => boolean;
    isDMBased?: () => boolean;
  };

  return candidate.isTextBased?.() === true && candidate.isDMBased?.() === false;
}