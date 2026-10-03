import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { defaultTranslator, translatorFor } from '../../modules/i18n/index.js';
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
    // Urutannya bukan kebetulan: Discord menolak payload dengan
    // "Required options must be placed before non-required options" (50035), jadi
    // opsi wajib harus ditulis lebih dulu. `user` tetap opsional dan tetap
    // dibaca lebih dulu saat dieksekusi — urutan di payload hanya soal tampilan.
    .addBooleanOption((option) =>
      option
        .setName('confirm')
        .setDescription('Konfirmasi bahwa kamu ingin menghapus data ini')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Member lain (butuh Manage Server; tanpa ini = data kamu sendiri)'),
    ),
  category: 'core',
  guildOnly: true,
  cooldownSeconds: 10,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Sama seperti `/privacy`: mulai dari Bahasa Indonesia, lalu naik ke Bahasa
    // server begitu tahu guild mana yang sedang aktif.
    let t = defaultTranslator;

    try {
      if (!interaction.inCachedGuild()) {
        await interaction.editReply({
          embeds: [errorEmbed(t('mod.gate.guildOnly'), t('embed.title.error'))],
        });
        return;
      }

      const guildId = interaction.guildId;
      t = await translatorFor(guildId);

      const requested = interaction.options.getUser('user');
      const targetId = requested?.id ?? interaction.user.id;
      const isSelf = targetId === interaction.user.id;

      if (!isSelf && !interaction.memberPermissions?.has(DELETE_FOR_OTHERS)) {
        await interaction.editReply({
          embeds: [
            errorEmbed(t('privacy.gate.needsManageGuild'), t('embed.title.error')),
          ],
        });
        return;
      }

      const privacy = getPrivacyService();
      const inventory = await privacy.inventory(guildId, targetId);
      const empty = inventoryTouchedCount(inventory) === 0;

      // Dua langkah, bukan satu: ini satu-satunya perintah di bot yang menghapus
      // milik orang, jadi proyeksi dampaknya harus dibaca pemohon sebelum
      // dieksekusi — bukan dilaporkan setelahnya.
      if (!interaction.options.getBoolean('confirm', true)) {
        await interaction.editReply({
          embeds: [
            dataDeleteConfirmEmbed(inventory, t),
            ...(empty
              ? [errorEmbed(t('privacy.reply.emptyWarning'), t('embed.title.error'))]
              : []),
          ],
        });
        return;
      }

      const outcome = await privacy.anonymize(guildId, targetId);

      // Dicatat ke channel log server supaya permintaan atas nama orang lain
      // punya jejak yang bisa dilihat owner server. Best-effort: kegagalan log
      // tidak membatalkan permintaan yang sudah terlanjur berjalan, tapi tetap
      // dicatat di log internal supaya tidak hilang tanpa jejak.
      await dispatchLog(
        interaction.guild,
        LOG_CATEGORY,
        dataDeleteLogEmbed({ actorId: interaction.user.id, targetId, outcome }, t),
        {
          eventKey: 'privacy.dataDelete',
          targetId,
          executorId: interaction.user.id,
        },
      ).catch((error: unknown) => {
        getLogger()
          .warn(
            { err: error, guildId },
            'Gagal mencatat permintaan penghapusan data ke log server',
          );
      });

      await interaction.editReply({ embeds: [dataDeleteEmbed(outcome, t)] });
    } catch (error) {
      getLogger().error(
        { err: error, user: interaction.user.id, guild: interaction.guildId },
        'Permintaan penghapusan data gagal',
      );

      await interaction.editReply({
        embeds: [
          errorEmbed(t('privacy.err.deleteFailed'), t('embed.title.error')),
        ],
      });
    }
  },
} satisfies BotCommand;