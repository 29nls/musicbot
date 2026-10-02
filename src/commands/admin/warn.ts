import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  moderationDmEmbed,
  moderationLogEmbed,
  moderationResultEmbed,
} from '../../modules/moderation/index.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  deliverCaseLog,
  deliveryNotes,
  dmTarget,
  gateAdminCommand,
  handleAdminFailure,
  hierarchyFailure,
  replyEphemeralError,
  resolveTargetMember,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Beri peringatan tersimpan ke seorang member')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.warn.bit)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang akan diberi peringatan').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Alasan peringatan')
        .setRequired(true)
        .setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.warn);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);

      const targetMember = await resolveTargetMember(ctx.guild, user.id);
      const failure = hierarchyFailure(ctx, user.id, targetMember);
      if (failure) {
        await replyEphemeralError(interaction, failure);
        return;
      }

      const created = (
        await ctx.moderation.recordWarning({
          guildId: ctx.guildId,
          targetId: user.id,
          moderatorId: interaction.user.id,
          reason,
        })
      ).case;

      const dmSent = await dmTarget(
        user,
        moderationDmEmbed({
          action: 'warn',
          caseNumber: created.caseNumber,
          guildName: ctx.guild.name,
          reason,
        }),
      );

      const caseEmbed = moderationLogEmbed({
        action: 'warn',
        caseNumber: created.caseNumber,
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason,
        createdAt: created.createdAt,
        dmSent,
      });

      const logged = await deliverCaseLog(ctx, 'warn', caseEmbed, {
        targetId: user.id,
        channelId: null,
        moderatorId: interaction.user.id,
        caseNumber: created.caseNumber,
      });

      // Jumlah total hanya informasi tambahan — jangan gagalkan perintah kalau gagal dibaca.
      const summary = await ctx.moderation.listWarnings(ctx.guildId, user.id).catch(() => null);
      const extraLines = [
        ...(summary ? [`📊 Total peringatan tercatat: **${summary.total}**`] : []),
        ...deliveryNotes(dmSent, logged),
      ];

      await interaction.editReply({
        embeds: [
          moderationResultEmbed({
            action: 'warn',
            caseNumber: created.caseNumber,
            targetId: user.id,
            reason,
            extraLines,
          }),
        ],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'warn');
    }
  },
} satisfies BotCommand;
