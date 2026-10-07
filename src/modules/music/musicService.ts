import type { Client } from 'discord.js';
import {
  Constants,
  Connectors,
  LoadType,
  Shoukaku,
  type Player,
  type TrackEndEvent,
} from 'shoukaku';
import { getLogger } from '../../services/logger.js';
import type { GuildConfig } from '../config/index.js';
import { DEFAULT_IDLE_TIMEOUT_SEC } from '../config/types.js';
import { IdleTimer } from './idleTimer.js';
import { cycleResetOn, planAdvance, type LoopMode } from './loop.js';
import { filterParamsFor, isWithinSafeBounds, type FilterMode } from './filters.js';
import { checkLavalinkPlugins, loadExpectedPlugins } from './lavalinkPlugins.js';
import { lavalinkNodeName, summarizeLavalinkNodes, type LavalinkNodeReport } from './nodes.js';
import {
  PLAYER_OWNER_RENEW_MS,
  PlayerOwnedElsewhereError,
  type PlayerOwnership,
} from './ownership.js';
import { splitByTrackLimits } from './limits.js';
import { clampVolume } from './permissions.js';
import type { FilterOptions } from 'shoukaku';
import { buildSearchIdentifier } from './search.js';
import { foundTracks, pickTracks } from './selection.js';
import { SharedMusicState } from './sharedState.js';
import type { RandomSource } from './shuffle.js';
import { toTrackInfo } from './track.js';
import type {
  PlayOutcome,
  QueueSnapshot,
  SearchOutcome,
  SpotifySourceInfo,
  TrackInfo,
} from './types.js';

export interface MusicNodeOptions {
  host: string;
  port: number;
  password: string;
  name?: string;
}

export interface MusicServiceOptions {
  /** Baca konfigurasi server (volume default, idle timeout, modul aktif). */
  getConfig: (guildId: string) => Promise<GuildConfig>;
  /**
   * Semua node Lavalink; minimal satu (PRD §5.3, NFR §11).
   *
   * Dulu opsi ini satu node (`node`), jadi menambah node kedua berarti
   * mengubah kode bot — persis hal yang tidak boleh terjadi. Sekarang
   * semuanya masuk ke Shoukaku sekaligus, dan pembagian beban antar node
   * memakai `nodeResolver` bawaan Shoukaku: player baru goes ke node paling
   * sepi, dan `moveOnDisconnect` memindahkan player ke node lain saat satu
   * node mati.
   */
  nodes: MusicNodeOptions[];
  maxQueueSize: number;
  /** Batas lagu yang diingat untuk mode loop antrean. */
  maxLoopHistory?: number;
  /**
   * State musik bersama (antrean + mode loop) untuk §5.3.
   *
   * Disuntik di tes; kalau tidak diisi, memakai store kunci-nilai proses.
   */
  sharedState?: SharedMusicState;
  /**
   * Kepemilikan player di store bersama (§5.3).
   *
   * Disuntik, bukan dibuat di sini: `utils`/service tidak boleh bergantung ke
   * store secara langsung, dan tes butuh store sendiri tanpa Redis.
   */
  ownership?: PlayerOwnership;
  /**
   * Dipanggil tiap lagu selesai diputar, untuk statistik (§5.3).
   *
   * Callback, bukan dependency: modul musik tidak boleh tahu soal database,
   * dan callback yang melempar tidak boleh menjatuhkan pemutaran.
   */
  onTrackFinished?: (event: TrackFinishedEvent) => void;
}

/** Yang dilaporkan ke `onTrackFinished`. */
export interface TrackFinishedEvent {
  guildId: string;
  title: string;
  uri: string | null;
  /** Milidetik yang benar-benar terdengar, bukan durasi lagu. */
  listenedMs: number;
}

/** Batas default riwayat siklus; cukup untuk satu antrean panjang. */
const DEFAULT_MAX_LOOP_HISTORY = 100;

/**
 * Node cadangan kalau `nodes` kosong.
 *
 * Praktisnya tidak akan pernah dipakai — `initMusic` selalu mengisi daftar
 * node — tapi tipenya harus selalu punya arti. Tanpa ini, konfigurasi yang salah
 * akan muncul sebagai Shoukaku tanpa node sama sekali, yang tidak pernah
 * bersambung dan tidak pernah mengeluh di mana pun.
 */
const DEFAULT_NODE: MusicNodeOptions = { host: 'localhost', port: 2333, password: 'harmony' };

export interface PlayRequest {
  guildId: string;
  query: string;
  requesterId: string;
  voiceChannelId: string;
  shardId: number;
  /** true kalau peminta boleh memakai role DJ/Manage Server (batas §6.2). */
  canControl?: boolean;
}

/** Permintaan untuk lagu yang sudah di-resolve (dipakai `/search`). */
export interface EnqueueRequest {
  guildId: string;
  tracks: readonly TrackInfo[];
  voiceChannelId: string;
  shardId: number;
  /** true kalau peminta boleh memakai role DJ/Manage Server (batas §6.2). */
  canControl?: boolean;
  /** Metadata Spotify untuk ditampilkan di embed hasil. */
  spotify?: SpotifySourceInfo;
  playlistName?: string;
}

/**
 * Jembatan antara perintah Discord dan Lavalink (lewat shoukaku).
 *
 * Pembagian tanggung jawab:
 * - Lavalink memutar audio; `player.track` hanya berisi data base64 tanpa
 *   metadata, jadi **antrean dan lagu yang sedang diputar disimpan di sini**.
 * - Perpindahan lagu dikendalikan bot (lewat event `end`), bukan antrean
 *   internal Lavalink, supaya perilakunya bisa diprediksi dan dites.
 */
export class MusicService {
  private readonly manager: Shoukaku;
  /**
   * Antrean dan mode loop per guild, disimpan di store bersama (§9.4).
   *
   * Dulu dua `Map` di kelas ini: hilang saat bot restart dan tidak terlihat
   * oleh shard lain.
   */
  private readonly state: SharedMusicState;
  /** Nama node yang dikonfigurasi, urut. */
  private readonly nodeNames: string[];
  private readonly currents = new Map<string, TrackInfo>();
  private readonly idleTimers = new Map<string, IdleTimer>();
  private readonly attachedPlayers = new Map<string, Player>();
  /** Filter audio aktif per server; default `off`. */
  private readonly filterModes = new Map<string, FilterMode>();
  /**
   * Lagu-lagu yang sudah diputar dalam satu siklus, urut.
   *
   * Disimpan hanya untuk mode `queue`: itulah satu-satunya cara memutar ulang
   * antrean tanpa memuat ulang dari Lavalink, karena antrean sendiri hanya
   * berisi lagu yang belum diputar. Dibatasi agar server yang antreannya terus
   * berjalan tidak menahan referensi lagu selamanya.
   */
  private readonly playedCycles = new Map<string, TrackInfo[]>();
  /** Guild yang lease kepemilikannya dipegang proses ini (§5.3). */
  private readonly ownedGuilds = new Set<string>();
  /** Timer perpanjangan lease; `undefined` sampai ada guild yang diklaim. */
  private ownershipTimer: ReturnType<typeof setInterval> | undefined;

  constructor(client: Client, private readonly options: MusicServiceOptions) {
    const nodes = options.nodes.length > 0 ? options.nodes : [DEFAULT_NODE];
    this.nodeNames = nodes.map((node) => node.name ?? lavalinkNodeName(node));

    this.manager = new Shoukaku(
      new Connectors.DiscordJS(client),
      nodes.map((node) => ({
        name: node.name ?? lavalinkNodeName(node),
        url: `${node.host}:${node.port}`,
        auth: node.password,
        secure: false,
      })),
      {
        // Pindahkan player ke node lain kalau node mati, dan coba sambung ulang.
        moveOnDisconnect: true,
        reconnectTries: 10,
        reconnectInterval: 10,
        restTimeout: 20,
        userAgent: 'HarmonyBot/0.1.0 (+https://github.com/)',
      },
    );

    this.state = options.sharedState ?? new SharedMusicState({ capacity: options.maxQueueSize });

    this.attachManagerLogging();
  }

  /** true kalau ada node Lavalink yang siap dipakai. */
  get isConnected(): boolean {
    return this.manager.getIdealNode() !== undefined;
  }

  /**
   * Berapa node Lavalink yang dikonfigurasi.
   *
   * Dihitung dari daftar yang kita kirim, bukan dari `manager.nodes`:
   * Shoukaku baru mendaftarkan node ketika klien Discord siap, jadi sebelum
   * login peta itu kosong dan melaporkan nol padahal operator sudah menulis
   * lima node.
   */
  get nodeCount(): number {
    return this.nodeNames.length;
  }

  /**
   * Status tiap node untuk log dan `/health`.
   *
   * Jumlah player diambil dari laporan `/stats` node itu, jadi 0 sebelum
   * laporan pertama masuk — bukan bukti node itu kosong.
   */
  nodeReport(): LavalinkNodeReport {
    const live = new Map(
      [...this.manager.nodes.values()].map((node) => [node.name, node] as const),
    );

    return summarizeLavalinkNodes(
      this.nodeNames.map((name) => {
        const node = live.get(name);

        return {
          name,
          connected: node?.state === Constants.State.CONNECTED,
          players: node?.stats?.players ?? 0,
        };
      }),
    );
  }

  /**
   * Ukur latensi ke node Lavalink (ms) untuk metrik §11.
   *
   * Memakai `GET /stats` yang murah — bukan mencari lagu dan bukan menyentuh
   * player — jadi angkanya benar-benar biaya jaringan ke node, bukan biaya
   * pencarian. Mengembalikan `null` kalau tidak ada node atau node gagal
   * menjawab — metrik yang hilang jauh lebih baik daripada metrik yang berisi
   * angka tebakan.
   */
  async measureLavalinkLatency(): Promise<number | null> {
    const node = this.manager.getIdealNode();
    if (!node) return null;

    const startedAt = Date.now();

    try {
      await node.rest.stats();
      return Math.max(0, Date.now() - startedAt);
    } catch (error) {
      getLogger().debug({ err: error }, 'Gagal mengukur latensi Lavalink');
      return null;
    }
  }

  /** Channel voice tempat bot berada di server ini. */
  botVoiceChannelId(guildId: string): string | null {
    return this.manager.connections.get(guildId)?.channelId ?? null;
  }

  isPlaying(guildId: string): boolean {
    return this.currents.has(guildId);
  }

  /** Cari lagu ke Lavalink. Tidak melempar: semua kegagalan jadi hasil terstruktur. */
  async resolve(query: string): Promise<SearchOutcome> {
    const node = this.manager.getIdealNode();
    if (!node) return { kind: 'unavailable' };

    try {
      const result = await node.rest.resolve(buildSearchIdentifier(query));
      if (!result) return { kind: 'empty' };

      switch (result.loadType) {
        case LoadType.TRACK:
          return foundTracks([result.data]);
        case LoadType.PLAYLIST:
          return foundTracks(result.data.tracks, result.data.info.name);
        case LoadType.SEARCH:
          return foundTracks(result.data);
        case LoadType.EMPTY:
          return { kind: 'empty' };
        case LoadType.ERROR:
          return { kind: 'error', message: result.data.message };
        default:
          return { kind: 'empty' };
      }
    } catch (error) {
      getLogger().error({ err: error, query }, 'Pencarian ke Lavalink gagal');
      return { kind: 'unavailable' };
    }
  }

  /** Alur `/play`: cari → join voice → putar atau antrekan. */
  async play(request: PlayRequest): Promise<PlayOutcome> {
    const { guildId, query, requesterId } = request;

    const found = await this.resolve(query);
    if (found.kind === 'empty') return { kind: 'empty' };
    if (found.kind === 'error') return { kind: 'error', message: found.message };
    if (found.kind === 'unavailable') return { kind: 'unavailable' };

    // `/play` menambahkan TEPAT SATU lagu: hasil terbaik (PRD US-01 —
    // "memutar hasil terbaik"). `ytsearch:` kembali dengan ±25 hasil, dan URL
    // YouTube yang memuat `&list=` (radio/mix) kembali sebagai playlist;
    // memasukkan semuanya membuat `/play` memutar banyak lagu berturut-turut.
    // Aturannya sendiri tinggal di `selection.ts` supaya `/search` dan
    // `/playlist add` tidak menulis ulang jawaban yang berbeda untuk pertanyaan
    // yang sama — `resolve()` tetap tidak dipotong, karena pemanggil lain butuh
    // daftar penuhnya.
    const [best] = pickTracks(found, 'single', query);
    if (!best) return { kind: 'empty' };

    return this.enqueue({
      guildId,
      tracks: [toTrackInfo(best, requesterId)],
      voiceChannelId: request.voiceChannelId,
      shardId: request.shardId,
      canControl: request.canControl,
      // playlistName tidak diteruskan: hasilnya kini selalu satu lagu dan
      // judul embednya judul lagu itu sendiri (US-01), bukan nama playlist.
    });
  }

  /**
   * Masukkan lagu yang **sudah di-resolve** ke antrean atau ke pemutaran.
   *
   * Dipisah dari `play` karena `/search` sudah punya track-nya di tangan
   * (hasil select menu), jadi tidak perlu memanggil Lavalink sekali lagi.
   */
  async enqueue(request: EnqueueRequest): Promise<PlayOutcome> {
    const { guildId, voiceChannelId, shardId, playlistName } = request;
    if (request.tracks.length === 0) return { kind: 'empty' };

    // Batas §6.2: 6 jam untuk semua orang, dan lagu panjang hanya untuk DJ.
    // Penolakan dihitung SEBELUM player dibuat supaya request yang memang tidak
    // boleh diputar tidak pernah sempat menghubungkan bot ke voice channel.
    const split = splitByTrackLimits(request.tracks, { canControl: request.canControl ?? false });
    const tracks = split.accepted;

    if (tracks.length === 0) {
      return split.tooLong.length > 0
        ? { kind: 'rejected', reason: 'too-long', count: split.tooLong.length }
        : { kind: 'rejected', reason: 'needs-control', count: split.needsControl.length };
    }

    const rejected = {
      rejectedTooLong: split.tooLong.length,
      rejectedNeedsControl: split.needsControl.length,
    };

    const player = await this.ensurePlayer(guildId, voiceChannelId, shardId);
    const config = await this.options.getConfig(guildId);

    if (!this.isPlaying(guildId)) {
      const [first, ...rest] = tracks;
      if (!first) return { kind: 'empty' };

      const queued = await this.state.add(guildId, rest);
      await player.setGlobalVolume(clampVolume(config.defaultVolume));
      await this.applyStoredFilters(guildId, player);
      await this.startTrack(guildId, player, first);

      return {
        kind: 'added',
        tracks: [first, ...queued.accepted],
        started: true,
        position: queued.size,
        skipped: queued.skipped,
        ...rejected,
        spotify: request.spotify,
        playlistName,
      };
    }

    const queued = await this.state.add(guildId, tracks);
    if (queued.accepted.length === 0) return { kind: 'queue-full' };

    return {
      kind: 'added',
      tracks: queued.accepted,
      started: false,
      position: queued.size,
      skipped: queued.skipped,
      ...rejected,
      spotify: request.spotify,
      playlistName,
    };
  }

  /** Lewati lagu sekarang; kalau antrean habis, pemutaran dihentikan. */
  async skip(guildId: string): Promise<{ skipped: TrackInfo | null; next: TrackInfo | null }> {
    const skipped = this.currents.get(guildId) ?? null;
    const player = this.manager.players.get(guildId);
    if (!player) return { skipped, next: null };

    // `/skip` selalu benar-benar melewati: kalau mode `track` ikut dipatuhi di
    // sini, tombol skip jadi tidak melakukan apa pun, dan itu bukan yang biasa
    // orang maksudkan saat menekan tombol.
    const next = await this.advanceToNext(guildId, player, skipped, { respectTrackLoop: false });

    if (!next) {
      await player.stopTrack().catch(() => undefined);
      await this.scheduleIdleDisconnect(guildId);
    }

    return { skipped, next };
  }

  async setPaused(guildId: string, paused: boolean): Promise<boolean> {
    const player = this.manager.players.get(guildId);
    if (!player) return false;

    await player.setPaused(paused);
    return true;
  }

  /** Mode loop server ini; default `off`. */
  loopMode(guildId: string): LoopMode {
    return this.state.loopMode(guildId);
  }

  /**
   * Ubah mode loop server ini.
   *
   * Memindahkan `track` → `queue` (atau sebaliknya) mempertahankan riwayat
   * siklus: orang yang baru menyalakan loop antrean di tengah lagu kelima tetap
   * mendapat seluruh siklus, bukan cuma lagu yang tersisa.
   */
  async setLoopMode(guildId: string, mode: LoopMode): Promise<LoopMode> {
    const previous = await this.state.setLoopMode(guildId, mode);

    if (cycleResetOn(mode, previous) === 'clear') {
      this.playedCycles.delete(guildId);
    }

    return previous;
  }

  /** Mode filter server ini; default `off`. */
  filterMode(guildId: string): FilterMode {
    return this.filterModes.get(guildId) ?? 'off';
  }

  /**
   * Ubah filter audio server ini.
   *
   * Filter adalah milik player Lavalink, bukan antrean: ia menempel sampai
   * diubah atau player dihancurkan. Kalau player belum ada, mode hanya
   * disimpan dan diterapkan saat pemutaran dimulai (applyStoredFilters) —
   * jadi `/filter` sebelum `/play` pertama tidak boleh dilaporkan gagal.
   */
  async setFilterMode(
    guildId: string,
    mode: FilterMode,
  ): Promise<{ previous: FilterMode; applied: boolean }> {
    const previous = this.filterMode(guildId);
    this.filterModes.set(guildId, mode);

    const player = this.manager.players.get(guildId);
    if (!player) return { previous, applied: false };

    await player.setFilters(filterParamsFor(mode) as FilterOptions);
    return { previous, applied: true };
  }

  /** Terapkan filter yang tersimpan ke player yang baru dibuat (best-effort). */
  private async applyStoredFilters(guildId: string, player: Player): Promise<void> {
    const mode = this.filterMode(guildId);
    if (mode === 'off') return;

    const params = filterParamsFor(mode);
    if (!isWithinSafeBounds(params)) {
      getLogger().warn({ guildId, mode }, 'Parameter filter di luar batas aman — dilewati');
      return;
    }

    await player.setFilters(params as FilterOptions).catch((error: unknown) => {
      getLogger().warn({ err: error, guildId, mode }, 'Gagal menerapkan filter tersimpan');
    });
  }

  /** Atur volume player; nilai dibatasi ke rentang yang diterima Discord. */
  async setVolume(guildId: string, level: number): Promise<number> {
    const player = this.manager.players.get(guildId);
    const volume = clampVolume(level);
    if (!player) return volume;

    await player.setGlobalVolume(volume);
    return volume;
  }

  /** Lompat ke posisi tertentu (ms) pada lagu yang sedang diputar. */
  async seek(guildId: string, positionMs: number): Promise<boolean> {
    const player = this.manager.players.get(guildId);
    if (!player) return false;

    await player.seekTo(Math.max(Math.trunc(positionMs), 0));
    return true;
  }

  /** Acak antrean; mengembalikan jumlah lagu yang diacak. */
  async shuffle(guildId: string, random: RandomSource = Math.random): Promise<number> {
    return this.state.shuffle(guildId, random);
  }

  /** Hapus satu lagu dari antrean; undefined kalau posisinya di luar jangkauan. */
  async removeFromQueue(guildId: string, position: number): Promise<TrackInfo | undefined> {
    return this.state.remove(guildId, position);
  }

  /** Pindahkan satu lagu dalam antrean; null kalau salah satu posisi salah. */
  async moveInQueue(guildId: string, from: number, to: number): Promise<TrackInfo | null> {
    return this.state.move(guildId, from, to);
  }

  /** Hentikan pemutaran dan bersihkan antrean (bot tetap di voice channel). */
  async stop(guildId: string): Promise<TrackInfo | null> {
    const stopped = this.currents.get(guildId) ?? null;
    const player = this.manager.players.get(guildId);

    await this.state.clearTracks(guildId);
    this.currents.delete(guildId);
    // Siklus ikut dibuang: setelah `/stop` tidak ada lagi lagu yang diputar dalam
    // siklus ini, dan memegangnya hanya menahan referensi tanpa guna.
    this.playedCycles.delete(guildId);

    if (player) await player.stopTrack().catch(() => undefined);
    await this.scheduleIdleDisconnect(guildId);

    return stopped;
  }

  /** Keluar dari voice channel dan bersihkan seluruh state server ini. */
  async disconnect(guildId: string): Promise<void> {
    await this.resetGuildState(guildId);

    if (this.manager.players.has(guildId) || this.manager.connections.has(guildId)) {
      await this.manager.leaveVoiceChannel(guildId).catch((error: unknown) => {
        getLogger().warn({ err: error, guildId }, 'Gagal keluar dari voice channel');
      });
    }

    // Player sudah tidak ada, jadi lease juga dilepas: guild ini boleh
    // diambil proses lain tanpa menunggu TTL lima menit.
    await this.releasePlayerOwnership(guildId);
  }

  /**
   * Sambung bot ke channel 24/7 tanpa memulai pemutaran apa pun.
   *
   * Satu pintu masuk yang sama dengan `/play` (lewat `ensurePlayer`) supaya
   * volume default, filter, dan pembersihan player tetap memakai jalur yang sudah
   * diuji. Volume tetap dipasang di sini: player yang baru dibuat punya volume
   * Lavalink, bukan nilai `/config`, jadi tanpa ini `/config set volume:40`
   * akan diabaikan sampai ada lagu pertama.
   */
  async joinStayChannel(guildId: string, channelId: string, shardId: number): Promise<void> {
    const player = await this.ensurePlayer(guildId, channelId, shardId);

    let volume = 100;
    try {
      volume = clampVolume((await this.options.getConfig(guildId)).defaultVolume);
    } catch (error) {
      getLogger().warn(
        { err: error, guildId },
        'Gagal membaca volume default untuk mode 24/7 — memakai 100',
      );
    }

    // Kegagalan set volume bukan kegagalan menyambung: bot sudah di channel,
    // dan mencoba lagi pada sapuan berikutnya cukup.
    await player.setGlobalVolume(volume).catch((error: unknown) => {
      getLogger().warn({ err: error, guildId }, 'Gagal memasang volume pada mode 24/7');
    });
  }

  /**
   * Batalkan hitungan mundur keluar otomatis.
   *
   * Dipakai perintah `/247 join`: kalau antrean sudah habis dan timer idle
   * sedang berjalan, menyalakan mode 24/7 harus langsung membatalkan timer
   * itu — kalau tidak, bot tetap keluar dan baru kembali lagi setelah sapuan
   * job berikutnya.
   */
  cancelIdleDisconnect(guildId: string): void {
    this.idleTimers.get(guildId)?.cancel();
  }

  /** Ringkasan untuk `/queue` dan `/nowplaying`. */
  async snapshot(guildId: string): Promise<QueueSnapshot> {
    const player = this.manager.players.get(guildId);
    // Selalu baca dari store lebih dulu: snapshot adalah tempat `/queue` melihat
    // antrean, jadi di sinilah state bersama harus masuk.
    await this.state.refresh(guildId);
    let volume = player?.volume ?? 100;

    if (!player) {
      try {
        volume = clampVolume((await this.options.getConfig(guildId)).defaultVolume);
      } catch {
        // Database tidak bisa dihubungi — volume default dipakai apa adanya.
      }
    }

    return {
      guildId,
      current: this.currents.get(guildId) ?? null,
      upcoming: this.state.tracks(guildId),
      upcomingDurationMs: this.state.upcomingDurationMs(guildId),
      paused: player?.paused ?? false,
      positionMs: player?.position ?? 0,
      volume,
      idleRemainingMs: this.idleTimers.get(guildId)?.remainingMs ?? null,
      loopMode: this.loopMode(guildId),
      filterMode: this.filterMode(guildId),
    };
  }

  /** Dipanggil saat bot dimatikan: batalkan timer dan keluar dari semua voice channel. */
  async shutdown(): Promise<void> {
    for (const timer of this.idleTimers.values()) timer.cancel();
    this.idleTimers.clear();
    this.state.forgetAll();

    const guildIds = [...this.manager.connections.keys()];
    await Promise.allSettled(guildIds.map((guildId) => this.manager.leaveVoiceChannel(guildId)));
  }

  private attachManagerLogging(): void {
    const logger = getLogger();

    this.manager.on('ready', (name) => {
      logger.info(
        { node: name, configured: this.nodeNames.length, connected: this.nodeReport().connected },
        'Node Lavalink terhubung',
      );
      // Pemeriksaan menyusul, bukan menghambat log di atas: node yang sudah
      // tersambung tetap bisa dipakai walau pemeriksaan ini gagal.
      void this.verifyNodePlugins(name);
    });
    this.manager.on('error', (name, error) =>
      logger.error({ err: error, node: name }, 'Error pada node Lavalink'),
    );
    this.manager.on('close', (name, code, reason) =>
      logger.warn({ node: name, code, reason }, 'Koneksi node Lavalink ditutup'),
    );
    this.manager.on('disconnect', (name, players) =>
      logger.warn({ node: name, players }, 'Node Lavalink terputus — menyambung ulang'),
    );
  }

  /**
   * Bandingkan plugin yang dimuat node dengan `lavalink/application.yml`.
   *
   * Kenapa perlu: log dan angka dari Lavalink hanya berguna kalau prosesnya
   * memuat config yang sekarang ada di repo. Kasus yang pernah terjadi —
   * config sudah minta 1.18.2 sementara proses yang hidup masih memuat
   * 1.18.1 — baru ketahuan setelah satu putaran diagnosis terbuang. Node
   * melaporkan plugin yang dimuatnya lewat `/v4/info`, jadi selisih itu bisa
   * disebut bot sendiri tepat saat node tersambung.
   *
   * Batasnya: hanya versi plugin yang bisa diperiksa dari luar. Daftar klien
   * di dalam plugin tidak diekspos rute mana pun, jadi itu diverifikasi
   * lewat `node tools/yts-probe.mjs` (bagian `dipakai=`).
   *
   * Tidak pernah melempar dan tidak menghalangi: config yang tidak terbaca
   * (image Docker tidak memuat folder `lavalink/`) atau node yang tidak
   * menjawab hanya masuk log `debug`, lalu bot lanjut seperti biasa.
   */
  private async verifyNodePlugins(nodeName: string): Promise<void> {
    const logger = getLogger();

    try {
      const expectations = await loadExpectedPlugins();
      if (expectations.kind !== 'ok') {
        logger.debug(
          { node: nodeName, reason: expectations.reason },
          'Pemeriksaan plugin Lavalink dilewati',
        );
        return;
      }

      const node = this.manager.nodes.get(nodeName);
      if (!node) return;

      const info = node.info ?? (await node.rest.getLavalinkInfo());
      if (!info) {
        logger.debug({ node: nodeName }, 'Node Lavalink tidak melaporkan daftar plugin');
        return;
      }

      const check = checkLavalinkPlugins(expectations.plugins, info.plugins ?? []);
      if (!check.warning) {
        logger.debug(
          { node: nodeName, plugins: info.plugins ?? [] },
          'Plugin Lavalink cocok dengan application.yml',
        );
        return;
      }

      logger.warn(
        { node: nodeName, selisih: check.mismatches, dimuat: info.plugins ?? [] },
        check.warning,
      );
    } catch (error) {
      logger.debug({ err: error, node: nodeName }, 'Pemeriksaan plugin Lavalink gagal dijalankan');
    }
  }

  private attachPlayerLogging(player: Player): void {
    if (this.attachedPlayers.get(player.guildId) === player) return;
    this.attachedPlayers.set(player.guildId, player);

    const logger = getLogger();
    const guildId = player.guildId;

    player.on('end', (event: TrackEndEvent) => {
      void this.handleTrackEnd(guildId, player, event);
    });

    // Lavalink selalu mengirim 'end' (loadFailed) setelah exception, jadi
    // kemajuan antrean ditangani handleTrackEnd.
    player.on('exception', (event) =>
      logger.error({ guildId, exception: event.exception }, 'Lavalink gagal memutar lagu'),
    );

    player.on('stuck', (event) => {
      logger.warn({ guildId, thresholdMs: event.thresholdMs }, 'Lagu macet — dilewati');
      void this.skip(guildId).catch((error: unknown) =>
        logger.error({ err: error, guildId }, 'Gagal melewati lagu yang macet'),
      );
    });

    player.on('closed', (event) =>
      logger.warn({ guildId, code: event.code, reason: event.reason }, 'Koneksi voice ditutup Discord'),
    );
  }

  private async handleTrackEnd(guildId: string, player: Player, event: TrackEndEvent): Promise<void> {
    // 'replaced' berarti kita sendiri yang memutar lagu berikutnya — jangan
    // maju dua kali.
    if (event.reason === 'replaced') return;

    const logger = getLogger();
    if (event.reason === 'loadFailed') {
      logger.warn({ guildId, track: event.track.info.title }, 'Lagu gagal dimuat — lanjut ke berikutnya');
    }

    const finished = this.currents.get(guildId) ?? null;
    this.reportFinishedTrack(guildId, player, finished);

    const next = await this.advanceToNext(guildId, player, finished);
    if (next) return;

    this.currents.delete(guildId);
    await player.stopTrack().catch(() => undefined);
    await this.scheduleIdleDisconnect(guildId);
  }

  /** Laporkan lagu yang baru selesai ke pemanggil statistik (kalau ada). */
  private reportFinishedTrack(guildId: string, player: Player, finished: TrackInfo | null): void {
    const report = this.options.onTrackFinished;
    if (!report || !finished) return;

    const listenedMs = Math.min(Math.max(player.position ?? 0, 0), finished.durationMs);

    try {
      report({ guildId, title: finished.title, uri: finished.uri, listenedMs });
    } catch (error) {
      // Statistik tidak boleh jadi alasan pemutaran gagal: error di sini cuma
      // berarti satu angka yang tidak tercatat.
      getLogger().warn({ err: error, guildId }, 'Gagal melaporkan lagu selesai ke statistik');
    }
  }

  /**
   * Moves to whatever should play after `finished`; null means nothing left.
   *
   * Tiga mode loop menentukan keputusan ini:
   * - `track`: replay the same song. The one exception is `/skip`, which asks to
   *   be passed for good.
   * - `queue`: when the queue runs dry, push the songs already played in this
   *   cycle back to the back of the queue and start a new cycle.
   * - `off`: pure FIFO.
   *
   * The songs already played are pushed to the history *before* the queue is
   * checked for refilling, so the song that just ended is the first to play in
   * the new cycle — otherwise the loop would skip its opening song.
   */
  private async advanceToNext(
    guildId: string,
    player: Player,
    finished: TrackInfo | null,
    options: { respectTrackLoop?: boolean } = {},
  ): Promise<TrackInfo | null> {
    // Satu kali baca-ubah-tulis: `planAdvance` memutuskan dari antrean
    // terbaru, dan hasilnya langsung ditulis di bacaan yang sama, jadi tidak
    // ada celah di mana proses lain bisa menyisipkan lagu di antaranya.
    const plan = await this.state.mutateQueue(guildId, (queue, record) => {
      const decision = planAdvance({
        mode: record.loopMode,
        finished,
        queue: queue.toArray(),
        cycle: this.playedCycles.get(guildId) ?? [],
        respectTrackLoop: options.respectTrackLoop,
      });

      if (decision.action === 'play') {
        queue.clear();
        queue.add(decision.queue);
      }

      return decision;
    });

    if (plan.action === 'stop') {
      this.playedCycles.delete(guildId);
      return null;
    }

    if (plan.action === 'play') {
      this.rememberCycle(guildId, plan.cycle);
    }

    await this.startTrack(guildId, player, plan.track);
    return plan.track;
  }

  /** Simpan riwayat siklus, dipotong agar tidak menahan lagu tanpa batas. */
  private rememberCycle(guildId: string, cycle: TrackInfo[]): void {
    if (cycle.length === 0) {
      this.playedCycles.delete(guildId);
      return;
    }

    const limit = this.options.maxLoopHistory ?? DEFAULT_MAX_LOOP_HISTORY;
    this.playedCycles.set(guildId, cycle.slice(-limit));
  }

  private async startTrack(guildId: string, player: Player, track: TrackInfo): Promise<void> {
    this.currents.set(guildId, track);
    this.idleTimerFor(guildId).cancel();

    await player.playTrack({ track: { encoded: track.encoded } });
  }

  private async ensurePlayer(guildId: string, channelId: string, shardId: number): Promise<Player> {
    // Diklaim lebih dulu, termasuk saat player sudah ada: ini yang memperpanjang
    // lease setiap ada perintah, jadi guild yang dipegang proses ini tidak
    // pernah diambil proses lain lewat jalur diam-diam.
    await this.claimPlayerOwnership(guildId);

    const existing = this.manager.players.get(guildId);
    if (existing && this.botVoiceChannelId(guildId) === channelId) return existing;

    if (existing) {
      // Player lama tapi bot tidak lagi di channel itu (koneksi basi/kicked).
      await existing.destroy().catch(() => undefined);
      await this.resetGuildState(guildId);
    }

    const player = await this.manager.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: true,
    });

    this.attachPlayerLogging(player);
    return player;
  }

  /**
   * Klaim kepemilikan player guild ini sebelum apa pun menyentuhnya (§5.3).
   *
   * Melempar kalau guild sedang dipegang proses lain: diam-diam melanjutkan
   * akan menghasilkan dua proses yang menjalankan player untuk guild yang sama,
   * dan penyebabnya tidak akan terlihat dari luar.
   */
  private async claimPlayerOwnership(guildId: string): Promise<void> {
    const ownership = this.options.ownership;
    if (!ownership?.available) return;

    const claim = await ownership.claim(guildId);
    if (claim === 'foreign') {
      throw new PlayerOwnedElsewhereError(guildId, await ownership.ownerOf(guildId));
    }

    this.ownedGuilds.add(guildId);
    this.startOwnershipHeartbeat();
  }

  /**
   * Perpanjang lease yang dipegang proses ini.
   *
   * Diperpanjang karena guild bisa memegang player-nya jauh lebih lama
   * daripada TTL lease: koneksi mode 24/7 yang sama mungkin bertahan
   * berminggu-minggu.
   * Kalau ternyata proses lain sudah mengambil alih, guild dilepas dari daftar
   * lokal supaya proses ini tidak menembak owner yang bukan dirinya.
   */
  private async renewOwnership(): Promise<void> {
    const ownership = this.options.ownership;
    if (!ownership?.available || this.ownedGuilds.size === 0) return;

    for (const guildId of [...this.ownedGuilds]) {
      const claim = await ownership.claim(guildId);
      if (claim !== 'foreign') continue;

      this.ownedGuilds.delete(guildId);
      getLogger().warn(
        { guildId },
        'Kepemilikan player guild ini diambil proses lain — guild dikeluarkan dari daftar lokal',
      );
    }
  }

  /** Timer perpanjangan; `unref()` supaya tidak menahan proses saat bot berhenti. */
  private startOwnershipHeartbeat(): void {
    if (this.ownershipTimer) return;

    this.ownershipTimer = setInterval(() => {
      void this.renewOwnership();
    }, PLAYER_OWNER_RENEW_MS);
    this.ownershipTimer.unref?.();
  }

  /** Lepas lease kalau ini memang milik proses ini. */
  private async releasePlayerOwnership(guildId: string): Promise<void> {
    if (!this.ownedGuilds.delete(guildId)) return;

    await this.options.ownership?.release(guildId);

    if (this.ownedGuilds.size === 0 && this.ownershipTimer) {
      clearInterval(this.ownershipTimer);
      this.ownershipTimer = undefined;
    }
  }

  private async scheduleIdleDisconnect(guildId: string): Promise<void> {
    const logger = getLogger();
    const timer = this.idleTimerFor(guildId);

    let seconds = DEFAULT_IDLE_TIMEOUT_SEC;
    let stayChannelId: string | null = null;
    let musicModuleEnabled = true;
    try {
      const config = await this.options.getConfig(guildId);
      seconds = config.idleTimeoutSec;
      stayChannelId = config.stayChannelId;
      musicModuleEnabled = config.modules.music;
    } catch (error) {
      logger.warn({ err: error, guildId }, 'Gagal membaca idle timeout — memakai nilai default');
    }

    // Mode 24/7 (PRD §5.2): configured channel = bot harus tinggal. Menjalankan
    // timer di sini akan memutus tepat fitur yang sedang dinyalakan, jadi
    // antrean kosong tidak berarti apa-apa selama mode ini aktif.
    if (musicModuleEnabled && stayChannelId !== null) {
      timer.cancel();
      logger.debug(
        { guildId, stayChannelId },
        'Antrean habis, tapi mode 24/7 aktif — bot tetap tinggal',
      );
      return;
    }

    if (seconds <= 0) {
      timer.cancel();
      return;
    }

    timer.start(seconds * 1_000);
    logger.info({ guildId, seconds }, 'Antrean habis — bot akan keluar otomatis kalau tetap sepi');
  }

  private idleTimerFor(guildId: string): IdleTimer {
    const existing = this.idleTimers.get(guildId);
    if (existing) return existing;

    const timer = new IdleTimer(() => {
      void this.handleIdle(guildId);
    });
    this.idleTimers.set(guildId, timer);

    return timer;
  }

  private async handleIdle(guildId: string): Promise<void> {
    getLogger().info({ guildId }, 'Tidak ada aktivitas — keluar dari voice channel');
    await this.disconnect(guildId);
  }

  private async resetGuildState(guildId: string): Promise<void> {
    await this.state.reset(guildId);
    this.currents.delete(guildId);
    this.idleTimers.get(guildId)?.cancel();
    this.attachedPlayers.delete(guildId);
    this.filterModes.delete(guildId);
    this.playedCycles.delete(guildId);
  }
}
