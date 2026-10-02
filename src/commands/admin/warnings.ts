import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { MAX_WARNINGS_SHOWN, warningsEmbed } from '../../modules/moderation/index.js';
import type { BotCommand } from '../../types/command.js';
import { ADMIN_PERMISSIONS, gateAdminCommand, handleAdminFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Lihat riwayat peringatan seorang member')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.warnings.bit)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang ingin dilihat').setRequired(true),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.warnings);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const user = interaction.options.getUser('user', true);
      const summary = await ctx.moderation.listWarnings(ctx.guildId, user.id);

      const embed = warningsEmbed(
        { id: user.id, tag: user.tag },
        summary.warnings.slice(0, MAX_WARNINGS_SHOWN),
        summary.total,
      );

      if (summary.total > MAX_WARNINGS_SHOWN) {
        embed.setDescription(
          `${embed.data.description ?? ''}\n\n*+${summary.total - MAX_WARNINGS_SHOWN} peringatan lain tidak ditampilkan.*`.trim(),
        );
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'warnings');
    }
  },
} satisfies BotCommand;
