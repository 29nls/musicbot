import type { Guild } from 'discord.js';
import { getEnv } from '../config/env.js';
import { finishGiveaway } from '../modules/giveaways/finish.js';
import { getGiveawayService } from '../modules/giveaways/index.js';
import type { EndGiveawayOutcome } from '../modules/giveaways/service.js';
import type { Giveaway } from '../modules/giveaways/types.js';
import { translatorFor } from '../modules/i18n/index.js';
import { getLogger } from './logger.js';

/**
 * Yang dibutuhkan job dari modul giveaway — interface tipis supaya bisa diganti
 * fake di tes tanpa database maupun Discord.
 */
export interface GiveawayExpiryRunner {
  findDue(
    now?: Date,
    guildIds?: readonly string[],
    limit?: number,
  ): Promise<Giveaway[]>;
  end(
    guildId: string,
    giveawayId: number,
    now?: Date,
  ): Promise<EndGiveawayOutcome | null>;
}

/** Sumber guild yang sudah login; array kosong = bot belum siap. */
export type GuildSource = () => Guild[];

export interface GiveawayJobOptions {
  intervalMs?: number;
  runOnStart?: boolean;
  runner?: GiveawayExpiryRunner;
  guilds?: GuildSource;
  /** Batas giveaway per sapuan; default 25. */
  batchSize?: number;
}

export interface GiveawayJobResult {
  ended: number;
  skipped: number;
  /** Hasil tidak bisa diumumkan karena channel/pesan sudah hilang. */
  messageMissing: number;
}

export interface GiveawayJob {
  runOnce(now?: Date): Promise<GiveawayJobResult | null>;
  stop(): void;
}

/**
 * Job penutupan giveaway yang sudah lewat waktu.
 *
 * Sama seperti sapuan panel reaction role: timer di-`unref()`, sapuan yang
 * masih berjalan tidak ditumpuk, dan satu giveaway rusak tidak menghentikan
 * sisanya.
 */
export function startGiveawayJob(options: GiveawayJobOptions = {}): GiveawayJob {
  const logger = getLogger();
  const runner = options.runner ?? getGiveawayService();
  const guilds = options.guilds ?? (() => []);
  const intervalMs = options.intervalMs ?? defaultIntervalMs();
  const batchSize = options.batchSize ?? 25;
  let running = false;

  const runOnce = async (now = new Date()): Promise<GiveawayJobResult | null> => {
    if (running) {
      logger.debug('Sapuan giveaway dilewati — sapuan sebelumnya masih jalan');
      return null;
    }

    running = true;
    try {
      const result = await sweep(runner, guilds, batchSize, now);

      if (result.ended > 0) {
        logger.info(
          { ended: result.ended, messageMissing: result.messageMissing },
          'Giveaway yang lewat waktu ditutup',
        );
      } else {
        logger.debug('Giveaway: tidak ada yang perlu ditutup');
      }

      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Penyapuan giveaway gagal — akan dicoba lagi nanti');
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
      { intervalSeconds: Math.round(intervalMs / 1_000) },
      'Job penyapuan giveaway dijadwalkan',
    );
  } else {
    logger.info('Job penyapuan giveaway: mati (GIVEAWAY_SWEEP_SECONDS=0)');
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Job penyapuan giveaway dihentikan');
    },
  };
}

async function sweep(
  runner: GiveawayExpiryRunner,
  guilds: GuildSource,
  batchSize: number,
  now: Date,
): Promise<GiveawayJobResult> {
  const result: GiveawayJobResult = { ended: 0, skipped: 0, messageMissing: 0 };

  // Batasi kueri ke guild milik shard ini. Tanpa batas itu, giveaway milik
  // proses lain menyita kuota batch dan tidak pernah sampai diurus.
  const cache = new Map(guilds().map((guild) => [guild.id, guild]));
  const ownedGuildIds = [...cache.keys()];
  if (ownedGuildIds.length === 0) return result;

  const due = await runner.findDue(now, ownedGuildIds, batchSize);
  if (due.length === 0) return result;

  for (const giveaway of due) {
    const guild = cache.get(giveaway.guildId);
    if (!guild) {
      result.skipped += 1;
      continue;
    }

    try {
      const outcome = await runner.end(giveaway.guildId, giveaway.id, now);
      if (!outcome?.changed) {
        result.skipped += 1;
        continue;
      }

      result.ended += 1;
      const t = await translatorFor(giveaway.guildId);
      const finished = await finishGiveaway(
        guild,
        outcome.giveaway,
        outcome.winners,
        outcome.entryCount,
        t,
      );
      if (!finished.announced) result.messageMissing += 1;
    } catch (error) {
      // Satu giveaway rusak tidak boleh menghentikan sisanya.
      getLogger().warn(
        { err: error, guild: giveaway.guildId, giveawayId: giveaway.id },
        'Gagal menutup giveaway yang lewat waktu',
      );
    }
  }

  return result;
}

/** Default dari env `GIVEAWAY_SWEEP_SECONDS`; 0 berarti penjadwalan mati. */
function defaultIntervalMs(): number {
  const seconds = getEnv().GIVEAWAY_SWEEP_SECONDS;
  return seconds * 1_000;
}
