import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  canControlMusic,
  renderPlayOutcome,
  toTrackInfo,
  type MusicService,
  type TrackInfo,
} from '../../modules/music/index.js';
import {
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_PLAYLIST_TRACKS,
  getPlaylistService,
  playlistDetailEmbed,
  playlistListEmbed,
  type PlaylistFailure,
} from '../../modules/playlists/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import type { Translator } from '../../modules/i18n/index.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

const NAME_MAX = MAX_PLAYLIST_NAME_LENGTH;

export default {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Simpan dan putar playlist lagu milikmu')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Buat playlist kosong')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambahkan lagu ke playlist')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        )
        .addStringOption((option) =>
          option
            .setName('query')
            .setDescription('Kata kunci atau URL; kosongkan untuk menyimpan lagu yang sedang diputar')
            .setMaxLength(200),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus satu lagu dari playlist')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        )
        .addIntegerOption((option) =>
          option.setName('position').setDescription('Posisi lagu (1 = pertama)').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Daftar playlist milikmu'))
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Lihat isi satu playlist')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Putar isi playlist ke voice channel')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus playlist')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('public')
        .setDescription('Bagikan playlist ke server ini, atau privatkan lagi')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama playlist')
            .setRequired(true)
            .setMaxLength(NAME_MAX),
        )
        .addBooleanOption((option) =>
          option.setName('shared').setDescription('true = bisa diputar member lain'),
        ),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const t = await translatorFor(interaction.guildId ?? 'unknown');

      if (!interaction.inCachedGuild()) {
        await interaction.editReply({
          embeds: [errorEmbed(t('playlist.guildOnly'))],
        });
        return;
      }

      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const playlists = getPlaylistService();
      const name = (): string => interaction.options.getString('name', true);

      switch (interaction.options.getSubcommand()) {
        case 'create': {
          const result = await playlists.create({ guildId, ownerId: userId, name: name() });
          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'create', t)] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                t('playlist.created', { name: result.value.name }),
                `🎼 ${t('playlist.createdTitle')}`,
              ),
            ],
          });
          return;
        }

        case 'add': {
          const gate = await requireVoice(interaction);
          if (!gate) return;

          const tracks = await resolveForAdd(
            interaction,
            gate.music,
            guildId,
            interaction.options.getString('query'),
            gate.t,
          );
          if (!tracks) return;

          const result = await playlists.addTracks(guildId, userId, name(), tracks);
          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'add', t)] });
            return;
          }

          const lines = [
            `**${result.value.added}** lagu ditambahkan ke **${result.value.playlist.name}** ` +
              `(total ${result.value.playlist.tracks.length}/${MAX_PLAYLIST_TRACKS}).`,
          ];
          if (result.value.skippedDuplicates > 0) {
            lines.push(`${result.value.skippedDuplicates} lagu tidak digandakan karena sudah ada.`);
          }

          await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), '🎼 Playlist')] });
          return;
        }

        case 'remove': {
          const result = await playlists.removeTrack(
            guildId,
            userId,
            name(),
            interaction.options.getInteger('position', true),
          );

          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'remove', t)] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                t('playlist.removedTrack', {
                  name: result.value.name,
                  count: result.value.tracks.length,
                }),
                `🎼 ${t('playlist.title')}`,
              ),
            ],
          });
          return;
        }

        case 'list': {
          const list = await playlists.list(guildId, userId, { includePublic: true });
          await interaction.editReply({ embeds: [playlistListEmbed({ playlists: list, userId })] });
          return;
        }

        case 'show': {
          const found = await playlists.findPlayable(guildId, userId, name());
          if (!found.ok) {
            await interaction.editReply({ embeds: [describeFailure(found.error, 'show', t)] });
            return;
          }

          await interaction.editReply({ embeds: [playlistDetailEmbed(found.value)] });
          return;
        }

        case 'play': {
          const found = await playlists.findPlayable(guildId, userId, name());
          if (!found.ok) {
            await interaction.editReply({ embeds: [describeFailure(found.error, 'play', t)] });
            return;
          }

          const gate = await requireVoice(interaction);
          if (!gate) return;

          // Resolve dulu, baru masukkan antrean: playlist bisa berisi lagu yang
          // sumbernya hilang, dan jumlah yang gagal wajib dilaporkan — bukan
          // diam-diam memutar playlist yang lebih pendek.
          const resolved = await playlists.loadForPlay(
            found.value,
            (uri) => gate.music.resolve(uri),
            userId,
          );

          if (resolved.tracks.length === 0) {
            await interaction.editReply({
              embeds: [
                errorEmbed(t('playlist.nonePlayable', { count: found.value.tracks.length })),
              ],
            });
            return;
          }

          const outcome = await gate.music.enqueue({
            guildId,
            tracks: resolved.tracks,
            voiceChannelId: gate.voiceChannelId,
            shardId: interaction.guild.shardId,
            canControl: gate.canControl,
          });

          const embed = renderPlayOutcome(outcome, t);
          if (resolved.failed > 0) {
            embed.setFooter({
              text: t('playlist.partialLoad', {
                failed: resolved.failed,
                count: found.value.tracks.length,
              }),
            });
          }
          if (found.value.ownerId !== userId) {
            embed.addFields({
              name: t('playlist.fieldOwner'),
              value: `${found.value.name} — <@${found.value.ownerId}>`,
            });
          }

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'delete': {
          const result = await playlists.remove(guildId, userId, name());
          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'delete', t)] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                t('playlist.deleted', { name: result.value.name }),
                `🎼 ${t('playlist.title')}`,
              ),
            ],
          });
          return;
        }

        case 'public': {
          const current = await playlists.findPlayable(guildId, userId, name());
          if (!current.ok) {
            await interaction.editReply({ embeds: [describeFailure(current.error, 'public', t)] });
            return;
          }

          const shared = interaction.options.getBoolean('shared') ?? !current.value.isPublic;
          const result = await playlists.setVisibility(guildId, userId, name(), shared);

          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'public', t)] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                `**${result.value.name}** sekarang ` +
                  `${result.value.isPublic ? 'bisa diputar member lain' : 'privati kembali'}.`,
                '🎼 Playlist',
              ),
            ],
          });
          return;
        }

        default:
          await interaction.editReply({
            embeds: [errorEmbed(t('playlist.unknownSub'))],
          });
      }
    } catch (error) {
      await handleMusicFailure(interaction, error, 'playlist');
    }
  },
} satisfies BotCommand;

/**
 * Gerbang ringan: bot hanya perlu bisa masuk voice channel.
 *
 * Sengaja tanpa `control: true` — memutar playlist bukan hak DJ. Menambah lagu
 * juga tidak butuh DJ: itu memengaruhi antrean sendiri, bukan antrean orang lain.
 *
 * Null berarti gerbang gagal; pesannya sudah dibalas di sini.
 */
async function requireVoice(
  interaction: ChatInputCommandInteraction,
): Promise<{
  music: MusicService;
  voiceChannelId: string;
  canControl: boolean;
  t: Translator;
} | null> {
  const gate = await gateMusicCommand(interaction, { voice: true });
  if (!gate.ok) {
    await replyEphemeralError(interaction, gate.embed);
    return null;
  }

  return {
    music: gate.ctx.music,
    voiceChannelId: gate.ctx.voiceChannelId,
    // Batas §6.2: playlist berlarut hanya boleh diputar DJ/Manage Server.
    canControl: canControlMusic({
      djRoleId: gate.ctx.config.djRoleId,
      memberRoleIds: gate.ctx.memberRoleIds,
      canManageGuild: gate.ctx.canManageGuild,
    }),
    t: gate.ctx.t,
  };
}

/**
 * Lagu yang akan ditambahkan: dari query, atau dari lagu yang sedang diputar.
 *
 * Tanpa query, "simpan lagu ini" adalah yang paling sering dilakukan orang — dan
 * itu harus menolak dengan jelas kalau memang tidak ada yang berbunyi, bukan
 * menyimpan lagu kosong tanpa suara.
 */
async function resolveForAdd(
  interaction: ChatInputCommandInteraction,
  music: MusicService,
  guildId: string,
  query: string | null,
  t: Translator,
): Promise<TrackInfo[] | null> {
  const trimmed = query?.trim() ?? '';

  if (trimmed.length === 0) {
    const snapshot = await music.snapshot(guildId);
    if (!snapshot.current) {
      await interaction.editReply({
        embeds: [errorEmbed(t('playlist.needQuery'))],
      });
      return null;
    }

    return [snapshot.current];
  }

  const found = await music.resolve(trimmed);

  if (found.kind === 'empty') {
    await interaction.editReply({
      embeds: [errorEmbed(t('playlist.notFoundQuery', { query: trimmed }))],
    });
    return null;
  }

  if (found.kind === 'error') {
    await interaction.editReply({
      embeds: [errorEmbed(t('playlist.loadFailed', { message: found.message }))],
    });
    return null;
  }

  if (found.kind === 'unavailable') {
    await interaction.editReply({
      embeds: [warningEmbed(t('playlist.lavalinkDown'))],
    });
    return null;
  }

  return found.tracks.map((track) => toTrackInfo(track, interaction.user.id));
}

/** Pesan kegagalan yang menjelaskan penyebabnya, bukan kode internal. */
function describeFailure(error: PlaylistFailure, action: string, t: Translator) {
  switch (error.kind) {
    case 'name-invalid':
      return errorEmbed(error.message);
    case 'name-taken':
      return errorEmbed(t('playlist.errNameTaken', { name: error.name }));
    case 'not-found':
      return errorEmbed(
        action === 'play' || action === 'show'
          ? t('playlist.errNoPublic')
          : t('playlist.errNotFound'),
      );
    case 'empty':
      return errorEmbed(t('playlist.errEmpty'));
    case 'full':
      return errorEmbed(t('playlist.errFull', { limit: error.limit }));
    case 'out-of-range':
      return errorEmbed(
        error.count === 0
          ? t('playlist.errStillEmpty')
          : t('playlist.errOutOfRange', { count: error.count }),
      );
    case 'not-owner':
      return errorEmbed(t('playlist.errNotOwner'));
    case 'private':
      return errorEmbed(t('playlist.errPrivate'));
    default:
      return errorEmbed(t('playlist.errUnknown'));
  }
}