import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  auditReason,
  gateAdminCommand,
  handleAdminFailure,
  hierarchyFailure,
  replyEphemeralError,
  resolveTargetMember,
  runModerationAction,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban seorang member dari server')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.ban.bit)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang akan di-ban').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan ban').setMaxLength(1_000),
    )
    .addIntegerOption((option) =>
      option
        .setName('delete-messages')
        .setDescription('Hapus pesan dari N hari terakhir (0–7)')
        .setMinValue(0)
        .setMaxValue(7),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.ban);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason');
      const deleteDays = interaction.options.getInteger('delete-messages') ?? 0;

      const targetMember = await resolveTargetMember(ctx.guild, user.id);
      const failure = hierarchyFailure(ctx, user.id, targetMember);
      if (failure) {
        await replyEphemeralError(interaction, failure);
        return;
      }

      await runModerationAction({
        interaction,
        ctx,
        user,
        action: 'ban',
        reason,
        // Ban tidak bisa dibatalkan, jadi moderator perlu riwayat target sebelum
        // menekan tombolnya — bukan sesudah.
        withPriorCases: true,
        execute: async () => {
          await ctx.guild.members.ban(user.id, {
            reason: auditReason(interaction.user, reason),
            deleteMessageSeconds: deleteDays * 86_400,
          });
        },
        extraLines:
          deleteDays > 0 ? [`🧹 Pesan dari **${deleteDays}** hari terakhir ikut dihapus.`] : [],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'ban');
    }
  },
} satisfies BotCommand;
