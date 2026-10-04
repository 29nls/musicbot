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
import { parseTicketButtonId } from './types.js';

/**
 * Tangani tombol tiket: buat (lewat modal), klaim, dan tutup.
 *
 * Semua jalur mengecek konfigurasi server lebih dulu, jadi tombol yang tertinggal
 * di channel lama tetap memberi pesan yang jelas ketika modulnya dimatikan.
 */
export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const action = parseTicketButtonId(interaction.customId);
  if (action === null) return;
  if (!interaction.inCachedGuild()) return;

  // Disalin di sini: penyempitan `inCachedGuild` hilang setelah await.
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const member = interaction.member;
  const t = await translatorFor(guildId);

  try {
    const config = await getGuildConfigService().get(guildId);

    if (!config.modules.tickets) {
      await reply(interaction, warningEmbed(t('ticket.err.moduleOff')));
      return;
    }

    // Pembuatan tiket butuh topik lebih dulu, jadi tombolnya membuka modal.
    if (action === 'create') await showTicketSubjectModal(interaction, config, t);
    else if (action === 'claim') await claimTicket(interaction, guildId, member, config, t);
    else await closeTicket(interaction, guild, member, config, t);
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
): Promise<void> {
  if (!isStaff(member, config)) {
    await reply(interaction, warningEmbed(t('ticket.btn.claimNotStaff')));
    return;
  }

  const ticket = await getTicketService().findOpenByChannel(guildId, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed')));
    return;
  }

  const claimed = await getTicketService().claim(guildId, interaction.channelId, interaction.user.id);
  if (!claimed) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed')));
    return;
  }

  await reply(
    interaction,
    successEmbed(t('ticket.btn.claimed', {
      number: claimed.ticketNumber,
      user: interaction.user.id,
    })),
  );
}

async function closeTicket(
  interaction: ButtonInteraction,
  guild: Guild,
  member: GuildMember,
  config: GuildConfig,
  t: Translator,
): Promise<void> {
  const ticket = await getTicketService().findOpenByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed')));
    return;
  }

  // Yang boleh menutup: staff tiket, atau member yang membuka tiketnya sendiri.
  const isOwner = ticket.openerId === interaction.user.id;
  if (!isOwner && !isStaff(member, config)) {
    await reply(interaction, warningEmbed(t('ticket.btn.closeNotAllowed')));
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
    await reply(interaction, warningEmbed(t('ticket.err.alreadyClosed')));
    return;
  }

  if (!result.channel) {
    await reply(
      interaction,
      warningEmbed(t('ticket.btn.closedChannelGone', { number: result.ticket.ticketNumber })),
    );
    return;
  }

  await reply(
    interaction,
    successEmbed(t('ticket.btn.closed', { number: result.ticket.ticketNumber })),
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