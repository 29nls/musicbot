import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import {
  TICKET_LIST_LIMIT,
  buildCreateButton,
  closeAndArchive,
  getTicketService,
  isStaff,
  missingTicketConfig,
  renderTranscriptText,
  ticketListEmbed,
  ticketPanelEmbed,
  ticketTranscriptEmbed,
  toTicketErrorEmbed,
  type Ticket,
} from '../../modules/tickets/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { canManageGuild } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Sistem tiket dasar: channel privat untuk permintaan bantuan')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Atur kategori, role staff, dan kirim tombol tiket')
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('Kategori tempat channel tiket dibuat')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('staff')
            .setDescription('Role yang bisa melihat & menutup semua tiket')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('panel')
            .setDescription('Channel tempat tombol "Buat Tiket" dikirim')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Teks pengantar di atas tombol tiket')
            .setMaxLength(1_000),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Daftar tiket yang masih terbuka'))
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Tutup & arsipkan tiket yang sedang dibuka di channel ini'),
    ).addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Kirim ulang panel tiket ke channel panel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('transcript')
        .setDescription('Baca transkrip percakapan tiket (staff atau pembuat tiketnya)')
        .addIntegerOption((option) =>
          option
            .setName('ticket')
            .setDescription('Nomor tiket. Kosongkan untuk memakai tiket di channel ini.')
            .setMinValue(1),
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
    const sub = interaction.options.getSubcommand(true);

    // `transcript` sengaja dikecualikan: pembuat tiket boleh membaca transkrip
    // tiketnya sendiri, dan mereka tidak punya izin Manage Server. Kalau gate-nya
    // dipasang di sini, member bahkan tidak akan melihat perintahnya.
    if (sub !== 'transcript' && !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(t('ticket.err.notCached'), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const configs = getGuildConfigService();
      const config = await configs.get(guildId);

      if (!config.modules.tickets) {
        await interaction.editReply({
          embeds: [warningEmbed(t('ticket.err.moduleOff'), t('ticket.err.moduleOffTitle'))],
        });
        return;
      }

      if (sub === 'transcript') {
        await showTranscript(interaction, guildId, config, t);
        return;
      }

      if (sub === 'list') {
        const summary = await getTicketService().listOpen(guildId, TICKET_LIST_LIMIT);
        await interaction.editReply({
          embeds: [ticketListEmbed(summary.tickets, summary.total, t)],
        });
        return;
      }

      if (sub === 'close') {
        await closeFromCommand(interaction, guild, t);
        return;
      }

      await postPanel(interaction, guild, config, sub === 'setup', configs, t);
    } catch (error) {
      await interaction.editReply({ embeds: [toTicketErrorEmbed(error, t)] });
    }
  },
} satisfies BotCommand;

type Interaction = Parameters<BotCommand['execute']>[0];
type ConfigService = ReturnType<typeof getGuildConfigService>;

async function postPanel(
  interaction: Interaction,
  guild: Guild,
  config: Awaited<ReturnType<ConfigService['get']>>,
  isSetup: boolean,
  configs: ConfigService,
  t: Translator,
): Promise<void> {
  const incomplete = missingTicketConfig(config, t);
  if (incomplete) {
    await interaction.editReply({ embeds: [warningEmbed(incomplete, t('embed.title.warning'))] });
    return;
  }

  const staffRoleId = isSetup
    ? interaction.options.getRole('staff', true).id
    : (config.ticketStaffRoleId as string);

  const panelChannel = isSetup
    ? asPanelChannel(interaction.options.getChannel('panel', true))
    : await fetchChannel(guild, config.ticketPanelChannelId);

  if (!panelChannel) {
    await interaction.editReply({
      embeds: [warningEmbed(t('ticket.cmd.noPanelChannel'), t('embed.title.warning'))],
    });
    return;
  }

  if (isSetup) {
    const category = interaction.options.getChannel('category', true);
    await configs.update(guild.id, {
      ticketCategoryId: category.id,
      ticketStaffRoleId: staffRoleId,
      ticketPanelChannelId: panelChannel.id,
    });
  }

  const sent = await panelChannel.send({
    embeds: [
      ticketPanelEmbed(
        {
          staffRoleId,
          description: interaction.options.getString('description'),
        },
        t,
      ),
    ],
    components: [buildCreateButton(t)],
  });

  // Panel lama dihapus supaya member tidak punya dua tombol yang menunjuk ke
  // dua channel tiket yang berbeda.
  if (config.ticketPanelMessageId) {
    await deleteMessage(guild, config.ticketPanelChannelId, config.ticketPanelMessageId);
  }
  await configs.update(guild.id, { ticketPanelMessageId: sent.id });

  await interaction.editReply({
    embeds: [
      successEmbed(
        t(isSetup ? 'ticket.cmd.setupDone' : 'ticket.cmd.panelResent', {
          channel: panelChannel.id,
        }),
        t('ticket.cmd.panelTitle'),
      ),
    ],
  });
}

/**
 * `/ticket close` memakai jalur yang sama dengan tombol tutup, jadi database
 * dan channel tidak pernah bertentangan: satu sudah tertutup, yang lain masih
 * bisa diketik.
 */
/**
 * `/ticket transcript` — tampilkan isi percakapan tiket.
 *
 * Yang boleh membaca: staff tiket, atau member yang membuka tiket itu sendiri.
 * Aturan ini ditegakkan di sini, bukan hanya lewat `setDefaultMemberPermissions`,
 * karena pemilik tiket memang tidak punya izin admin sama sekali.
 */
async function showTranscript(
  interaction: Interaction,
  guildId: string,
  config: Awaited<ReturnType<ConfigService['get']>>,
  t: Translator,
): Promise<void> {
  const ticket = await resolveTicket(interaction, guildId);
  if (!ticket) {
    await interaction.editReply({
      embeds: [warningEmbed(t('ticket.cmd.noTicket'), t('embed.title.warning'))],
    });
    return;
  }

  const isOwner = ticket.openerId === interaction.user.id;
  if (!isOwner && !isStaff(interaction.member as GuildMember | null, config)) {
    await interaction.editReply({
      embeds: [warningEmbed(t('ticket.cmd.transcriptDenied'), t('embed.title.warning'))],
    });
    return;
  }

  const transcript = ticket.transcript;
  if (!transcript) {
    await interaction.editReply({
      embeds: [
        warningEmbed(t('ticket.cmd.noTranscript'), t('ticket.cmd.noTranscriptTitle')),
      ],
    });
    return;
  }

  const text = renderTranscriptText(ticket, transcript, t);
  await interaction.editReply({
    embeds: [ticketTranscriptEmbed(ticket, transcript, t)],
    files: [
      {
        attachment: Buffer.from(text, 'utf8'),
        name: transcriptFileName(ticket),
      },
    ],
  });
}

/** Tiket yang dimaksud: dari nomor opsional, atau dari channel tempat perintah dipanggil. */
async function resolveTicket(interaction: Interaction, guildId: string): Promise<Ticket | null> {
  const ticketNumber = interaction.options.getInteger('ticket');
  const service = getTicketService();

  if (ticketNumber !== null) return service.findByNumber(guildId, ticketNumber);

  return service.findAnyByChannel(guildId, interaction.channelId);
}

/** `transkrip-tiket-0007.txt` — nomor tiket dipadatkan supaya rapi saat diunduh. */
function transcriptFileName(ticket: Ticket): string {
  const number = ticket.ticketNumber.toString().padStart(4, '0');

  return `transkrip-tiket-${number}.txt`;
}

async function closeFromCommand(
  interaction: Interaction,
  guild: Guild,
  t: Translator,
): Promise<void> {
  const ticket = await getTicketService().findOpenByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await interaction.editReply({
      embeds: [warningEmbed(t('ticket.cmd.noOpenHere'), t('embed.title.warning'))],
    });
    return;
  }

  const result = await closeAndArchive(
    getTicketService(),
    guild,
    interaction.channelId,
    interaction.user.id,
    new Date(),
    t,
  );
  if (!result) {
    await interaction.editReply({ embeds: [warningEmbed(t('ticket.err.alreadyClosed'), t('embed.title.warning'))] });
    return;
  }

  if (!result.channel) {
    await interaction.editReply({
      embeds: [warningEmbed(t('ticket.cmd.closedChannelGone', { number: result.ticket.ticketNumber }), t('embed.title.warning'))],
    });
    return;
  }

  await interaction.editReply({
    embeds: [successEmbed(t('ticket.cmd.closed', { number: result.ticket.ticketNumber }), t('embed.title.success'))],
  });
}

async function fetchChannel(
  guild: Guild,
  channelId: string | null,
): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  return isGuildTextChannel(channel) ? channel : null;
}

/** Sama seperti `fetchChannel`, tapi untuk channel dari opsi slash command. */
function asPanelChannel(channel: unknown): GuildTextBasedChannel | null {
  return isGuildTextChannel(channel) ? channel : null;
}

async function deleteMessage(
  guild: Guild,
  channelId: string | null,
  messageId: string,
): Promise<void> {
  const channel = await fetchChannel(guild, channelId);
  if (!channel) return;

  await channel.messages.delete(messageId).catch(() => undefined);
}