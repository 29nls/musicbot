import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
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
      if (!interaction.inCachedGuild()) {
        await interaction.editReply({
          embeds: [errorEmbed('Perintah ini hanya bisa dipakai di dalam server.')],
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
            await interaction.editReply({ embeds: [describeFailure(result.error, 'create')] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                `Playlist **${result.value.name}** dibuat. Tambahkan lagu dengan ` +
                  `\`/playlist add ${result.value.name} <judul atau URL>\`.`,
                '🎼 Playlist Dibuat',
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
          );
          if (!tracks) return;

          const result = await playlists.addTracks(guildId, userId, name(), tracks);
          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'add')] });
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
            await interaction.editReply({ embeds: [describeFailure(result.error, 'remove')] });
            return;
          }

          await interaction.editReply({
            embeds: [
              successEmbed(
                `Lagu dihapus. **${result.value.name}** kini berisi ${result.value.tracks.length} lagu.`,
                '🎼 Playlist',
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
            await interaction.editReply({ embeds: [describeFailure(found.error, 'show')] });
            return;
          }

          await interaction.editReply({ embeds: [playlistDetailEmbed(found.value)] });
          return;
        }

        case 'play': {
          const found = await playlists.findPlayable(guildId, userId, name());
          if (!found.ok) {
            await interaction.editReply({ embeds: [describeFailure(found.error, 'play')] });
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
                errorEmbed(
                  `Tidak ada satu pun dari ${found.value.tracks.length} lagu yang masih bisa ` +
                    'diputar. Sumbernya mungkin sudah tidak tersedia.',
                ),
              ],
            });
            return;
          }

          const outcome = await gate.music.enqueue({
            guildId,
            tracks: resolved.tracks,
            voiceChannelId: gate.voiceChannelId,
            shardId: interaction.guild.shardId,
          });

          const embed = renderPlayOutcome(outcome);
          if (resolved.failed > 0) {
            embed.setFooter({
              text: `${resolved.failed} dari ${found.value.tracks.length} lagu gagal dimuat dan dilewati.`,
            });
          }
          if (found.value.ownerId !== userId) {
            embed.addFields({
              name: 'Playlist',
              value: `${found.value.name} — <@${found.value.ownerId}>`,
            });
          }

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'delete': {
          const result = await playlists.remove(guildId, userId, name());
          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'delete')] });
            return;
          }

          await interaction.editReply({
            embeds: [successEmbed(`Playlist **${result.value.name}** dihapus.`, '🎼 Playlist')],
          });
          return;
        }

        case 'public': {
          const current = await playlists.findPlayable(guildId, userId, name());
          if (!current.ok) {
            await interaction.editReply({ embeds: [describeFailure(current.error, 'public')] });
            return;
          }

          const shared = interaction.options.getBoolean('shared') ?? !current.value.isPublic;
          const result = await playlists.setVisibility(guildId, userId, name(), shared);

          if (!result.ok) {
            await interaction.editReply({ embeds: [describeFailure(result.error, 'public')] });
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
            embeds: [errorEmbed('Subcommand itu tidak dikenal.')],
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
): Promise<{ music: MusicService; voiceChannelId: string } | null> {
  const gate = await gateMusicCommand(interaction, { voice: true });
  if (!gate.ok) {
    await replyEphemeralError(interaction, gate.embed);
    return null;
  }

  return { music: gate.ctx.music, voiceChannelId: gate.ctx.voiceChannelId };
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
): Promise<TrackInfo[] | null> {
  const trimmed = query?.trim() ?? '';

  if (trimmed.length === 0) {
    const snapshot = await music.snapshot(guildId);
    if (!snapshot.current) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            'Tidak ada lagu yang sedang diputar. Sebutkan judul/URL, atau putar lagu dulu baru simpan.',
          ),
        ],
      });
      return null;
    }

    return [snapshot.current];
  }

  const found = await music.resolve(trimmed);

  if (found.kind === 'empty') {
    await interaction.editReply({
      embeds: [errorEmbed(`Tidak menemukan apa pun untuk \`${trimmed}\`.`)],
    });
    return null;
  }

  if (found.kind === 'error') {
    await interaction.editReply({
      embeds: [errorEmbed(`Lagu itu tidak bisa dimuat: ${found.message}`)],
    });
    return null;
  }

  if (found.kind === 'unavailable') {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Lavalink belum terhubung, jadi lagu tidak bisa dicari. Cek `docker compose logs lavalink`.',
        ),
      ],
    });
    return null;
  }

  return found.tracks.map((track) => toTrackInfo(track, interaction.user.id));
}

/** Pesan kegagalan yang menjelaskan penyebabnya, bukan kode internal. */
function describeFailure(error: PlaylistFailure, action: string) {
  switch (error.kind) {
    case 'name-invalid':
      return errorEmbed(error.message);
    case 'name-taken':
      return errorEmbed(
        `Kamu sudah punya playlist bernama **${error.name}**. Ganti nama, atau hapus yang lama dulu.`,
      );
    case 'not-found':
      return errorEmbed(
        action === 'play' || action === 'show'
          ? 'Tidak ada playlist publik dengan nama itu. Buat atau bagikan dulu lewat `/playlist`.'
          : 'Playlist itu tidak ada. Cek `/playlist list`.',
      );
    case 'empty':
      return errorEmbed('Playlist masih kosong.');
    case 'full':
      return errorEmbed(
        `Playlist sudah berisi batas **${error.limit}** lagu. Hapus satu dulu sebelum menambah.`,
      );
    case 'out-of-range':
      return errorEmbed(
        error.count === 0
          ? 'Playlist ini masih kosong, jadi tidak ada yang bisa dihapus.'
          : `Posisi itu di luar jangkauan. Playlist ini berisi **${error.count}** lagu.`,
      );
    case 'not-owner':
      return errorEmbed('Playlist itu bukan milikmu, jadi tidak bisa diubah.');
    case 'private':
      return errorEmbed('Playlist itu privat.');
    default:
      return errorEmbed('Permintaan itu tidak bisa diproses.');
  }
}