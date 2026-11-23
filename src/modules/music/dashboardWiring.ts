import { PermissionFlagsBits, type Client, type GuildMember } from 'discord.js';
import { getKeyValueStore } from '../../services/kvStore.js';
import { processInstanceId } from '../../services/instanceId.js';
import { getGuildConfigService } from '../config/index.js';
import { getLogger } from '../logger/index.js';
import { getPlaylistService } from '../playlists/index.js';
import {
  getSpotifyService,
  parseSpotifyLink,
  pickSpotifyMatch,
  searchQueryFor,
  type SpotifyTrackMeta,
} from '../spotify/index.js';
import {
  handleDashboardMusicCommand,
  type DashboardMembership,
  type DashboardMusicDeps,
  type DashboardSearchResult,
} from './dashboardService.js';
import { pickTracks } from './selection.js';
import { toTrackInfo } from './track.js';
import { toDashboardTrack } from './dashboard.js';
import type { MusicService } from './musicService.js';
import type { SearchOutcome, TrackInfo } from './types.js';

/**
 * Rakit jembatan dashboard ke dunia nyata.
 *
 * Semua keputusan ada di `dashboardService.ts`; berkas ini hanya menjawab
 * "dari mana" untuk gateway, database, Spotify, dan store bersama. Tidak ada
 * aturan otorisasi tambahan di sini yang bisa berbeda dari jalur slash command.
 */

export function createDashboardMusicDeps(
  client: Client,
  music: MusicService,
): DashboardMusicDeps {
  return {
    ownsGuild: (guildId) => client.guilds.cache.has(guildId),
    music: () => music,
    getConfig: (guildId) => getGuildConfigService().get(guildId),
    search: (guildId, userId, query, source) =>
      searchBySource(music, guildId, userId, query, source),
    canControl: (guildId, userId) => readMembership(client, guildId, userId),
    loadPlaylist: async (_guildId, userId, playlistId) => {
      const playlists = getPlaylistService();
      const found = await playlists.findPersonalById(userId, playlistId);
      if (!found.ok) return { kind: 'not-found' };

      const resolved = await playlists.loadForPlay(
        found.value,
        (uri) => music.resolve(uri),
        userId,
      );

      return {
        kind: 'ok',
        playlistName: found.value.name,
        tracks: resolved.tracks,
        failed: resolved.failed,
        total: found.value.tracks.length,
      };
    },
    shardIdForGuild: (guildId) => client.guilds.cache.get(guildId)?.shardId ?? 0,
    store: () => getKeyValueStore(),
    owner: () => processInstanceId(),
  };
}

/**
 * Langganan kanal perintah dashboard.
 *
 * `null` berarti store tidak bisa berlangganan (mis. store memori). Bot tetap
 * benar; dashboard hanya tidak bisa mengirim perintah, dan itu dicatat di log
 * pemanggil.
 */
export async function startDashboardMusicBridge(
  client: Client,
  music: MusicService,
): Promise<(() => Promise<void>) | null> {
  const store = getKeyValueStore();
  const deps = createDashboardMusicDeps(client, music);

  if (typeof store.subscribe !== 'function') return null;

  return store.subscribe('harmony:dashboard:music', (raw) => {
    void handleDashboardMusicCommand(deps, raw).catch((error: unknown) => {
      getLogger().error({ err: error }, 'Perintah musik dashboard gagal diproses');
    });
  });
}

async function searchBySource(
  music: MusicService,
  _guildId: string,
  userId: string,
  query: string,
  source: 'youtube' | 'spotify' | 'soundcloud',
): Promise<DashboardSearchResult> {
  if (source === 'spotify') return searchSpotify(music, userId, query);

  const isSoundCloud = source === 'soundcloud';
  let found = await music.resolve(query, isSoundCloud ? 'soundcloud' : 'youtube');

  // SoundCloud (plugin soundy) kadang gagal karena timeout API-nya; coba sekali
  // lagi sebelum melaporkan kegagalan ke dashboard.
  if (isSoundCloud && (found.kind === 'error' || found.kind === 'unavailable')) {
    found = await music.resolve(query, 'soundcloud');
  }

  if (isSoundCloud && found.kind === 'error') {
    const message = /something went wrong/i.test(found.message)
      ? 'Pencarian SoundCloud gagal. Coba lagi.'
      : found.message;
    return { kind: 'error', message };
  }

  return fromSearchOutcome(found, userId, query);
}

function fromSearchOutcome(
  found: SearchOutcome,
  userId: string,
  query: string,
): DashboardSearchResult {
  if (found.kind === 'empty') return { kind: 'empty' };
  if (found.kind === 'error') return { kind: 'error', message: found.message };
  if (found.kind === 'unavailable') return { kind: 'unavailable' };

  const tracks = pickTracks(found, 'choices', query).map((track) =>
    toDashboardTrack(toTrackInfo(track, userId)),
  );

  return tracks.length > 0 ? { kind: 'ok', tracks } : { kind: 'empty' };
}

/**
 * Pencarian Spotify: metadata resmi dulu, audio dicari ulang di Lavalink.
 *
 * Audio yang diputar **bukan** audio Spotify. Karena itu hasilnya membawa
 * `metadataSource: 'spotify'` dan `audioSource` terpisah, supaya UI tidak
 * mengklaim sesuatu yang tidak benar.
 */
async function searchSpotify(
  music: MusicService,
  userId: string,
  query: string,
): Promise<DashboardSearchResult> {
  const spotify = getSpotifyService();
  if (!spotify.isConfigured) return { kind: 'not-configured' };

  const link = parseSpotifyLink(query);
  const metas: SpotifyTrackMeta[] = [];

  if (link.kind === 'track') {
    const found = await spotify.getTrack(link.id);
    if (found.kind === 'not-found') return { kind: 'empty' };
    if (found.kind === 'error') return { kind: 'error', message: found.message };
    if (found.kind === 'not-configured') return { kind: 'not-configured' };
    metas.push(found.track);
  } else if (link.kind === 'playlist' || link.kind === 'album') {
    return {
      kind: 'error',
      message: 'Dashboard hanya bisa mencari satu lagu Spotify, bukan playlist atau album.',
    };
  } else {
    const found = await spotify.searchTracks(query, 5);
    if (found.kind === 'empty') return { kind: 'empty' };
    if (found.kind === 'error') return { kind: 'error', message: found.message };
    if (found.kind === 'not-configured') return { kind: 'not-configured' };
    metas.push(...found.tracks);
  }

  const tracks: TrackInfo[] = [];
  for (const meta of metas) {
    const audio = await music.resolve(searchQueryFor(meta));
    if (audio.kind !== 'tracks') continue;

    const candidates = pickTracks(audio, 'candidates', searchQueryFor(meta)).map((track) =>
      toTrackInfo(track, userId),
    );
    const match = pickSpotifyMatch({ meta, candidates });
    if (match) tracks.push(withSpotifyMetadata(match.track, meta));
  }

  return tracks.length > 0
    ? { kind: 'ok', tracks: tracks.map((track) => toDashboardTrack(track, 'spotify')) }
    : { kind: 'empty' };
}

/**
 * Metadata tampilan dari Spotify, audio tetap dari hasil Lavalink.
 *
 * Durasi sengaja memakai durasi audio, bukan metadata: progress bar dan tombol
 * seek mengikuti file yang benar-benar diputar. Judul, artis, dan artwork
 * memakai metadata resmi supaya hasil cover atau remix tidak tampil seolah-olah
 * itulah lagu Spotify yang diminta.
 */
export function withSpotifyMetadata(track: TrackInfo, meta: SpotifyTrackMeta): TrackInfo {
  return {
    ...track,
    title: meta.title,
    author: meta.artists.join(', '),
    artworkUrl: meta.imageUrl ?? track.artworkUrl,
  };
}

async function readMembership(
  client: Client,
  guildId: string,
  userId: string,
): Promise<DashboardMembership | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  let member: GuildMember | undefined = guild.members.cache.get(userId);
  if (!member) {
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return null;
    }
  }

  return {
    canManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    memberRoleIds: [...member.roles.cache.keys()],
    voiceChannelId: member.voice.channelId,
  };
}
