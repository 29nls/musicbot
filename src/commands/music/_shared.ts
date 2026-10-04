import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { getGuildConfigService, type GuildConfig } from '../../modules/config/index.js';
import {
  canControlMusic,
  getMusicService,
  isInSameVoiceChannel,
  PlayerOwnedElsewhereError,
  type MusicService,
} from '../../modules/music/index.js';
import { getLogger } from '../../services/logger.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import { errorEmbed } from '../../utils/embeds.js';
import { canManageGuild as hasManageGuild } from '../../utils/permissions.js';

// Dipindah ke modul musik supaya handler komponen `/search` bisa memakainya juga.
export { renderPlayOutcome } from '../../modules/music/render.js';

export interface MusicContext {
  guild: Guild;
  guildId: string;
  config: GuildConfig;
  music: MusicService;
  /** Channel voice tempat user yang memanggil perintah berada. */
  voiceChannelId: string;
  canManageGuild: boolean;
  /** Role yang dimiliki pemanggil — dipakai aturan batas durasi §6.2. */
  memberRoleIds: string[];
  /**
   * Penerjemah bahasa server, sudah terikat ke locale guild itu.
   *
   * Disimpan di konteks, bukan diambil sendiri oleh tiap perintah: gate
   * sudah membaca config untuk aturan lain, jadi satu pembacaan tambahan
   * tidak terjadi dan setiap perintah dapat penerjemah tanpa `await` lagi.
   */
  t: Translator;
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
    return fail(errorEmbed(defaultTranslator('music.gate.guildOnly'), defaultTranslator('embed.title.error')));
  }

  const guild = interaction.guild;
  const member = interaction.member;
  // Nama variabel lokalnya dulu sama persis dengan helper aslinya
  // (`canManageGuild`), jadi ada dua definisi untuk satu aturan dengan nama
  // yang sama. Sekarang aturan itu hanya ada di `utils/permissions.ts`.
  const canManageGuild = hasManageGuild(interaction);

  let music: MusicService;
  try {
    music = getMusicService();
  } catch (error) {
    getLogger().error({ err: error }, 'MusicService belum diinisialisasi');
    return fail(errorEmbed(defaultTranslator('music.gate.engineDown'), defaultTranslator('embed.title.error')));
  }

  const config = await getGuildConfigService().get(guild.id);
  // Semua pesan gate lewat katalog bahasa, jadi pesan yang paling sering
  // dilihat user (dan yang paling sering disalin) ikut berbahasa yang
  // mereka pilih.
  const t = await translatorFor(guild.id);

  if (!config.modules.music) {
    return fail(errorEmbed(`${t('music.gate.moduleDisabled')} ${t('music.gate.enableHint')}`, t('embed.title.error')));
  }

  if (options.voice && !music.isConnected) {
    return fail(errorEmbed(t('music.gate.notConnected'), t('embed.title.error')));
  }

  const memberChannelId = member.voice.channelId ?? null;
  const botChannelId = music.botVoiceChannelId(guild.id);

  if (options.voice && !memberChannelId) {
    return fail(errorEmbed(t('music.gate.needVoice'), t('embed.title.error')));
  }

  if (options.voice && botChannelId && botChannelId !== memberChannelId && !canManageGuild) {
    return fail(
      errorEmbed(t('music.gate.botElsewhere', { channel: botChannelId }), t('embed.title.error')),
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
            ? t('music.gate.needDjRole', { role: config.djRoleId })
            : t('music.gate.needManageGuild'),
        ),
      );
    }

    if (!isInSameVoiceChannel(memberChannelId, botChannelId, canManageGuild)) {
      return fail(errorEmbed(t('music.gate.needSameVoice'), t('embed.title.error')));
    }
  }

  if (options.playing && !music.isPlaying(guild.id)) {
    return fail(errorEmbed(t('music.gate.nothingPlaying'), t('embed.title.error')));
  }

  if (options.voice && memberChannelId) {
    const permissionError = await checkVoicePermissions(guild, memberChannelId, t);
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
      memberRoleIds: [...member.roles.cache.keys()],
      t,
    },
  };
}

/**
 * Pastikan bot benar-benar boleh masuk dan berbicara di channel itu.
 *
 * Diekspor supaya `/247 join` bisa memakai pemeriksaan yang sama persis,
 * bukan salinan yang bisa berbeda seiring waktu.
 */
export async function checkVoicePermissions(
  guild: Guild,
  channelId: string,
  t: Translator = defaultTranslator,
): Promise<EmbedBuilder | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isVoiceBased()) {
    return errorEmbed(t('music.gate.channelNotVoice'), t('embed.title.error'));
  }

  const me: GuildMember | null = guild.members.me;
  if (!me) {
    return errorEmbed(t('music.gate.notCached'), t('embed.title.error'));
  }

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    return errorEmbed(t('music.gate.missingPermissions', { channel: channelId }), t('embed.title.error'));
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

  const t = await translatorFor(interaction.guildId ?? 'unknown');

  // Guild yang sedang dipegang proses lain bukan kegagalan acak: member perlu
  // tahu masalahnya ada di sisi bot, bukan ditolak tanpa alasan yang jelas.
  if (error instanceof PlayerOwnedElsewhereError) {
    await replyEphemeralError(interaction, errorEmbed(t('music.gate.ownedElsewhere'), t('embed.title.error')));
    return;
  }

  await replyEphemeralError(interaction, errorEmbed(t('music.gate.internalError'), t('embed.title.error')));
}
