import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService, type GuildConfig } from '../config/index.js';
import { translatorFor, type Translator } from '../i18n/index.js';
import { closeAndArchive } from './lifecycle.js';
import { showTicketSubjectModal } from './modal.js';
import { getTicketService } from './singleton.js';
import { toTicketErrorEmbed } from './errors.js';
import { parseTicketButtonId, type Ticket } from './types.js';

/**
 * Tangani tombol tiket: buat (lewat modal), klaim, dan tutup.
 *
 * Semua jalur mengecek konfigurasi server lebih dulu, jadi tombol yang tertinggal
 * di channel lama tetap memberi pesan yang jelas ketika modulnya dimatikan.
 */
/**
 * Dependency handler tombol tiket; lihat `ReactionRoleSelectDeps` untuk
 * alasan kenapa dependency-nya disuntikkan, bukan diambil dari singleton
 * di dalam fungsi.
 */
export interface TicketButtonDeps {
  /** Ambil konfigurasi server. */
  getConfig: (guildId: string) => Promise<GuildConfig>;
  /** Service tiket: cari tiket terbuka di channel itu. */
  findOpenByChannel: (guildId: string, channelId: string) => Promise<Ticket | null>;
  /** Klaim tiket; null kalau sudah diklaim atau ditutup. */
  claim: (guildId: string, channelId: string, userId: string) => Promise<Ticket | null>;
  /** Tutup tiket lalu arsipkan; lihat `closeAndArchive`. */
  closeAndArchive: typeof closeAndArchive;
  /** Buka modal topik untuk tombol "Buat Tiket". */
  showSubjectModal: typeof showTicketSubjectModal;
}

function defaultButtonDeps(): TicketButtonDeps {
  return {
    getConfig: (guildId) => getGuildConfigService().get(guildId),
    findOpenByChannel: (guildId, channelId) => getTicketService().findOpenByChannel(guildId, channelId),
    claim: (guildId, channelId, userId) => getTicketService().claim(guildId, channelId, userId),
    closeAndArchive,
    showSubjectModal: showTicketSubjectModal,
  };
}

export async function handleTicketButton(
  interaction: ButtonInteraction,
  deps: TicketButtonDeps = defaultButtonDeps(),
): Promise<void> {
  const action = parseTicketButtonId(interaction.customId);
  if (action === null) return;
  if (!interaction.inCachedGuild()) return;

  // Disalin di sini: penyempitan `inCachedGuild` hilang setelah await.
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const member = interaction.member;
  const t = await translatorFor(guildId);

  try {
    const config = await deps.getConfig(guildId);

    if (!config.modules.tickets) {
      await reply(interaction, warningEmbed(t('ticket.err.moduleOff'), t('embed.title.warning')));
      return;
    }

    // Pembuatan tiket butuh topik lebih dulu, jadi tombolnya membuka modal.
    if (action === 'create') await deps.showSubjectModal(interaction, config, t);
    else if (action === 'claim') await claimTicket(interaction, guildId, member, config, t, deps);
    else await closeTicket(interaction, guild, member, config, t, deps);
  } catch (error) {
    getLogger().error(
      { err: error, action, guild: guildId, user: interaction.user.id },
      'Tombol tiket gagal diproses',
    );
    await reply(interaction, toTicketErrorEmbed(error, t));
  }
}

async function claimTicket(
  interaction: ButtonInteraction,
  guildId: string,
  member: GuildMember,
  config: GuildConfig,
  t: Translator,
  deps: TicketButtonDeps,
): Promise<void> {
  if (!isStaff(member, config)) {
    await reply(interaction, warningEmbed(t('ticket.btn.claimNotStaff'), t('embed.title.warning')));
    return;
  }

  const ticket = await deps.findOpenByChannel(guildId, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed'), t('embed.title.warning')));
    return;
  }

  const claimed = await deps.claim(guildId, interaction.channelId, interaction.user.id);
  if (!claimed) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed'), t('embed.title.warning')));
    return;
  }

  await reply(
    interaction,
    successEmbed(t('ticket.btn.claimed', {
      number: claimed.ticketNumber,
      user: interaction.user.id,
    }), t('embed.title.success')),
  );
}

async function closeTicket(
  interaction: ButtonInteraction,
  guild: Guild,
  member: GuildMember,
  config: GuildConfig,
  t: Translator,
  deps: TicketButtonDeps,
): Promise<void> {
  const ticket = await deps.findOpenByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed'), t('embed.title.warning')));
    return;
  }

  // Yang boleh menutup: staff tiket, atau member yang membuka tiketnya sendiri.
  const isOwner = ticket.openerId === interaction.user.id;
  if (!isOwner && !isStaff(member, config)) {
    await reply(interaction, warningEmbed(t('ticket.btn.closeNotAllowed'), t('embed.title.warning')));
    return;
  }

  const result = await deps.closeAndArchive(
    {
      findOpenByChannel: deps.findOpenByChannel,
      claim: deps.claim,
    } as unknown as Parameters<typeof closeAndArchive>[0],
    guild,
    interaction.channelId,
    interaction.user.id,
    new Date(),
    t,
  );
  if (!result) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed'), t('embed.title.warning')));
    return;
  }

  if (!result.channel) {
    await reply(
      interaction,
      warningEmbed(t('ticket.btn.closedChannelGone', { number: result.ticket.ticketNumber }), t('embed.title.warning')),
    );
    return;
  }

  await reply(
    interaction,
    successEmbed(t('ticket.btn.closed', { number: result.ticket.ticketNumber }), t('embed.title.success')),
  );
}

/** Staff = punya role staff tiket, atau punya izin Manage Channels/Server. */
export function isStaff(member: GuildMember | null, config: GuildConfig): boolean {
  if (!member) return false;

  const staffRoleId = config.ticketStaffRoleId;
  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;

  return (
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

async function reply(interaction: ButtonInteraction, embed: EmbedBuilder): Promise<void> {
  try {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    // Tombol punya jendela balasan 3 detik; kalau sudah kedaluwarsa tidak ada
    // yang bisa dilakukan selain mencatatnya.
    getLogger().warn({ err: error }, 'Gagal membalas tombol tiket');
  }
}