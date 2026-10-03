import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { defaultTranslator, translatorFor } from '../../modules/i18n/index.js';
import { getPrivacyService, privacyEmbed } from '../../modules/privacy/index.js';
import { getLogger } from '../../services/logger.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed } from '../../utils/embeds.js';

/** Izin untuk melihat data orang lain; sama dengan `/case`. */
const VIEW_OTHERS = 'ModerateMembers';

export default {
  data: new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('Lihat data apa yang disimpan Harmony tentangmu di server ini')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Member lain (butuh izin moderasi; tanpa ini = data kamu sendiri)'),
    ),
  category: 'core',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Diturunkan ke Bahasa Indonesia dan baru diganti Bahasa server begitu
    // `guildId` diketahui, supaya jalur sebelum itu (dan jalur gagal) tetap
    // punya kalimat untuk ditampilkan.
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

      const target = interaction.options.getUser('user');
      const isSelf = target === null || target.id === interaction.user.id;

      // Melihat inventaris orang lain sama saja dengan membaca kasusnya: jadi
      // gate-nya persis gate `/case`. Melonggarkan hanya karena embed-nya
      // terasa lebih ringan tidak mengubah kenyataan bahwa isinya sama sensitifnya.
      if (!isSelf && !(interaction.memberPermissions?.has(VIEW_OTHERS) ?? false)) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              t('privacy.gate.needsModerateMembers', { permission: VIEW_OTHERS }),
              t('embed.title.error'),
            ),
          ],
        });
        return;
      }

      const userId = target?.id ?? interaction.user.id;
      const inventory = await getPrivacyService().inventory(guildId, userId);

      await interaction.editReply({
        embeds: [privacyEmbed(inventory, t)],
      });
    } catch (error) {
      // Inventaris yang gagal ditampilkan lebih baik dikatakan gagal daripada
      // menampilkan "tidak ada data" — yang akan terbaca sebagai janji bahwa
      // tidak ada apa pun yang tersimpan.
      getLogger().error(
        { err: error, user: interaction.user.id, guild: interaction.guildId },
        'Perintah privacy gagal',
      );

      await interaction.editReply({
        embeds: [errorEmbed(t('privacy.err.readFailed'), t('embed.title.error'))],
      });
    }
  },
} satisfies BotCommand;