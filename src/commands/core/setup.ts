import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import {
  getGuildConfigService,
  renderConfigEmbed,
  toConfigErrorEmbed,
  MODULE_LABELS,
  type GuildConfig,
  type GuildConfigPatch,
  type ModulesEnabled,
} from '../../modules/config/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

const ID_LOG = 'setup:log';
const ID_WELCOME = 'setup:welcome';
const ID_DJ = 'setup:dj';
const ID_MODULES = 'setup:modules';
const ID_SAVE = 'setup:save';
const ID_CANCEL = 'setup:cancel';

const TIMEOUT_MS = 5 * 60_000;
const TITLE = '🧩 Setup Server';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Panduan menyiapkan bot di server ini (channel, role DJ, modul)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'core',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    if (!interaction.inGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini butuh izin **Manage Server**.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const service = getGuildConfigService();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Mulai dari konfigurasi yang sudah ada supaya /setup bisa dipakai ulang.
    let draft: GuildConfig;
    try {
      draft = await service.get(guildId);
    } catch (error) {
      await interaction.editReply({ embeds: [toConfigErrorEmbed(error)] });
      return;
    }

    const message = await interaction.editReply({
      embeds: [renderConfigEmbed(draft, TITLE)],
      components: buildComponents(draft),
    });

    let finished = false;

    const collector = message.createMessageComponentCollector({
      filter: (component) => component.user.id === interaction.user.id,
      time: TIMEOUT_MS,
    });

    collector.on('collect', async (component) => {
      if (component.isButton()) {
        finished = true;

        if (component.customId === ID_CANCEL) {
          await component.update({
            embeds: [warningEmbed('Setup dibatalkan. Tidak ada perubahan yang disimpan.', '🧩 Setup Server')],
            components: [],
          });
          collector.stop('cancelled');
          return;
        }

        try {
          const saved = await service.update(guildId, buildPatch(draft));
          await component.update({
            embeds: [
              successEmbed('Konfigurasi tersimpan dan langsung berlaku — tanpa restart bot.'),
              renderConfigEmbed(saved, TITLE),
            ],
            components: [],
          });
          collector.stop('saved');
        } catch (error) {
          finished = false;
          await component.update({
            embeds: [toConfigErrorEmbed(error), renderConfigEmbed(draft, TITLE)],
            components: buildComponents(draft),
          });
        }
        return;
      }

      if (component.isChannelSelectMenu()) {
        const channelId = component.values[0] ?? null;
        if (component.customId === ID_LOG) draft.logChannelId = channelId;
        if (component.customId === ID_WELCOME) draft.welcomeChannelId = channelId;
      }

      if (component.isRoleSelectMenu()) {
        draft.djRoleId = component.values[0] ?? null;
      }

      if (component.isStringSelectMenu()) {
        draft.modules = readModules(component.values);
      }

      await component.update({
        embeds: [renderConfigEmbed(draft, TITLE)],
        components: buildComponents(draft),
      });
    });

    collector.on('end', async () => {
      if (finished) return;
      // Habis waktu: matikan komponen supaya tidak bisa diklik lagi.
      await interaction.editReply({ components: [] }).catch(() => undefined);
    });
  },
} satisfies BotCommand;

/** Draft → patch (hanya berisi field yang diatur oleh wizard). */
function buildPatch(draft: GuildConfig): GuildConfigPatch {
  return {
    logChannelId: draft.logChannelId,
    welcomeChannelId: draft.welcomeChannelId,
    djRoleId: draft.djRoleId,
    modules: draft.modules,
  };
}

function readModules(values: string[]): ModulesEnabled {
  return {
    music: values.includes('music'),
    moderation: values.includes('moderation'),
    automod: values.includes('automod'),
    logging: values.includes('logging'),
    reactions: values.includes('reactions'),
    tickets: values.includes('tickets'),
    customCommands: values.includes('customCommands'),
  };
}

function buildComponents(draft: GuildConfig): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const keys = Object.keys(MODULE_LABELS) as (keyof ModulesEnabled)[];

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(ID_LOG)
        .setPlaceholder('📋 Channel log')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(ID_WELCOME)
        .setPlaceholder('👋 Channel welcome')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(ID_DJ)
        .setPlaceholder('🎧 Role DJ')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ID_MODULES)
        .setPlaceholder('🧩 Modul aktif')
        .setMinValues(1)
        .setMaxValues(keys.length)
        .addOptions(
          keys.map((key) => ({
            label: MODULE_LABELS[key].label,
            value: key,
            description: MODULE_LABELS[key].description,
            default: draft.modules[key],
          })),
        ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ID_SAVE).setLabel('Simpan').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ID_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Secondary),
    ),
  ];
}
