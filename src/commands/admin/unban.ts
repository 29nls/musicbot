import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  auditReason,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
  runModerationAction,
} from './_shared.js';

const USER_ID_PATTERN = /^\d{17,20}$/;

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Buka ban berdasarkan ID user')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.unban.bit)
    .addStringOption((option) =>
      option
        .setName('user')
        .setDescription('ID user yang di-ban (17–20 digit)')
        .setRequired(true)
        .setMaxLength(20),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan unban').setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.unban);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const rawId = interaction.options.getString('user', true).trim();
      if (!USER_ID_PATTERN.test(rawId)) {
        await replyEphemeralError(
          interaction,
          errorEmbed('Masukkan **ID user** yang valid (17–20 digit), bukan nama atau mention.'),
        );
        return;
      }

      // Tanpa cek hierarki: target tidak berada di server, jadi tidak ada
      // konflik posisi role. Cukup pastikan dia memang sedang di-ban.
      const ban = await ctx.guild.bans.fetch(rawId).catch(() => null);
      if (!ban) {
        await replyEphemeralError(
          interaction,
          errorEmbed(`User \`${rawId}\` tidak sedang di-ban di server ini.`),
        );
        return;
      }

      const reason = interaction.options.getString('reason');

      await runModerationAction({
        interaction,
        ctx,
        user: ban.user,
        action: 'unban',
        reason,
        execute: async () => {
          await ctx.guild.members.unban(rawId, auditReason(interaction.user, reason));
        },
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'unban');
    }
  },
} satisfies BotCommand;
