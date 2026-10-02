import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { describeSlowmode, parseSlowmodeSeconds } from '../../modules/moderation/index.js';
import { errorEmbed } from '../../utils/embeds.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  auditReason,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
  runChannelAction,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Atur slowmode channel ini')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.slowmode.bit)
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Durasi: 0/off, 30s, 5m, 2h (maks 6h; angka polos = detik)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Alasan perubahan').setMaxLength(1_000),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.slowmode);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const channel = interaction.channel;
      if (
        !channel ||
        !channel.isTextBased() ||
        channel.isDMBased() ||
        channel.isVoiceBased() ||
        !('setRateLimitPerUser' in channel)
      ) {
        await replyEphemeralError(
          interaction,
          errorEmbed('Perintah ini hanya bisa dipakai di channel teks dalam server.'),
        );
        return;
      }

      const rawDuration = interaction.options.getString('duration', true);
      const seconds = parseSlowmodeSeconds(rawDuration);

      if (seconds === null) {
        await replyEphemeralError(
          interaction,
          errorEmbed(
            `Durasi \`${rawDuration}\` tidak valid. Pakai \`0\`/\`off\`, \`30s\`, \`5m\`, atau \`2h\` (maksimal 6 jam).`,
          ),
        );
        return;
      }

      const reason = interaction.options.getString('reason');

      await runChannelAction({
        interaction,
        ctx,
        channelId: channel.id,
        action: 'slowmode',
        reason,
        execute: async () => {
          await channel.setRateLimitPerUser(seconds, auditReason(interaction.user, reason));
        },
        extraLines: [
          seconds === 0
            ? '🐌 Slowmode **dimatikan**.'
            : `🐌 Slowmode disetel ke **${describeSlowmode(seconds)}**.`,
        ],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'slowmode');
    }
  },
} satisfies BotCommand;
