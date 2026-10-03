import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  formatCaseId,
  parseCaseNumber,
  sendGuildEmbed,
  warningRevokedDmEmbed,
  warningRevokedLogEmbed,
} from '../../modules/moderation/index.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  deliveryNotes,
  dmTarget,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Cabut peringatan berdasarkan nomor kasus')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.unwarn.bit)
    .addStringOption((option) =>
      option
        .setName('case')
        .setDescription('Nomor kasus, mis. #CASE-0007')
        .setRequired(true)
        .setMaxLength(20),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.unwarn);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const rawCase = interaction.options.getString('case', true);
      const caseNumber = parseCaseNumber(rawCase);

      if (caseNumber === null) {
        await replyEphemeralError(
          interaction,
          errorEmbed(ctx.t('mod.case.parseError')),
        );
        return;
      }

      const revoked = await ctx.moderation.revokeWarning(ctx.guildId, caseNumber);
      if (!revoked) {
        await replyEphemeralError(
          interaction,
          errorEmbed(
            ctx.t('mod.case.notFound', { case: formatCaseId(caseNumber) }),
          ),
        );
        return;
      }

      const target = await client.users.fetch(revoked.targetId).catch(() => null);
      const dmSent = target
        ? await dmTarget(
            target,
            warningRevokedDmEmbed(
              {
                caseNumber,
                guildName: ctx.guild.name,
                moderatorId: interaction.user.id,
              },
              ctx.t,
            ),
          )
        : false;

      const logged = await sendGuildEmbed(
        ctx.guild,
        ctx.config.logChannelId,
        warningRevokedLogEmbed(
          {
            caseNumber,
            targetId: revoked.targetId,
            moderatorId: interaction.user.id,
          },
          ctx.t,
        ),
      );

      const lines = [
        ctx.t('mod.unwarn.revokedLine', {
          case: formatCaseId(caseNumber),
          target: revoked.targetId,
        }),
        ...deliveryNotes(dmSent, logged, ctx.t),
      ];

      await interaction.editReply({
        embeds: [successEmbed(lines.join('\n'), ctx.t('mod.log.revokedTitle'))],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'unwarn');
    }
  },
} satisfies BotCommand;
