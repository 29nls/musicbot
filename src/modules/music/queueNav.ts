import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService } from '../config/index.js';
import { queueEmbed } from './embeds.js';
import {
  buildQueuePage,
  parseQueuePageCustomId,
  queuePageCustomId,
  type QueuePage,
} from './queuePage.js';
import { getMusicService } from './singleton.js';
import type { QueueSnapshot, TrackInfo } from './types.js';

/**
 * Navigasi halaman antrean (PRD §8 US-02: "10 lagu/halaman dengan tombol
 * navigasi").
 *
 * Antrean adalah milik server, bukan milik orang yang memanggil `/queue`, jadi
 * tombolnya **publik**: siapa pun yang melihat pesan boleh berpindah halaman.
 * Yang tetap dijaga hanya bentuk datanya — `customId` hanya berisi nomor
 * halaman, dan `interaction.update()` menulis ke pesan yang sama, jadi tidak
 * ada yang bisa memakai tombol orang lain untuk mengubah antrean.
 */

const TOO_OLD_MESSAGE =
  'Pesan antrean ini sudah terlalu lama untuk diubah. Jalankan `/queue` lagi.';

export interface QueueNavDeps {
  getSnapshot: (guildId: string) => Promise<QueueSnapshot>;
  /** true kalau modul musik masih dinyalakan di server itu. */
  isMusicEnabled: (guildId: string) => Promise<boolean>;
}

/** Dependency bawaan: service musik & konfigurasi sungguhan. */
function defaultDeps(): QueueNavDeps {
  return {
    getSnapshot: (guildId) => getMusicService().snapshot(guildId),
    isMusicEnabled: async (guildId) =>
      (await getGuildConfigService().get(guildId)).modules.music,
  };
}

/**
 * Baris tombol halaman; null kalau antrean cukup untuk satu halaman.
 *
 * Tombol batas **dimatikan**, bukan disembunyikan: tombol yang menghilang
 * membuat orang menekan berkali-kali mencari arah, dan yang dimatikan langsung
 * menjelaskan bahwa ini ujungnya.
 */
export function queueNavRow(page: QueuePage<TrackInfo>): ActionRowBuilder<ButtonBuilder> | null {
  if (page.totalPages <= 1) return null;

  const make = (label: string, target: number, disabled: boolean, emoji: string) =>
    new ButtonBuilder()
      .setCustomId(queuePageCustomId(target))
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    make('Awal', 1, page.page === 1, '⏮️'),
    make('Sebelumnya', page.page - 1, page.page === 1, '◀️'),
    make('Berikutnya', page.page + 1, page.page === page.totalPages, '▶️'),
    make('Akhir', page.totalPages, page.page === page.totalPages, '⏭️'),
  );
}

/**
 * Tangani klik tombol halaman antrean.
 *
 * Urutan pemeriksaan sengaja begini: bentuk customId dulu (biaya nol), lalu
 * guild & modul musik, baru membaca antrean. Antrean bisa saja berubah sejak
 * pesan dikirim — itu normal, bukan error, jadi halaman selalu dijepit ulang
 * terhadap data terbaru.
 */
export async function handleQueuePage(
  interaction: ButtonInteraction,
  deps: QueueNavDeps = defaultDeps(),
): Promise<void> {
  const page = parseQueuePageCustomId(interaction.customId);
  if (page === null || !interaction.inCachedGuild()) {
    await replyOnce(interaction, warningEmbed('Tombol ini tidak lagi dikenali. Jalankan `/queue` lagi.'));
    return;
  }

  // Disalin di sini: penyempitan `inCachedGuild` hilang setelah await.
  const guildId = interaction.guildId;

  if (!(await deps.isMusicEnabled(guildId))) {
    await replyOnce(interaction, warningEmbed('Modul musik dimatikan di server ini.'));
    return;
  }

  const snapshot = await deps.getSnapshot(guildId);

  if (!snapshot.current && snapshot.upcoming.length === 0) {
    await updateQuietly(interaction, {
      embeds: [infoEmbed('🎶 Antrean kosong', 'Semua lagu sudah selesai. Tambahkan dengan `/play`.')],
      components: [],
    });
    return;
  }

  const current = buildQueuePage(snapshot.upcoming, page);
  const row = queueNavRow(current);

  await updateQuietly(interaction, {
    embeds: [queueEmbed(snapshot, current)],
    components: row ? [row] : [],
  });
}

/**
 * Tulis ulang pesan antrean.
 *
 * `interaction.update()` punya jendela 15 menit — kalau pesannya lebih tua,
 * Discord menolaknya. Itu bukan kegagalan fatal: pesannya sudah ada dan isinya
 * masih terbaca, jadi jawabannya dijelaskan lewat pesan privat, bukan
 * InteractionUpdate sudah lewat.
 */
async function updateQuietly(
  interaction: ButtonInteraction,
  payload: { embeds: ReturnType<typeof queueEmbed>[]; components: ActionRowBuilder<ButtonBuilder>[] },
): Promise<void> {
  try {
    await interaction.update(payload);
  } catch (error) {
    getLogger().debug({ err: error, guild: interaction.guildId }, 'Tombol antrean terlalu lama untuk diperbarui');
    await replyOnce(interaction, warningEmbed(TOO_OLD_MESSAGE));
  }
}

async function replyOnce(interaction: ButtonInteraction, embed: ReturnType<typeof errorEmbed>): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    getLogger().warn({ err: error }, 'Gagal menjawab klik tombol antrean');
  }
}