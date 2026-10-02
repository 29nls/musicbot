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

  try {
    const config = await getGuildConfigService().get(guildId);

    if (!config.modules.tickets) {
      await reply(interaction, warningEmbed('Modul tiket sedang mati di server ini.'));
      return;
    }

    // Pembuatan tiket butuh topik lebih dulu, jadi tombolnya membuka modal.
    if (action === 'create') await showTicketSubjectModal(interaction, config);
    else if (action === 'claim') await claimTicket(interaction, guildId, member, config);
    else await closeTicket(interaction, guild, member, config);
  } catch (error) {
    getLogger().error(
      { err: error, action, guild: guildId, user: interaction.user.id },
      'Tombol tiket gagal diproses',
    );
    await reply(interaction, toTicketErrorEmbed(error));
  }
}

async function claimTicket(
  interaction: ButtonInteraction,
  guildId: string,
  member: GuildMember,
  config: GuildConfig,
): Promise<void> {
  if (!isStaff(member, config)) {
    await reply(interaction, warningEmbed('Hanya staff tiket yang bisa mengklaim tiket ini.'));
    return;
  }

  const ticket = await getTicketService().findOpenByChannel(guildId, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed('Tiket ini sudah ditutup.'));
    return;
  }

  const claimed = await getTicketService().claim(guildId, interaction.channelId, interaction.user.id);
  if (!claimed) {
    await reply(interaction, warningEmbed('Tiket ini sudah ditutup.'));
    return;
  }

  await reply(
    interaction,
    successEmbed(`Tiket ${claimed.ticketNumber} sekarang ditangani <@${interaction.user.id}>.`),
  );
}

async function closeTicket(
  interaction: ButtonInteraction,
  guild: Guild,
  member: GuildMember,
  config: GuildConfig,
): Promise<void> {
  const ticket = await getTicketService().findOpenByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await reply(interaction, warningEmbed('Tiket ini sudah tertutup.'));
    return;
  }

  // Yang boleh menutup: staff tiket, atau member yang membuka tiketnya sendiri.
  const isOwner = ticket.openerId === interaction.user.id;
  if (!isOwner && !isStaff(member, config)) {
    await reply(interaction, warningEmbed('Hanya staff atau pembuat tiket yang bisa menutupnya.'));
    return;
  }

  const result = await closeAndArchive(
    getTicketService(),
    guild,
    interaction.channelId,
    interaction.user.id,
  );
  if (!result) {
    await reply(interaction, warningEmbed('Tiket ini sudah tertutup.'));
    return;
  }

  if (!result.channel) {
    await reply(
      interaction,
      warningEmbed(
        `Tiket ${result.ticket.ticketNumber} ditandai sudah tertutup, tapi channelnya tidak bisa diarsipkan ` +
          '(mungkin sudah dihapus manual). Periksa datanya.',
      ),
    );
    return;
  }

  await reply(
    interaction,
    successEmbed(`Tiket ${result.ticket.ticketNumber} ditutup dan diarsipkan. Isinya tetap tersimpan.`),
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