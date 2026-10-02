import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { dispatchLog } from '../../modules/logging/index.js';
import {
  dataDeleteConfirmEmbed,
  dataDeleteEmbed,
  dataDeleteLogEmbed,
  getPrivacyService,
  inventoryTouchedCount,
} from '../../modules/privacy/index.js';
import { getLogger } from '../../services/logger.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed } from '../../utils/embeds.js';

/**
 * Izin menjalankan permintaan atas nama user lain.
 *
 * ManageServer, bukan Moderate Members: Moderate Members cukup untuk *membaca*
 * kasus (itu yang dilakukan `/case`), tapi menghapus adalah tindakan merusak.
 * Bedanya nyata, jadi gerbangnya juga tidak boleh sama.
 */
const DELETE_FOR_OTHERS = PermissionFlagsBits.ManageGuild;

/** Kategori log; permintaan penghapusan data adalah kejadian audit, bukan pesan biasa. */
const LOG_CATEGORY = 'member' as const;

export default {
  data: new SlashCommandBuilder()
    .setName('data-delete')
    .setDescription('Hapus data pribadi yang disimpan Harmony tentangmu di server ini')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Member lain (butuh Manage Server; tanpa ini = data kamu sendiri)'),
    )
    .addBooleanOption((option) =>
      option
        .setName('confirm')
        .setDescription('Konfirmasi bahwa kamu ingin menghapus data ini')
        .setRequired(true),
    ),
  category: 'core',
  guildOnly: true,
  cooldownSeconds: 10,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!interaction.inCachedGuild()) {
        await interaction.editReply({
          embeds: [errorEmbed('Perintah ini hanya bisa dipakai di dalam server.')],
        });
        return;
      }

      const requested = interaction.options.getUser('user');
      const targetId = requested?.id ?? interaction.user.id;
      const isSelf = targetId === interaction.user.id;

      if (!isSelf && !interaction.memberPermissions?.has(DELETE_FOR_OTHERS)) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              'Untuk menghapus data orang lain, perintah ini butuh izin **Manage Server**.',
            ),
          ],
        });
        return;
      }

      const privacy = getPrivacyService();
      const inventory = await privacy.inventory(interaction.guildId, targetId);
      const empty = inventoryTouchedCount(inventory) === 0;

      // Dua langkah, bukan satu: ini satu-satunya perintah di bot yang menghapus
      // milik orang, jadi proyeksi dampaknya harus dibaca pemohon sebelum
      // dieksekusi — bukan dilaporkan setelahnya.
      if (!interaction.options.getBoolean('confirm', true)) {
        await interaction.editReply({
          embeds: [
            dataDeleteConfirmEmbed(inventory),
            ...(empty
              ? [
                  errorEmbed(
                    'Tidak ada data yang tersimpan di server ini — menjalankan perintah ini tidak akan mengubah apa pun.',
                  ),
                ]
              : []),
          ],
        });
        return;
      }

      const outcome = await privacy.anonymize(interaction.guildId, targetId);

      // Dicatat ke channel log server supaya permintaan atas nama orang lain
      // punya jejak yang bisa dilihat owner server. Best-effort: kegagalan log
      // tidak membatalkan permintaan yang sudah terlanjur berjalan, tapi tetap
      // dicatat di log internal supaya tidak hilang tanpa jejak.
      await dispatchLog(
        interaction.guild,
        LOG_CATEGORY,
        dataDeleteLogEmbed({ actorId: interaction.user.id, targetId, outcome }),
        {
          eventKey: 'privacy.dataDelete',
          targetId,
          executorId: interaction.user.id,
        },
      ).catch((error: unknown) => {
        getLogger()
          .warn(
            { err: error, guildId: interaction.guildId },
            'Gagal mencatat permintaan penghapusan data ke log server',
          );
      });

      await interaction.editReply({ embeds: [dataDeleteEmbed(outcome)] });
    } catch (error) {
      getLogger().error(
        { err: error, user: interaction.user.id, guild: interaction.guildId },
        'Permintaan penghapusan data gagal',
      );

      await interaction.editReply({
        embeds: [
          errorEmbed(
            'Permintaan gagal diproses, jadi **ada data yang mungkin belum terhapus**. ' +
              'Coba lagi sebentar lagi, atau laporkan ke owner server.',
          ),
        ],
      });
    }
  },
} satisfies BotCommand;