import { getLogger } from '../logger/index.js';
import type { GiveawayRepository } from './repository.js';
import type { CreateGiveawayInput, Giveaway } from './types.js';
import { isGiveawayActive } from './types.js';
import {
  normalizePrize,
  normalizeWinnersCount,
  pickWinners,
} from './validation.js';

export type JoinOutcome = 'added' | 'duplicate' | 'closed' | 'missing';

export interface EndGiveawayOutcome {
  giveaway: Giveaway;
  winners: string[];
  /** Jumlah peserta sebelum entri dihapus; dipakai embed hasil. */
  entryCount: number;
  /** false kalau giveaway sudah ditutup pemanggil lain. */
  changed: boolean;
}

/**
 * Logika domain giveaway.
 *
 * Tidak menyentuh Discord: pengiriman pesan, tombol, dan edit hasil tetap di
 * lapisan command, handler komponen, dan job.
 */
export class GiveawayService {
  constructor(
    private readonly repository: GiveawayRepository,
    private readonly random: () => number = Math.random,
  ) {}

  async create(input: CreateGiveawayInput): Promise<Giveaway> {
    return this.repository.create({
      ...input,
      prize: normalizePrize(input.prize),
      winnersCount: normalizeWinnersCount(input.winnersCount),
    });
  }

  async find(guildId: string, giveawayId: number): Promise<Giveaway | null> {
    return this.repository.find(guildId, giveawayId);
  }

  async join(
    guildId: string,
    giveawayId: number,
    userId: string,
    now = new Date(),
  ): Promise<JoinOutcome> {
    const giveaway = await this.repository.find(guildId, giveawayId);
    if (!giveaway) return 'missing';
    if (!isGiveawayActive(giveaway, now)) return 'closed';

    return this.repository.addEntry(giveawayId, userId, now);
  }

  /**
   * Tutup giveaway dan pilih pemenang.
   *
   * `markEnded` adalah klaim atomik: hanya satu pemanggil yang mendapat
   * `changed: true`. Entri dihapus setelah pemenang dipilih, jadi data peserta
   * tidak tersisa setelah hasil diumumkan. Kalau penghapusan gagal, giveaway
   * tetap ditutup dan `/data-delete` masih bisa membersihkan sisanya.
   */
  async end(
    guildId: string,
    giveawayId: number,
    now = new Date(),
  ): Promise<EndGiveawayOutcome | null> {
    const current = await this.repository.find(guildId, giveawayId);
    if (!current) return null;
    if (current.endedAt) {
      return { giveaway: current, winners: [], entryCount: 0, changed: false };
    }

    const claimed = await this.repository.markEnded(guildId, giveawayId, now);
    if (!claimed) {
      const fresh = await this.repository.find(guildId, giveawayId);
      return fresh
        ? { giveaway: fresh, winners: [], entryCount: 0, changed: false }
        : null;
    }

    const entries = await this.repository.listEntryUserIds(giveawayId);
    const winners = pickWinners(entries, claimed.winnersCount, this.random);

    try {
      await this.repository.deleteEntries(giveawayId);
    } catch (error) {
      getLogger().warn(
        { err: error, guild: guildId, giveawayId },
        'Gagal menghapus entri giveaway setelah penutupan',
      );
    }

    return { giveaway: claimed, winners, entryCount: entries.length, changed: true };
  }

  async findDue(
    now = new Date(),
    guildIds: readonly string[] = [],
    limit = 25,
  ): Promise<Giveaway[]> {
    return this.repository.findDue(now, guildIds, limit);
  }

  async attachMessage(giveawayId: number, messageId: string): Promise<void> {
    try {
      await this.repository.attachMessage(giveawayId, messageId);
    } catch (error) {
      getLogger().warn(
        { err: error, giveawayId },
        'Gagal menempelkan ID pesan giveaway',
      );
    }
  }

  /** Hapus baris yang pesannya gagal dikirim, supaya tidak jadi giveaway hantu. */
  async delete(guildId: string, giveawayId: number): Promise<void> {
    await this.repository.delete(guildId, giveawayId);
  }
}
