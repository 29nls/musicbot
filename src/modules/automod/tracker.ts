import { SPAM_WINDOW_MS } from './types.js';

export interface AutomodTrackerOptions {
  windowMs?: number;
  /** Jam yang bisa diganti di tes. */
  now?: () => number;
  /** Batas jumlah user yang dilacak sekaligus (bersih-bersih otomatis). */
  maxEntries?: number;
}

interface TrackedUser {
  timestamps: number[];
  lastContent: string;
  duplicateStreak: number;
}

/**
 * State in-memory untuk rule yang butuh riwayat: anti-spam (jendela waktu) dan
 * anti-duplicate (pesan identik berturut-turut). Restart bot mengosongkan state
 * ini — konsekuensi yang wajar, sama seperti antrean musik.
 */
export class AutomodTracker {
  private readonly entries = new Map<string, TrackedUser>();
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: AutomodTrackerOptions = {}) {
    this.windowMs = options.windowMs ?? SPAM_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /** Catat pesan baru lalu kembalikan state terbaru user tersebut. */
  record(input: { guildId: string; userId: string; content: string }): {
    recentMessageCount: number;
    duplicateStreak: number;
  } {
    const now = this.now();
    const key = `${input.guildId}:${input.userId}`;

    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) this.prune(now);
      entry = { timestamps: [], lastContent: '', duplicateStreak: 0 };
      this.entries.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > now - this.windowMs);
    entry.timestamps.push(now);

    const content = input.content.trim().toLowerCase();
    if (content.length === 0) {
      // Pesan tanpa teks (mis. hanya attachment) tidak dihitung sebagai duplikat.
      entry.duplicateStreak = 0;
      entry.lastContent = '';
    } else if (content === entry.lastContent) {
      entry.duplicateStreak += 1;
    } else {
      entry.duplicateStreak = 1;
      entry.lastContent = content;
    }

    return {
      recentMessageCount: entry.timestamps.length,
      duplicateStreak: entry.duplicateStreak,
    };
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      const last = entry.timestamps[entry.timestamps.length - 1];
      if (last === undefined || last <= now - this.windowMs * 2) this.entries.delete(key);
    }
  }
}
