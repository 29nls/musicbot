import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { getEnv } from './config/env.js';
import { getLogger } from './services/logger.js';
import type { BotCommand } from './types/command.js';

/**
 * Intent yang selalu diminta bot, apa pun modenya.
 *
 * Semua dari sini gratis (tidak perlu persetujuan Developer Portal): guild,
 * channel, role, moderasi, dan voice state.
 */
const BASE_INTENTS = [
  GatewayIntentBits.Guilds, // perintah dasar, channel, role
  GatewayIntentBits.GuildModeration, // ban/unban
  GatewayIntentBits.GuildVoiceStates, // musik
] as const;

/**
 * Intent *privileged*: harus diaktifkan manual di Developer Portal → aplikasi →
 * Bot → Privileged Gateway Intents. Tanpa itu gateway menutup koneksi dengan
 * kode 4014 dan bot gagal login.
 */
const PRIVILEGED_INTENTS = [
  GatewayIntentBits.GuildMembers, // welcome, autorole, moderasi member
  GatewayIntentBits.GuildMessages, // automod, logging pesan
  GatewayIntentBits.MessageContent, // isi pesan untuk automod
] as const;

/** Nama fitur yang mati kalau intent privileged tidak diminta. */
export const MINIMAL_MODE_DISABLED_FEATURES =
  'welcome, goodbye, autorole, automod, dan logging pesan';

/**
 * Intent yang dikirim ke gateway.
 *
 * Mode minimal dipakai hanya untuk keadaan darurat: developer portal sedang tidak bisa
 * diakses, jadi bot perlu tetap bisa login untuk menguji perintah yang tidak
 * bergantung member. Default-nya tetap mode penuh — mode minimal selalu
 * menulis peringatan di log supaya tidak pernah disalahartikan sebagai
 * konfigurasi normal.
 */
export function resolveIntents(minimal: boolean): GatewayIntentBits[] {
  const intents = [...BASE_INTENTS] as GatewayIntentBits[];
  if (!minimal) intents.push(...PRIVILEGED_INTENTS);
  return intents;
}

/**
 * Client bot Harmony.
 *
 * Catatan intent: `GuildMembers` dan `MessageContent` adalah *privileged intent*
 * yang harus diaktifkan manual di Discord Developer Portal → Bot → Privileged
 * Gateway Intents, kalau tidak bot akan gagal login.
 */
export class BotClient extends Client {
  public readonly commands = new Collection<string, BotCommand>();

  constructor() {
    const minimal = getEnv().BOT_INTENTS_MINIMAL;

    super({
      intents: resolveIntents(minimal),
      partials: minimal ? [Partials.Channel] : [Partials.Channel, Partials.Message, Partials.GuildMember],
      // Anti mass-mention: bot tidak akan pernah ping @everyone/@here secara tidak sengaja.
      allowedMentions: { parse: ['users'], repliedUser: false },
      waitGuildTimeout: 15_000,
    });

    if (minimal) {
      getLogger().warn(
        { disabled: MINIMAL_MODE_DISABLED_FEATURES },
        'BOT_INTENTS_MINIMAL=true — privileged intent tidak diminta, jadi ' +
          'welcome, goodbye, autorole, automod, dan logging pesan tidak berfungsi. ' +
          'Aktifkan Server Members Intent & Message Content Intent di Developer Portal, lalu matikan flag ini.',
      );
    }
  }
}