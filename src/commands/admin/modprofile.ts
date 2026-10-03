import {
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  moderatorProfileEmbed,
  moderatorRecentCasesEmbed,
} from '../../modules/moderation/index.js';
import type { BotCommand } from '../../types/command.js';
import { warningEmbed } from '../../utils/embeds.js';
import {
  ADMIN_PERMISSIONS,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
} from './_shared.js';

/**
 * `/modprofile` — seluruh aktivitas satu moderator dalam satu halaman.
 *
 * Ini alat bantu, bukan halaman monitoring: daftar kasus beserta alasan-alasannya
 * adalah data pribadi target, jadi jawabannya ephemeral seperti perintah admin lain.
 * Satu moderator boleh mengaudit moderator lain — konsistensi dengan `/case`, yang
 * juga menampilkan target & alasan pada Moderate Members.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('modprofile')
    .setDescription('Ringkasan seluruh kasus dari satu moderator beserta statistik aksinya')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.modprofile.bit)
    .addUserOption((option) =>
      option
        .setName('moderator')
        .setDescription('Moderator yang mau dilihat — boleh moderator itu sendiri')
        .setRequired(true),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.modprofile);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const moderator = interaction.options.getUser('moderator', true);

      // Moderator yang sudah keluar dari server tidak ada di cache; tanpa
      // cek ini embed akan menampilkan nama kosong alih-alih informasinya.
      const displayName = ctx.guild.members.cache.get(moderator.id)?.displayName ?? moderator.username;

      const profile = await ctx.moderation.moderatorProfile(ctx.guildId, moderator.id);

      if (profile.totals.total === 0) {
        await replyEphemeralError(
          interaction,
          warningEmbed(
            ctx.t('mod.profile.emptyForUser', { moderator: moderator.toString() }),
            ctx.t('mod.profile.emptyForUserTitle'),
          ),
        );
        return;
      }

      await interaction.editReply({
        embeds: [
          moderatorProfileEmbed(profile, { displayName }, ctx.t),
          moderatorRecentCasesEmbed(profile, ctx.t),
        ],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'modprofile');
    }
  },
} satisfies BotCommand;