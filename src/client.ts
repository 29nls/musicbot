import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import type { BotCommand } from './types/command.js';

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
    super({
      intents: [
        GatewayIntentBits.Guilds, // perintah dasar, channel, role
        GatewayIntentBits.GuildMembers, // welcome, autorole, moderasi member (privileged)
        GatewayIntentBits.GuildModeration, // ban/unban
        GatewayIntentBits.GuildVoiceStates, // musik
        GatewayIntentBits.GuildMessages, // automod, logging pesan
        GatewayIntentBits.MessageContent, // isi pesan untuk automod (privileged)
      ],
      partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
      // Anti mass-mention: bot tidak akan pernah ping @everyone/@here secara tidak sengaja.
      allowedMentions: { parse: ['users'], repliedUser: false },
      waitGuildTimeout: 15_000,
    });
  }
}
