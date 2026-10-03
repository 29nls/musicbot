import {
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService } from '../config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../i18n/index.js';
import { canControlMusic } from './permissions.js';
import { getMusicService, getSearchSessionStore } from './singleton.js';
import {
  parseSearchCustomId,
  parseSearchOptionValue,
  searchOptionDescription,
  searchOptionLabel,
  searchOptionValue,
  searchSelectCustomId,
  type SearchSession,
} from './searchSession.js';
import { renderPlayOutcome } from './render.js';
import type { TrackInfo } from './types.js';

/**
 * Dua pesan di sini dipanggil sebelum guild diketahui ada atau tidak.
 *
 * Tanpa guild tidak ada bahasa yang bisa dicari, jadi keduanya memakai bahasa
 * bawaan. Setelah `inCachedGuild()` lolos, sisanya memakai bahasa server.
 */

/**
 * Bangun baris select menu berisi hasil pencarian.
 *
 * Nilai opsi cuma indeks (0, 1, 2, ...) supaya data lagu tidak ikut masuk ke
 * customId Discord; isi session dibaca dari store lewat token.
 */
export function searchSelectRow(
  session: SearchSession,
  t: Translator,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(searchSelectCustomId(session.token))
    .setPlaceholder(t('music.search.placeholder'))
    .addOptions(
      session.tracks.map((track, index) => ({
        label: searchOptionLabel(track),
        value: searchOptionValue(index),
        description: searchOptionDescription(track),
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Tangani select menu hasil `/search`.
 *
 * Validasi (customId, guild, pemilik) selesai sebelum apa pun yang menyentuh
 * Lavalink, jadi select menu lama yang diklik orang lain hanya menghasilkan
 * pesan sederhana.
 */
export async function handleSearchSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const token = parseSearchCustomId(interaction.customId);
  if (token === null || !interaction.inCachedGuild()) {
    await replyOnce(interaction, warningEmbed(defaultTranslator('music.search.unknown')));
    return;
  }

  // Disalin di sini: penyempitan `inCachedGuild` hilang setelah await.
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const guild = interaction.guild;
  const member = interaction.member;
  const t = await translatorFor(guildId);

  const index = parseSearchOptionValue(interaction.values[0]);
  if (index === null) {
    await replyOnce(interaction, errorEmbed(t('music.search.invalidPick')));
    return;
  }

  const selection = await getSearchSessionStore().take({ token, guildId, userId, index });

  switch (selection.kind) {
    case 'expired':
    case 'other-guild':
    case 'bad-index':
      await replyOnce(interaction, warningEmbed(t('music.search.expired')));
      return;
    case 'not-owner':
      await replyOnce(interaction, warningEmbed(t('music.search.notOwner')));
      return;
    default:
      await playSelection(interaction, guildId, guild, member, selection.track, t);
  }
}

/**
 * Mainkan lagu yang dipilih.
 *
 * `track` sudah berbentuk `TrackInfo` lengkap, jadi Lavalink tidak perlu
 * dihubungi lagi: hasil pencarian tadi masih berlaku di store.
 */
async function playSelection(
  interaction: StringSelectMenuInteraction,
  guildId: string,
  guild: Guild,
  member: GuildMember,
  track: TrackInfo,
  t: Translator,
): Promise<void> {
  const config = await getGuildConfigService().get(guildId);

  if (!config.modules.music) {
    await replyOnce(interaction, warningEmbed(t('music.gate.moduleDisabled')));
    return;
  }

  const voiceChannelId = member.voice.channelId;
  if (!voiceChannelId) {
    await replyOnce(interaction, warningEmbed(t('music.search.needVoice')));
    return;
  }

  const outcome = await getMusicService().enqueue({
    guildId,
    tracks: [track],
    voiceChannelId,
    shardId: guild.shardId,
    // Batas §6.2: lagu > 30 menit (atau live stream) hanya boleh diputar DJ.
    canControl: canControlMusic({
      djRoleId: config.djRoleId,
      memberRoleIds: [...member.roles.cache.keys()],
      canManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    }),
  });

  await replyOnce(interaction, renderPlayOutcome(outcome, t));
}

/**
 * Balas hasil pilihan.
 *
 * Select menu punya jendela balasan 3 detik, jadi jawabannya dibungkus try/catch:
 * kalau kedaluwarsa, tidak ada yang bisa dilakukan selain mencatatnya.
 */
async function replyOnce(
  interaction: StringSelectMenuInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    getLogger().warn({ err: error }, 'Gagal membalas pilihan /search');
  }
}