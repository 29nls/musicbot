import type { ChatInputCommandInteraction, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import type { BotClient } from '../client.js';
import type { CommandCategory } from '../config/constants.js';

/**
 * Bentuk minimal dari builder slash command discord.js — cukup untuk
 * didaftarkan ke Discord tanpa mengunci tipe builder tertentu.
 */
export interface SlashCommandData {
  toJSON(): RESTPostAPIApplicationCommandsJSONBody;
}

export interface BotCommand {
  readonly data: SlashCommandData;
  readonly category: CommandCategory;
  /** Cooldown per user (detik). Tidak diisi / 0 = tanpa cooldown. */
  readonly cooldownSeconds?: number;
  /** true = hanya bisa dipakai di dalam server, bukan DM. */
  readonly guildOnly?: boolean;
  execute(interaction: ChatInputCommandInteraction, client: BotClient): Promise<void>;
}
