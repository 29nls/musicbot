import { MessageFlags, SlashCommandBuilder } from 'discord.js';
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
    .setName('kick')
    .setDescription('Kick seorang member dari server')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.kick.bit)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang akan di-kick').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan kick').setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.kick);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason');
      const targetMember = await resolveTargetMember(ctx.guild, user.id);

      if (!targetMember) {
        await replyEphemeralError(
          interaction,
          errorEmbed('User itu bukan anggota server ini, jadi tidak bisa di-kick.'),
        );
        return;
      }

      const failure = hierarchyFailure(ctx, user.id, targetMember);
      if (failure) {
        await replyEphemeralError(interaction, failure);
        return;
      }

      await runModerationAction({
        interaction,
        ctx,
        user,
        action: 'kick',
        reason,
        execute: async () => {
          await targetMember.kick(auditReason(interaction.user, reason));
        },
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'kick');
    }
  },
} satisfies BotCommand;
