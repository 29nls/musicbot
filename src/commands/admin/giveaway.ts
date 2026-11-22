import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  MAX_GIVEAWAY_WINNERS,
  MIN_GIVEAWAY_WINNERS,
  finishGiveaway,
  getGiveawayService,
  giveawayComponents,
  giveawayEmbed,
  parseGiveawayDuration,
  toGiveawayErrorEmbed,
} from '../../modules/giveaways/index.js';
import { defaultTranslator, translatorFor } from '../../modules/i18n/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { canManageGuild } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Buat dan akhiri giveaway di server ini')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Kirim giveaway baru di sebuah channel')
        .addStringOption((option) =>
          option
            .setName('prize')
            .setDescription('Hadiah yang diundi')
            .setMaxLength(200)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('duration')
            .setDescription('Lama giveaway, mis. 10m, 2h, 7d')
            .setMaxLength(20)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('winners')
            .setDescription('Jumlah pemenang')
            .setMinValue(MIN_GIVEAWAY_WINNERS)
            .setMaxValue(MAX_GIVEAWAY_WINNERS)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel tujuan; kosongkan untuk channel ini')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Akhiri giveaway sekarang dan undi pemenangnya')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('Nomor giveaway (ada di footer pesan)')
            .setMinValue(1)
            .setRequired(true),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(defaultTranslator('mod.gate.guildOnly'), defaultTranslator('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const t = await translatorFor(guildId);

    if (!interaction.inCachedGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const service = getGiveawayService();
    const sub = interaction.options.getSubcommand(true);

    try {
      if (sub === 'create') {
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        if (!isGuildTextChannel(channel)) {
          await interaction.editReply({
            embeds: [warningEmbed(t('giveaway.cmd.noChannel'), t('embed.title.warning'))],
          });
          return;
        }

        const endsAt = parseGiveawayDuration(
          interaction.options.getString('duration', true),
        );
        const giveaway = await service.create({
          guildId,
          channelId: channel.id,
          prize: interaction.options.getString('prize', true),
          winnersCount: interaction.options.getInteger('winners', true),
          endsAt,
        });

        try {
          const sent = await channel.send({
            embeds: [giveawayEmbed(giveaway, t)],
            components: [giveawayComponents(giveaway.id, t)],
          });
          await service.attachMessage(giveaway.id, sent.id);
        } catch (error) {
          // Jangan tinggalkan baris yang tidak punya pesan: giveaway itu tidak
          // akan pernah bisa diikuti atau ditutup dengan benar.
          await service.delete(guildId, giveaway.id).catch(() => undefined);
          throw error;
        }

        await interaction.editReply({
          embeds: [
            successEmbed(
              t('giveaway.cmd.created', {
                prize: giveaway.prize,
                channel: channel.id,
                endsAt: String(Math.floor(endsAt.getTime() / 1_000)),
              }),
              t('giveaway.cmd.createdTitle'),
            ),
          ],
        });
        return;
      }

      const giveawayId = interaction.options.getInteger('id', true);
      const outcome = await service.end(guildId, giveawayId);
      if (!outcome) {
        await interaction.editReply({
          embeds: [
            warningEmbed(
              t('giveaway.cmd.notFound', { id: String(giveawayId) }),
              t('embed.title.warning'),
            ),
          ],
        });
        return;
      }

      if (!outcome.changed) {
        await interaction.editReply({
          embeds: [warningEmbed(t('giveaway.cmd.alreadyEnded'), t('embed.title.warning'))],
        });
        return;
      }

      const finished = await finishGiveaway(
        interaction.guild,
        outcome.giveaway,
        outcome.winners,
        outcome.entryCount,
        t,
      );
      const winners =
        outcome.winners.length > 0
          ? outcome.winners.map((id) => `<@${id}>`).join(', ')
          : t('giveaway.cmd.noWinners');
      const summary = t('giveaway.cmd.ended', {
        prize: outcome.giveaway.prize,
        winners,
      });

      await interaction.editReply({
        embeds: [
          finished.announced
            ? successEmbed(summary, t('giveaway.cmd.endedTitle'))
            : warningEmbed(
                t('giveaway.cmd.messageGone', {
                  prize: outcome.giveaway.prize,
                  winners,
                }),
                t('embed.title.warning'),
              ),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toGiveawayErrorEmbed(error, t)] });
    }
  },
} satisfies BotCommand;
