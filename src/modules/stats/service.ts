import { getLogger } from '../../services/logger.js';
import { buildSummary } from './aggregate.js';
import { dayRange, startOfUtcDay } from './day.js';
import type { PlaybackStatRepository } from './repository.js';
import { purgeStatsBefore, type StatRetentionResult } from './retention.js';
import type { StatEntry, StatKind, StatSummary } from './types.js';
import {
  STAT_DEFAULT_DAYS,
  STAT_MAX_DAYS,
  STAT_MIN_DAYS,
  STAT_TOP_LIMIT,
} from './types.js';
import { assertStatInput, commandKey, statLabel, trackKey } from './validation.js';

/**
 * Statistik playback: mencatat lalu membaca.
 *
 * **Menulis dan membaca dipisah dengan sengaja.** `recordTrack` dan
 * `recordCommand` dipanggil dari dalam playback dan dari dalam handler
 * perintah — dua jalur yang tidak boleh gagal hanya karena statistik sedang
 * bermasalah. Jadi keduanya tidak pernah melempar: kegagalan dicatat ke log
 * dan playback berjalan seperti biasa. Membaca (`summary`) boleh melempar,
 * karena di sana pemanggil memang butuh tahu kalau jawabannya tidak dapat
 * dipercaya, dan menampilkan angka nol bukan cara jujur menyampaikan itu.
 */
export class StatsService {
  constructor(
    private readonly repository: PlaybackStatRepository,
    private readonly logger: {
      info: (payload: unknown, message: string) => void;
      warn: (payload: unknown, message: string) => void;
    } = getLogger(),
  ) {}

  /**
   * Catat satu lagu yang selesai diputar.
   *
   * `listenedMs` adalah waktu yang benar-benar terdengar, bukan durasi lagu.
   * Tanpa itu, satu `/play` lalu `/skip` bisa membuat lagu mana pun terlihat
   * seperti yang paling sering didengarkan, dan angka yang dipakai owner
   * server untuk memutuskan playlist bersama jadi tidak berarti.
   */
  async recordTrack(input: {
    guildId: string;
    title: string;
    uri?: string | null;
    listenedMs: number;
    at?: Date;
  }): Promise<boolean> {
    const key = trackKey({ uri: input.uri, title: input.title });
    const label = statLabel(input.title);

    return this.write({
      guildId: input.guildId,
      kind: 'track',
      key,
      label,
      listenedMs: input.listenedMs,
      at: input.at,
    });
  }

  /**
   * Catat pemakaian satu perintah.
   *
   * **Hanya nama perintahnya** yang disimpan (lihat `validation.commandKey`):
   * argumen dan teks yang diketik member tidak pernah masuk ke tabel ini.
   */
  async recordCommand(commandName: string, guildId: string, at?: Date): Promise<boolean> {
    return this.write({
      guildId,
      kind: 'command',
      key: commandKey(commandName),
      label: `/${statLabel(commandName)}`,
      listenedMs: 0,
      at,
    });
  }

  /**
   * Ringkasan untuk `/stats`.
   *
   * Rentang hari dijepit ke batas modul, jadi `days: 100000` tidak berubah
   * menjadi query yang mengambil seluruh arsip.
   */
  async summary(input: {
    guildId: string;
    kind: StatKind;
    days?: number;
    now?: Date;
    limit?: number;
  }): Promise<StatSummary> {
    const days = clampDays(input.days);
    const now = input.now ?? new Date();
    const { since, until } = dayRange(days, now);

    const entries = await this.repository.listRange(input.guildId, input.kind, since, until);

    return buildSummary({
      guildId: input.guildId,
      kind: input.kind,
      since,
      until,
      entries,
      limit: input.limit ?? STAT_TOP_LIMIT,
    });
  }

  /**
   * Hapus baris statistik yang melewati batas retensi (dipakai job retensi).
   */
  async purgeExpired(now = new Date()): Promise<StatRetentionResult> {
    return purgeStatsBefore(this.repository, now);
  }

  /** Penulisan tunggal: validasi dulu, lalu simpan tanpa pernah melempar. */
  private async write(input: {
    guildId: string;
    kind: StatKind;
    key: string;
    label: string;
    listenedMs: number;
    at?: Date;
  }): Promise<boolean> {
    const entry: StatEntry = {
      guildId: input.guildId,
      kind: input.kind,
      key: input.key,
      label: input.label,
      day: startOfUtcDay(input.at ?? new Date()),
      count: 1,
      listenedMs: Math.max(0, Math.trunc(input.listenedMs)),
    };

    try {
      assertStatInput(entry);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId: input.guildId, kind: input.kind },
        'Statistik dilewati karena kunci atau label kosong',
      );
      return false;
    }

    try {
      await this.repository.increment(entry);
      return true;
    } catch (error) {
      // Statistik bukan hal yang boleh menggagalkan playback atau perintah.
      // Diam-diam menulis angka yang lebih kecil karena basis data sempat mati
      // lebih baik daripada membuat orang mengira botnya rusak.
      this.logger.warn(
        { err: error, guildId: input.guildId, kind: input.kind, key: input.key },
        'Gagal menyimpan statistik playback — playback tetap berjalan',
      );

      return false;
    }
  }
}

/** Jaring pengaman rentang: nilai tidak masuk akal tidak jadi query besar. */
function clampDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days)) return STAT_DEFAULT_DAYS;

  return Math.min(STAT_MAX_DAYS, Math.max(STAT_MIN_DAYS, Math.trunc(days)));
}