import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { getTicketService } from './singleton.js';
import { closedTicketChannelName, ticketChannelName } from './naming.js';
import { buildTicketControls, ticketClosedEmbed, ticketOpenedEmbed } from './embeds.js';
import type { TicketService } from './service.js';
import type { Ticket } from './types.js';

/** Hasil menutup tiket: null kalau tiketnya sudah tidak terbuka. */
export interface CloseResult {
  ticket: Ticket;
  channel: TextChannel | null;
}

/** Hasil membuka tiket — selalu salah satu dari dua sisi, tidak pernah exception. */
export type OpenTicketOutcome =
  | { ok: true; ticket: Ticket; channel: TextChannel }
  | {
      ok: false;
      reason: 'duplicate' | 'channel_failed';
      /** Channel tiket lama, kalau member sudah punya tiket terbuka. */
      existingChannelId: string | null;
    };

/**
 * Buka tiket: catat di database, buat channel privat, kirim embed pembuka.
 *
 * `service` disuntikkan supaya alurnya bisa diuji tanpa database. Kegagalan
 * pembuatan channel selalu menutup tiket yang baru dibuat — kalau tidak, tiket
 * "hantu" akan memblokir member membuka tiket baru selamanya.
 */
export async function openTicket(
  service: TicketService,
  guild: Guild,
  input: { staffRoleId: string; openerId: string; subject: string },
): Promise<OpenTicketOutcome> {
  const { ticket, existing } = await service.open({
    guildId: guild.id,
    openerId: input.openerId,
    subject: input.subject,
  });

  if (existing) {
    return { ok: false, reason: 'duplicate', existingChannelId: existing.channelId };
  }

  let channel: TextChannel;
  try {
    channel = await createTicketChannel(guild, ticket, input.openerId, input.staffRoleId);
  } catch (error) {
    await service.abandon(ticket.id, input.openerId).catch(() => undefined);
    getLogger().error({ err: error, guild: guild.id }, 'Gagal membuat channel tiket');

    return { ok: false, reason: 'channel_failed', existingChannelId: null };
  }

  await service.attachChannel(ticket.id, channel.id);

  await channel
    .send({
      embeds: [ticketOpenedEmbed(ticket, input.staffRoleId)],
      components: [buildTicketControls()],
    })
    .catch((error: unknown) => {
      // Tiket tetap valid tanpa pesan pembuka; member sudah diarahkan ke channel.
      getLogger().warn({ err: error, channel: channel.id }, 'Gagal mengirim pesan pembuka tiket');
    });

  return { ok: true, ticket, channel };
}

/**
 * Tutup tiket lalu arsipkan channelnya.
 *
 * Satu jalur untuk tombol `Tutup Tiket` dan perintah `/ticket close`, supaya
 * keduanya tidak bisa berbeda: database sudah menandai tiket tertutup sementara
 * channelnya masih bisa diketik.
 */
export async function closeAndArchive(
  guild: Guild,
  channelId: string,
  closedBy: string,
): Promise<CloseResult | null> {
  const closed = await getTicketService().close(guild.id, channelId, closedBy);
  if (!closed) return null;

  const fetched = await guild.channels.fetch(channelId).catch(() => null);
  const channel = toTextChannel(fetched);
  if (channel) await archiveTicketChannel(channel, closed, closedBy);

  return { ticket: closed, channel };
}

/** Buat channel tiket privat: hanya pembuat tiket dan role staff yang melihat. */
export async function createTicketChannel(
  guild: Guild,
  ticket: Ticket,
  openerId: string,
  staffRoleId: string,
): Promise<TextChannel> {
  const created = await guild.channels.create({
    name: ticketChannelName(
      ticket.ticketNumber,
      guild.members.cache.get(openerId)?.displayName ?? '',
    ),
    type: ChannelType.GuildText,
    // @everyone dinolkan eksplisit: kalau kategorinya menyinkronkan izin, channel
    // baru bisa saja terlihat oleh siapa saja.
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: openerId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      {
        id: staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
    ],
  });

  return created as TextChannel;
}

/**
 * Arsipkan channel tiket: ganti nama lalu kunci.
 *
 * Izin `SendMessages` untuk pembuat tiket ikut dicabut secara eksplisit —
 * overwrite level member mengalahkan @everyone, jadi hanya men-den-y
 * `@everyone` tidak cukup untuk benar-benar mengunci channel ini.
 */
export async function archiveTicketChannel(
  channel: TextChannel,
  ticket: Ticket,
  closedBy: string,
): Promise<void> {
  await channel.setName(closedTicketChannelName(ticket.ticketNumber), 'Tiket ditutup');

  const everyone = channel.guild.roles.everyone;
  await channel.permissionOverwrites.edit(
    everyone,
    { SendMessages: false },
    { reason: 'Tiket ditutup' },
  );
  await channel.permissionOverwrites.edit(
    ticket.openerId,
    { SendMessages: false },
    { reason: 'Tiket ditutup' },
  );

  await channel
    .send({ embeds: [ticketClosedEmbed(ticket, closedBy)] })
    .catch((error: unknown) => {
      getLogger().warn({ err: error, channel: channel.id }, 'Gagal mengirim pengumuman tiket ditutup');
    });
}

function toTextChannel(channel: unknown): TextChannel | null {
  return isGuildTextChannel(channel) ? (channel as TextChannel) : null;
}