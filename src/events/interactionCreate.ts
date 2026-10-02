import { Events, MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { BotClient } from '../client.js';
import { getLogger } from '../services/logger.js';
import { checkCooldown } from '../utils/cooldown.js';
import { errorEmbed, warningEmbed } from '../utils/embeds.js';

export default {
  name: Events.InteractionCreate,
  async execute(client: BotClient, interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const logger = getLogger();
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn({ command: interaction.commandName, user: interaction.user.id }, 'Perintah tidak dikenal');
      await interaction.reply({
        embeds: [errorEmbed('Perintah ini belum terdaftar. Coba deploy ulang perintah lalu tunggu beberapa saat.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (command.guildOnly && !interaction.inGuild()) {
      await interaction.reply({
        embeds: [errorEmbed('Perintah ini hanya bisa dipakai di dalam server.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const waitSeconds = checkCooldown(
      `${interaction.user.id}:${interaction.commandName}`,
      command.cooldownSeconds ?? 0,
    );

    if (waitSeconds > 0) {
      await interaction.reply({
        embeds: [warningEmbed(`Tunggu **${waitSeconds} detik** sebelum memakai \`/${interaction.commandName}\` lagi.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      logger.error(
        {
          err: error,
          command: interaction.commandName,
          user: interaction.user.id,
          guild: interaction.guildId,
        },
        'Eksekusi perintah gagal',
      );
      await replyWithFailure(interaction);
    }
  },
};

/** Balas dengan pesan error sesuai kondisi interaksi (belum dibalas / sudah di-defer). */
async function replyWithFailure(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const embed = errorEmbed('Terjadi kesalahan saat menjalankan perintah. Detailnya sudah dicatat di log bot.');

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    getLogger().error({ err: error, command: interaction.commandName }, 'Gagal mengirim pesan error ke user');
  }
}
