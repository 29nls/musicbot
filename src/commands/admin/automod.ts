import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  AUTOMOD_RULES,
  RULE_LABELS,
  THRESHOLD_RANGES,
  automodShowEmbed,
  describeThreshold,
  getAutomodService,
  toAutomodErrorEmbed,
  type AutomodRuleType,
} from '../../modules/automod/index.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

const RULE_CHOICES = AUTOMOD_RULES.map((type) => ({
  name: RULE_LABELS[type].label,
  value: type,
}));

const THRESHOLD_RULE_CHOICES = AUTOMOD_RULES.filter(
  (type) => THRESHOLD_RANGES[type] !== null,
).map((type) => ({ name: RULE_LABELS[type].label, value: type }));

const ACTION_CHOICES = [
  { name: 'Tambah', value: 'add' },
  { name: 'Hapus', value: 'remove' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Atur aturan automod server ini')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('show').setDescription('Tampilkan status semua rule automod'))
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Nyalakan atau matikan satu rule')
        .addStringOption((option) =>
          option
            .setName('rule')
            .setDescription('Rule yang diubah')
            .setRequired(true)
            .addChoices(...RULE_CHOICES),
        )
        .addBooleanOption((option) =>
          option.setName('enabled').setDescription('true = aktif').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('threshold')
        .setDescription('Ubah ambang pemicu satu rule')
        .addStringOption((option) =>
          option
            .setName('rule')
            .setDescription('Rule yang diubah')
            .setRequired(true)
            .addChoices(...THRESHOLD_RULE_CHOICES),
        )
        .addIntegerOption((option) =>
          option
            .setName('value')
            .setDescription('Nilai ambang baru')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('badword')
        .setDescription('Kelola daftar kata terlarang')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Tambah kata terlarang')
            .addStringOption((option) =>
              option
                .setName('word')
                .setDescription('Kata yang dilarang (2–50 karakter)')
                .setRequired(true)
                .setMaxLength(50),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Hapus kata terlarang')
            .addStringOption((option) =>
              option
                .setName('word')
                .setDescription('Kata yang diizinkan kembali')
                .setRequired(true)
                .setMaxLength(50),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('whitelist')
        .setDescription('Kelola pengecualian & daftar putih')
        .addSubcommand((sub) =>
          sub
            .setName('channel')
            .setDescription('Kecualikan channel dari automod')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Tambah atau hapus')
                .setRequired(true)
                .addChoices(...ACTION_CHOICES),
            )
            .addChannelOption((option) =>
              option.setName('channel').setDescription('Channel yang dikecualikan').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('role')
            .setDescription('Kecualikan role dari automod')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Tambah atau hapus')
                .setRequired(true)
                .addChoices(...ACTION_CHOICES),
            )
            .addRoleOption((option) =>
              option.setName('role').setDescription('Role yang dikecualikan').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('domain')
            .setDescription('Domain yang diizinkan untuk anti-link')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Tambah atau hapus')
                .setRequired(true)
                .addChoices(...ACTION_CHOICES),
            )
            .addStringOption((option) =>
              option
                .setName('domain')
                .setDescription('Contoh: youtube.com')
                .setRequired(true)
                .setMaxLength(100),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('invite')
            .setDescription('Kode invite yang diizinkan untuk anti-invite')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Tambah atau hapus')
                .setRequired(true)
                .addChoices(...ACTION_CHOICES),
            )
            .addStringOption((option) =>
              option
                .setName('code')
                .setDescription('Contoh: abc123 atau discord.gg/abc123')
                .setRequired(true)
                .setMaxLength(100),
            ),
        ),
    ),
  category: 'admin',
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
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(true);
    const service = getAutomodService();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (group === null && subcommand === 'show') {
        await replyUpdated(interaction, guildId);
        return;
      }

      if (group === null && subcommand === 'toggle') {
        const rule = interaction.options.getString('rule', true) as AutomodRuleType;
        const updated = await service.updateRule(guildId, rule, {
          enabled: interaction.options.getBoolean('enabled', true),
        });

        await replyUpdated(
          interaction,
          guildId,
          `${updated.enabled ? '✅' : '❌'} Rule **${RULE_LABELS[rule].label}** ${
            updated.enabled ? 'dinyalakan' : 'dimatikan'
          }.`,
        );
        return;
      }

      if (group === null && subcommand === 'threshold') {
        const rule = interaction.options.getString('rule', true) as AutomodRuleType;
        const updated = await service.updateRule(guildId, rule, {
          threshold: interaction.options.getInteger('value', true),
        });

        await replyUpdated(
          interaction,
          guildId,
          `🎚️ Ambang **${RULE_LABELS[rule].label}** diubah menjadi ${describeThreshold(rule, updated.threshold)}.`,
        );
        return;
      }

      if (group === 'badword') {
        const word = interaction.options.getString('word', true);

        if (subcommand === 'add') {
          await service.addListItem(guildId, 'badword', 'words', word);
          await replyUpdated(interaction, guildId, `🤬 Kata \`${word}\` ditambahkan ke daftar terlarang.`);
        } else {
          await service.removeListItem(guildId, 'badword', 'words', word);
          await replyUpdated(interaction, guildId, `✅ Kata \`${word}\` dihapus dari daftar terlarang.`);
        }
        return;
      }

      if (group === 'whitelist') {
        const add = interaction.options.getString('action', true) === 'add';

        if (subcommand === 'channel') {
          const channel = interaction.options.getChannel('channel', true);
          if (add) await service.addExemption(guildId, 'channels', channel.id);
          else await service.removeExemption(guildId, 'channels', channel.id);

          await replyUpdated(
            interaction,
            guildId,
            `🚫 <#${channel.id}> ${add ? 'dikecualikan dari' : 'kembali diperiksa oleh'} automod.`,
          );
          return;
        }

        if (subcommand === 'role') {
          const role = interaction.options.getRole('role', true);
          if (add) await service.addExemption(guildId, 'roles', role.id);
          else await service.removeExemption(guildId, 'roles', role.id);

          await replyUpdated(
            interaction,
            guildId,
            `🚫 <@&${role.id}> ${add ? 'dikecualikan dari' : 'kembali diperiksa oleh'} automod.`,
          );
          return;
        }

        if (subcommand === 'domain') {
          const domain = interaction.options.getString('domain', true);
          if (add) await service.addListItem(guildId, 'link', 'domains', domain);
          else await service.removeListItem(guildId, 'link', 'domains', domain);

          await replyUpdated(
            interaction,
            guildId,
            `🌐 Domain \`${domain}\` ${add ? 'diizinkan' : 'dihapus dari daftar izin'} untuk anti-link.`,
          );
          return;
        }

        const code = interaction.options.getString('code', true);
        if (add) await service.addListItem(guildId, 'invite', 'invites', code);
        else await service.removeListItem(guildId, 'invite', 'invites', code);

        await replyUpdated(
          interaction,
          guildId,
          `🔗 Invite \`${code}\` ${add ? 'diizinkan' : 'dihapus dari daftar izin'} untuk anti-invite.`,
        );
      }
    } catch (error) {
      await interaction.editReply({ embeds: [toAutomodErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;

/** Balas dengan pesan sukses + ringkasan automod terbaru (opsional). */
async function replyUpdated(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  message?: string,
): Promise<void> {
  const [config, policy] = await Promise.all([
    getGuildConfigService().get(guildId),
    getAutomodService().getPolicy(guildId),
  ]);

  const embeds = [];
  if (message) embeds.push(successEmbed(message, '🤖 Automod'));
  embeds.push(automodShowEmbed(policy, config.modules.automod));

  await interaction.editReply({ embeds });
}
