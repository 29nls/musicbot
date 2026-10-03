import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { describeTimeout, parseTimeoutDuration } from '../../modules/moderation/index.js';
import { errorEmbed } from '../../utils/embeds.js';
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
    .setName('timeout')
    .setDescription('Bisukan sementara seorang member (maks 28 hari)')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.timeout.bit)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang akan di-timeout').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Durasi: 30s, 10m, 2h, atau 7d (maks 28d)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan timeout').setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.timeout);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason');
      const rawDuration = interaction.options.getString('duration', true);
      const durationMs = parseTimeoutDuration(rawDuration);

      if (durationMs === null) {
        await replyEphemeralError(
          interaction,
          errorEmbed(ctx.t('mod.timeout.badDuration', { value: rawDuration })),
        );
        return;
      }

      const targetMember = await resolveTargetMember(ctx.guild, user.id);
      if (!targetMember) {
        await replyEphemeralError(
          interaction,
          errorEmbed(ctx.t('mod.notMember.timeout')),
        );
        return;
      }

      const failure = hierarchyFailure(ctx, user.id, targetMember);
      if (failure) {
        await replyEphemeralError(interaction, failure);
        return;
      }

      const expiresAt = new Date(Date.now() + durationMs);

      await runModerationAction({
        interaction,
        ctx,
        user,
        action: 'timeout',
        reason,
        expiresAt,
        execute: async () => {
          await targetMember.timeout(durationMs, auditReason(interaction.user, reason, ctx.t));
        },
        extraLines: [ctx.t('mod.timeout.appliedLine', { duration: describeTimeout(durationMs) })],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'timeout');
    }
  },
} satisfies BotCommand;
