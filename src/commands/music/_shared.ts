import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { getEnv } from '../../config/env.js';
import { getGuildConfigService, type GuildConfig } from '../../modules/config/index.js';
import {
  addedToQueueEmbed,
  canControlMusic,
  getMusicService,
  isInSameVoiceChannel,
  type MusicService,
  type PlayOutcome,
} from '../../modules/music/index.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed, warningEmbed } from '../../utils/embeds.js';

export interface MusicContext {
  guild: Guild;
  guildId: string;
  config: GuildConfig;
  music: MusicService;
  /** Channel voice tempat user yang memanggil perintah berada. */
  voiceChannelId: string;
  canManageGuild: boolean;
}

export interface GateOptions {
  /** Perintah butuh user berada di voice channel (dan bot punya izin masuk). */
  voice?: boolean;
  /** Perintah mengubah pemutaran — butuh DJ / Manage Server. */
  control?: boolean;
  /** Perintah hanya berguna kalau ada lagu yang sedang berputar. */
  playing?: boolean;
}

export type Gate = { ok: true; ctx: MusicContext } | { ok: false; embed: EmbedBuilder };

const fail = (embed: EmbedBuilder): Gate => ({ ok: false, embed });

/**
 * Pemeriksaan bersama semua perintah musik: modul aktif, Lavalink siap, posisi
 * voice channel, izin DJ, dan izin bot di channel tujuan.
 */
export async function gateMusicCommand(
  interaction: ChatInputCommandInteraction,
  options: GateOptions = {},
): Promise<Gate> {
  // inCachedGuild menjamin guild & member ada di cache, sehingga tipe aman dipakai.
  if (!interaction.inCachedGuild()) {
    return fail(errorEmbed('Perintah musik hanya bisa dipakai di dalam server.'));
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

  let music: MusicService;
  try {
    music = getMusicService();
  } catch (error) {
    getLogger().error({ err: error }, 'MusicService belum diinisialisasi');
    return fail(errorEmbed('Mesin musik belum aktif. Coba lagi sebentar lagi.'));
  }

  const config = await getGuildConfigService().get(guild.id);

  if (!config.modules.music) {
    return fail(
      errorEmbed('Modul musik dimatikan di server ini. Nyalakan lewat `/setup` atau `/config`.'),
    );
  }

  if (options.voice && !music.isConnected) {
    return fail(
      errorEmbed(
        'Lavalink belum terhubung, jadi lagu tidak bisa diputar. Cek `docker compose logs lavalink`.',
      ),
    );
  }

  const memberChannelId = member.voice.channelId ?? null;
  const botChannelId = music.botVoiceChannelId(guild.id);

  if (options.voice && !memberChannelId) {
    return fail(errorEmbed('Masuk ke voice channel dulu supaya saya bisa ikut memutar lagu.'));
  }

  if (options.voice && botChannelId && botChannelId !== memberChannelId && !canManageGuild) {
    return fail(
      errorEmbed(
        `Saya sedang memutar lagu di <#${botChannelId}>. Masuk ke channel itu untuk ikut mengatur.`,
      ),
    );
  }

  if (options.control) {
    const allowed = canControlMusic({
      djRoleId: config.djRoleId,
      memberRoleIds: [...member.roles.cache.keys()],
      canManageGuild,
    });

    if (!allowed) {
      return fail(
        errorEmbed(
          config.djRoleId
            ? `Perintah ini hanya untuk role <@&${config.djRoleId}> (atau Manage Server).`
            : 'Perintah ini butuh izin Manage Server.',
        ),
      );
    }

    if (!isInSameVoiceChannel(memberChannelId, botChannelId, canManageGuild)) {
      return fail(errorEmbed('Kamu harus berada di voice channel yang sama dengan saya.'));
    }
  }

  if (options.playing && !music.isPlaying(guild.id)) {
    return fail(errorEmbed('Tidak ada lagu yang sedang diputar.'));
  }

  if (options.voice && memberChannelId) {
    const permissionError = await checkVoicePermissions(guild, memberChannelId);
    if (permissionError) return fail(permissionError);
  }

  return {
    ok: true,
    ctx: {
      guild,
      guildId: guild.id,
      config,
      music,
      voiceChannelId: memberChannelId ?? '',
      canManageGuild,
    },
  };
}

/** Pastikan bot benar-benar boleh masuk dan berbicara di channel itu. */
async function checkVoicePermissions(guild: Guild, channelId: string): Promise<EmbedBuilder | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isVoiceBased()) {
    return errorEmbed('Channel itu bukan voice channel yang bisa saya masuki.');
  }

  const me: GuildMember | null = guild.members.me;
  if (!me) {
    return errorEmbed('Saya belum termuat di server ini. Coba lagi sebentar lagi.');
  }

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    return errorEmbed(`Saya tidak punya izin **Connect** dan **Speak** di <#${channelId}>.`);
  }

  return null;
}

/**
 * Ganti balasan "sedang diproses" dengan pesan privat.
 * Dipakai supaya kesalahan tidak mengotori channel, tanpa mengorbankan hasil
 * yang memang ingin dilihat semua orang (mis. "lagu ditambahkan").
 */
export async function replyEphemeralError(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  await interaction.deleteReply().catch(() => undefined);
  await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** Catat error tak terduga lalu tampilkan pesan privat yang ramah. */
export async function handleMusicFailure(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  command: string,
): Promise<void> {
  getLogger().error(
    { err: error, command, user: interaction.user.id, guild: interaction.guildId },
    'Perintah musik gagal',
  );

  await replyEphemeralError(
    interaction,
    errorEmbed('Terjadi kesalahan saat memproses perintah musik. Detailnya sudah dicatat di log bot.'),
  );
}

/** Hasil `/play` → embed yang siap dikirim. */
export function renderPlayOutcome(outcome: PlayOutcome): EmbedBuilder {
  switch (outcome.kind) {
    case 'added':
      return addedToQueueEmbed(outcome);
    case 'empty':
      return errorEmbed('Tidak ada hasil untuk pencarian itu. Coba kata kunci lain atau kirim URL.');
    case 'error':
      return errorEmbed(`Lagu ini tidak bisa dimuat: ${outcome.message}`);
    case 'queue-full':
      return warningEmbed(
        `Antrean sudah penuh (batas ${getEnv().MAX_QUEUE_SIZE} lagu). Tunggu sampai ada lagu yang selesai.`,
      );
    case 'unavailable':
    default:
      return errorEmbed(
        'Lavalink belum terhubung, jadi lagu tidak bisa diputar. Cek `docker compose logs lavalink`.',
      );
  }
}
