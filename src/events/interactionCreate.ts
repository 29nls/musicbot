import { Events, MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { BotClient } from '../client.js';
import { routeComponent } from '../handlers/componentRouter.js';
import { getMetricsRegistry } from '../modules/metrics/index.js';
import { getStatsService } from '../modules/stats/index.js';
import { getLogger } from '../services/logger.js';
import { checkCooldown } from '../utils/cooldown.js';
import { errorEmbed, warningEmbed } from '../utils/embeds.js';

export default {
  name: Events.InteractionCreate,
  async execute(client: BotClient, interaction: Interaction): Promise<void> {
    // Komponen milik fitur (panel role, tombol tiket, modal tiket) ditangani
    // router global, bukan sebagai perintah slash.
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await routeComponent(interaction);
      return;
    }

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

    const waitSeconds = await checkCooldown(
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

    // Statistik pemakaian perintah (Fase 3, §5.3): dicatat setelah gerbang izin
    // dan cooldown lolos, jadi yang terhitung adalah perintah yang benar-benar
    // dijalankan, bukan yang ditolak sebelum dijalankan.
    recordCommandUsage(interaction);
    getMetricsRegistry().record('command');

    try {
      await command.execute(interaction, client);
    } catch (error) {
      getMetricsRegistry().record('command', 'error');
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

/**
 * Catat pemakaian perintah untuk statistik.
 *
 * Hanya nama perintahnya yang dikirim (tanpa argumen) dan hanya di server —
 * Statistik per-server tidak bisa dibangun dari DM. Kegagalannya tidak
 * boleh menggagalkan perintah yang sedang berjalan.
 */
function recordCommandUsage(interaction: ChatInputCommandInteraction): void {
  const guildId = interaction.guildId;
  if (!guildId) return;

  void getStatsService()
    .recordCommand(interaction.commandName, guildId)
    .catch(() => undefined);
}

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
