import type { Guild } from 'discord.js';
import { getEnv } from '../config/env.js';
import { getStayService, type StayOutcome } from '../modules/music/index.js';
import { getLogger } from './logger.js';

/**
 * Job penyapuan mode 24/7 (PRD §5.2).
 *
 * Yang dijaga di sini hanya satu hal: setiap server yang punya `stayChannelId`
 * harus punya bot yang benar-benar tersambung di channel itu. Semua keputusan
 * (boleh/tidak, pindah/tidak) diambil `planStay`; job ini hanya menerjemahkan
 * hasilnya per server, per shard.
 *
 * Job ini yang menutup dua lubang yang tidak bisa ditutup perintah:
 * - bot restart atau shard reconnect → guild kembali tanpa koneksi voice;
 * - admin meng-kick bot, atau memindahkan bot manual → mode 24/7 jadi bohong.
 */

/** Yang dibutuhkan job dari modul musik — interface tipis supaya bisa di-fake. */
export interface StayApplier {
  apply(guildId: string, shardId: number): Promise<StayOutcome>;
}

/** Sumber guild yang sudah login; kosong = bot belum siap. */
export type StayGuildSource = () => Guild[];

export interface StayJobOptions {
  intervalMs?: number;
  runOnStart?: boolean;
  stay?: StayApplier;
  guilds?: StayGuildSource;
}

export interface StaySweepResult {
  /** Server yang diperiksa pada sapuan ini. */
  checked: number;
  /** Server yang barunya benar-benar tersambung ke channel 24/7. */
  joined: number;
  /** Server yang gagal dijaga (channel dihapus, izin hilang, dst). */
  errors: number;
}

export interface StayJob {
  runOnce(): Promise<StaySweepResult | null>;
  stop(): void;
}

const DEFAULT_MINUTES = 5;

/**
 * Mulai penjadwalan penyapuan mode 24/7.
 *
 * Keamanannya sama dengan `panelExpiryJob`:
 * - timer di-`unref()` sehingga tidak pernah menahan proses keluar;
 * - sapuan yang masih berjalan tidak diganggu sapuan berikutnya, lewat latch
 *   `running` — Discord bisa lambat, dan menyambung ke voice channel butuh
 *   waktu nyata;
 * - satu server yang gagal tidak menghentikan server lain;
 * - `STAY_SWEEP_MINUTES=0` mematikan penjadwalan (mis. saat mau drip kerjakan
 *   semua guild sekaligus lewat perintah).
 */
export function startStayJob(options: StayJobOptions = {}): StayJob {
  const logger = getLogger();
  const stay = options.stay ?? getStayService();
  const guilds = options.guilds ?? (() => []);
  const intervalMs = options.intervalMs ?? defaultIntervalMs();
  let running = false;

  const runOnce = async (): Promise<StaySweepResult | null> => {
    if (running) {
      logger.debug('Sapuan 24/7 dilewati — sapuan sebelumnya masih jalan');
      return null;
    }

    running = true;
    try {
      const result = await sweep(stay, guilds());

      if (result.joined > 0 || result.errors > 0) {
        logger.info(
          { checked: result.checked, joined: result.joined, errors: result.errors },
          'Sapuan mode 24/7 selesai',
        );
      } else {
        logger.debug({ checked: result.checked }, 'Mode 24/7: semua server sudah tersambung');
      }

      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Penyapuan mode 24/7 gagal — akan dicoba lagi nanti');
      return null;
    } finally {
      running = false;
    }
  };

  if (options.runOnStart !== false) {
    void runOnce();
  }

  let timer: NodeJS.Timeout | undefined;

  if (intervalMs > 0) {
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    timer.unref();
    logger.info(
      { intervalMinutes: Math.round(intervalMs / 60_000) },
      'Job penyapuan mode 24/7 dijadwalkan',
    );
  } else {
    logger.info('Job penyapuan mode 24/7: mati (STAY_SWEEP_MINUTES=0)');
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Job penyapuan mode 24/7 dihentikan');
    },
  };
}

/**
 * Satu putaran penyapuan.
 *
 * Server yang tidak ada di cache dilewati: `StayService` sudah membaca
 * konfigurasi dari database, jadi tidak ada gunanya memeriksa guild yang bot
 * sendiri tidak lihat.
 */
async function sweep(stay: StayApplier, guilds: Guild[]): Promise<StaySweepResult> {
  const result: StaySweepResult = { checked: guilds.length, joined: 0, errors: 0 };

  for (const guild of guilds) {
    try {
      const outcome = await stay.apply(guild.id, guild.shardId);
      if (outcome.joined) result.joined += 1;
      if (outcome.error !== null) result.errors += 1;
    } catch (error) {
      // Kontrak StayService tidak melempar, tapi satu server tidak boleh
      // menjatuhkan seluruh sapuan kalau suatu saat implementasinya berubah.
      result.errors += 1;
      getLogger().warn({ err: error, guild: guild.id }, 'Gagal menyapu mode 24/7 di satu server');
    }
  }

  return result;
}

/** Default dari env `STAY_SWEEP_MINUTES`; 0 berarti penjadwalan dimatikan. */
function defaultIntervalMs(): number {
  const minutes = getEnv().STAY_SWEEP_MINUTES;
  if (minutes === 0) return 0;

  return minutes * 60_000 || DEFAULT_MINUTES * 60_000;
}