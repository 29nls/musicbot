import type { Guild } from 'discord.js';
import { getEnv } from '../config/env.js';
import { closePanel, type PanelCloser } from '../modules/reactionroles/expire.js';
import { getReactionRoleService } from '../modules/reactionroles/index.js';
import type { ReactionRoleService } from '../modules/reactionroles/service.js';
import { getLogger } from './logger.js';

/**
 * Yang dibutuhkan job dari modul reaction role — interface tipis supaya bisa
 * diganti fake di tes.
 *
 * `markClosed` ikut masuk ke sini karena `closePanel` butuh keduanya, dan
 * memaksakan service asli di sini akan membuat job tidak bisa diuji.
 */
export interface PanelExpiryRunner extends PanelCloser {
  findDueForExpiry(now?: Date, limit?: number): ReturnType<ReactionRoleService['findDueForExpiry']>;
}

/** Sumber guild yang sudah login; null = bot belum siap. */
export type GuildSource = () => Guild[];

export interface PanelExpiryJobOptions {
  intervalMs?: number;
  runOnStart?: boolean;
  runner?: PanelExpiryRunner;
  guilds?: GuildSource;
  /** Batas panel per sapuan; default 25. */
  batchSize?: number;
}

export interface PanelExpiryResult {
  /** Panel yang benar-benar dinonaktifkan pada sapuan ini. */
  closed: number;
  /** Panel yang tidak bisa diedit pesannya (sudah dihapus / channel hilang). */
  messageMissing: number;
  /** Panel yang sudah ditutup sebelumnya — dilewati, bukan dihitung. */
  skipped: number;
}

export interface PanelExpiryJob {
  runOnce(now?: Date): Promise<PanelExpiryResult | null>;
  stop(): void;
}

const DEFAULT_MINUTES = 15;

/**
 * Job penyapuan panel reaction role yang sudah lewat masa hidup.
 *
 * Terpisah dari `retentionJob` karena sifatnya berbeda: retensi menghapus
 * baris data, sedangkan yang ini mengubah **pesan di Discord** dan butuh
 * gateway yang sudah login. Bedanya penting untuk pengujian — job ini bisa
 * gagal total tanpa satu pun baris kasus ikut hilang.
 *
 * Keamanannya:
 * - timer di-`unref()` sehingga tidak pernah menahan proses keluar;
 * - sapuan yang masih berjalan tidak diganggu sapuan berikutnya (mis. Discord
 *   sedang lambat), lewat latch `running`;
 * - satu panel yang gagal tidak menghentikan panel lain — tiap panel punya
 *   try/catch sendiri;
 * - `PANEL_EXPIRY_SWEEP_MINUTES=0` mematikan penjadwalan.
 */
export function startPanelExpiryJob(options: PanelExpiryJobOptions = {}): PanelExpiryJob {
  const logger = getLogger();
  const runner = options.runner ?? getReactionRoleService();
  const guilds = options.guilds ?? (() => []);
  const intervalMs = options.intervalMs ?? defaultIntervalMs();
  const batchSize = options.batchSize ?? 25;
  let running = false;

  const runOnce = async (now = new Date()): Promise<PanelExpiryResult | null> => {
    if (running) {
      logger.debug('Sapuan panel dilewati — sapuan sebelumnya masih jalan');
      return null;
    }

    running = true;
    try {
      const result = await sweep(runner, guilds, batchSize, now);

      if (result.closed > 0) {
        logger.info(
          { closed: result.closed, messageMissing: result.messageMissing },
          'Panel reaction role melewati masa hidup dinonaktifkan',
        );
      } else {
        logger.debug('Panel reaction role: tidak ada yang perlu dinonaktifkan');
      }

      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Penyapuan panel gagal — akan dicoba lagi nanti');
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
      'Job penyapuan panel reaction role dijadwalkan',
    );
  } else {
    logger.info('Job penyapuan panel reaction role: mati (PANEL_EXPIRY_SWEEP_MINUTES=0)');
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Job penyapuan panel dihentikan');
    },
  };
}

/**
 * Satu putaran penyapuan.
 *
 * Guild yang belum ada di cache dilewati: panelnya akan tertangguni sampai
 * sapuan berikutnya, dan itu jauh lebih baik daripada tries Edit ke guild yang
 * tidak ada (yang akan gagal untuk setiap panel di dalamnya).
 */
async function sweep(
  runner: PanelExpiryRunner,
  guilds: GuildSource,
  batchSize: number,
  now: Date,
): Promise<PanelExpiryResult> {
  const result: PanelExpiryResult = { closed: 0, messageMissing: 0, skipped: 0 };

  const panels = await runner.findDueForExpiry(now, batchSize);
  if (panels.length === 0) return result;

  const cache = new Map(guilds().map((guild) => [guild.id, guild]));

  for (const panel of panels) {
    const guild = cache.get(panel.guildId);
    if (!guild) {
      result.skipped += 1;
      continue;
    }

    try {
      const outcome = await closePanel(runner, guild, panel, 'expired', now);

      if (!outcome.changed) result.skipped += 1;
      else {
        result.closed += 1;
        if (!outcome.messageUpdated) result.messageMissing += 1;
      }
    } catch (error) {
      // Satu panel rusak tidak boleh menghentikan sisanya.
      getLogger().warn(
        { err: error, guild: panel.guildId, panelId: panel.id },
        'Gagal menonaktifkan panel yang lewat masa hidup',
      );
    }
  }

  if (result.skipped > 0) {
    getLogger().debug(
      { skipped: result.skipped },
      'Sebagian panel dilewati karena guild-nya belum ada di cache',
    );
  }

  return result;
}

/** Default dari env `PANEL_EXPIRY_SWEEP_MINUTES`; 0 berarti penjadwalan dimatikan. */
function defaultIntervalMs(): number {
  const minutes = getEnv().PANEL_EXPIRY_SWEEP_MINUTES;
  if (minutes === 0) return 0;

  return minutes * 60_000 || DEFAULT_MINUTES * 60_000;
}