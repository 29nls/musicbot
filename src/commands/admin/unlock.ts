import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  auditReason,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
  resolveLockPlan,
  runChannelAction,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Buka kunci channel ini untuk @everyone')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.unlock.bit)
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan membuka kunci').setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.unlock);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const plan = resolveLockPlan(interaction, ctx.t);
      if (!plan.ok) {
        await replyEphemeralError(interaction, plan.embed);
        return;
      }

      const reason = interaction.options.getString('reason');

      await runChannelAction({
        interaction,
        ctx,
        channelId: plan.channelId,
        action: 'unlock',
        reason,
        execute: async () => {
          // null = hapus override, jadi izin kembali mengikuti default server.
          await plan.apply(false, auditReason(interaction.user, reason, ctx.t));
        },
        extraLines: [ctx.t('mod.unlock.restoredLine', { channel: plan.label })],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'unlock');
    }
  },
} satisfies BotCommand;
