import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

import { processInstanceId } from '../../services/instanceId.js';
import { getLogger } from '../../services/logger.js';
import { MAX_ATTACHMENT_BYTES } from './limits.js';

/**
 * File audio yang diunggah member disimpan sementara di folder yang juga
 * dibaca Lavalink (sumber `local`), lalu dihapus setelah tidak dipakai.
 *
 * Lavalink membaca `identifier` sebagai path apa adanya, jadi path yang dikirim
 * ke sana harus path di **filesystem Lavalink**, bukan path bot. Di Docker
 * keduanya beda mount point, karena itu `lavalinkDir` bisa diisi terpisah.
 */

/** Umur file yang tidak pernah disentuh lagi (ms). */
export const ATTACHMENT_TTL_MS = 24 * 60 * 60_000;

/** Jeda sapuan file kedaluwarsa. */
const SWEEP_INTERVAL_MS = 60 * 60_000;

/** Batas judul yang ditampilkan di embed. */
const MAX_TITLE_LENGTH = 100;

export type AttachmentSaveFailure = 'too-large' | 'failed';

export interface AttachmentSource {
  url: string;
  name: string;
  /** Ukuran dari Discord; 0 berarti tidak diketahui. */
  size: number;
}

export interface StoredAttachment {
  /** Path yang dipakai bot (untuk menghapus file). */
  path: string;
  /** Path yang dikirim ke Lavalink sebagai identifier. */
  lavalinkPath: string;
}

export type AttachmentSaveResult =
  | { ok: true; stored: StoredAttachment }
  | { ok: false; reason: AttachmentSaveFailure };

export interface AttachmentStoreOptions {
  /** Folder tempat bot menulis. */
  dir: string;
  /** Folder yang sama dilihat dari Lavalink; default sama dengan `dir`. */
  lavalinkDir?: string;
  maxBytes?: number;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Judul lagu dari nama berkas, tanpa ekstensi.
 *
 * Nama file di disk adalah UUID, jadi judul dari Lavalink tidak berguna dan
 * harus diganti dengan nama asli unggahan.
 */
export function attachmentTitle(name: string, fallback: string): string {
  const base = name.replace(/\.[^./\\]+$/, '').replace(/[\r\n]+/g, ' ').trim();
  return base.slice(0, MAX_TITLE_LENGTH).trim() || fallback;
}

/** Ekstensi yang aman dipakai di nama file; string kosong kalau tidak ada. */
function safeExtension(name: string): string {
  const match = /\.[a-z0-9]{1,5}$/i.exec(name);
  return match ? match[0].toLowerCase() : '';
}

export class AttachmentStore {
  private readonly dir: string;
  private readonly lavalinkDir: string;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** encoded track → path file bot. */
  private readonly files = new Map<string, string>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: AttachmentStoreOptions) {
    this.dir = resolve(options.dir);
    this.lavalinkDir = options.lavalinkDir ?? this.dir;
    this.maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
    this.ttlMs = options.ttlMs ?? ATTACHMENT_TTL_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /**
   * Unduh lampiran ke folder sementara.
   *
   * Ukuran diperiksa dua kali: dari metadata Discord (supaya file besar tidak
   * diunduh sama sekali) dan dari hasil unduhan (metadata bisa saja kosong).
   */
  async save(source: AttachmentSource): Promise<AttachmentSaveResult> {
    if (source.size > this.maxBytes) return { ok: false, reason: 'too-large' };

    let data: Buffer;
    try {
      const response = await this.fetchImpl(source.url);
      if (!response.ok) return { ok: false, reason: 'failed' };

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > this.maxBytes) return { ok: false, reason: 'too-large' };
      data = buffer;
    } catch (error) {
      getLogger().warn({ err: error }, 'Lampiran audio gagal diunduh');
      return { ok: false, reason: 'failed' };
    }

    const instanceDir = processInstanceId();
    const filename = `${randomUUID()}${safeExtension(source.name)}`;
    const path = resolve(this.dir, instanceDir, filename);

    try {
      await mkdir(resolve(this.dir, instanceDir), { recursive: true });
      // 0644 supaya proses Lavalink (user berbeda di container) bisa membaca.
      await writeFile(path, data, { mode: 0o644 });
    } catch (error) {
      getLogger().warn({ err: error }, 'Lampiran audio gagal disimpan');
      return { ok: false, reason: 'failed' };
    }

    return {
      ok: true,
      stored: {
        path,
        lavalinkPath: posix.join(this.lavalinkDir, instanceDir, filename),
      },
    };
  }

  /** Ingat file milik sebuah track, supaya bisa dihapus saat track dilepas. */
  register(encoded: string, path: string): void {
    this.files.set(encoded, path);
  }

  /**
   * Segarkan umur file yang sedang diputar.
   *
   * Sapuan menghapus file yang tidak disentuh selama TTL. Track yang diputar
   * ulang oleh mode loop memanggil ini lagi, jadi file yang masih dipakai tidak
   * pernah ikut terhapus walaupun umurnya sudah lama.
   */
  async touch(encoded: string): Promise<void> {
    const path = this.files.get(encoded);
    if (!path) return;

    const now = new Date(this.now());
    await utimes(path, now, now).catch(() => undefined);
  }

  /** Hapus file satu atau beberapa track yang sudah tidak akan diputar. */
  async release(encodeds: Iterable<string>): Promise<void> {
    const paths: string[] = [];

    for (const encoded of encodeds) {
      const path = this.files.get(encoded);
      if (!path) continue;
      this.files.delete(encoded);
      paths.push(path);
    }

    await Promise.all(paths.map((path) => this.unlink(path)));
  }

  /** Hapus file yang belum sempat terdaftar (mis. resolve gagal). */
  async releasePath(path: string): Promise<void> {
    for (const [encoded, registered] of this.files) {
      if (registered === path) this.files.delete(encoded);
    }
    await this.unlink(path);
  }

  /**
   * Buang file yang lebih tua dari TTL.
   *
   * Semua subfolder ikut disapu: file milik proses yang mati mendadak
   * (crash) tidak pernah didaftarkan di proses baru, jadi hanya umur file yang
   * bisa dipakai sebagai penanda.
   */
  async sweep(now = this.now()): Promise<number> {
    let removed = 0;

    try {
      const entries = await readdir(this.dir, { recursive: true, withFileTypes: true });
      const swept = new Set<string>();

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const path = resolve(entry.parentPath, entry.name);
        const stats = await stat(path).catch(() => null);
        if (!stats || now - stats.mtimeMs <= this.ttlMs) continue;

        if (await this.unlink(path)) {
          removed += 1;
          swept.add(path);
        }
      }

      for (const [encoded, path] of this.files) {
        if (swept.has(path)) this.files.delete(encoded);
      }
    } catch (error) {
      // Folder belum ada (belum ada unggahan) bukan kegagalan.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        getLogger().warn({ err: error }, 'Sapuan lampiran audio gagal');
      }
    }

    return removed;
  }

  /** Jalankan sapuan berkala; aman dipanggil sekali saja. */
  startSweeper(): void {
    if (this.sweepTimer) return;

    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  stopSweeper(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private async unlink(path: string): Promise<boolean> {
    try {
      await unlink(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        getLogger().warn({ err: error, path }, 'Gagal menghapus file lampiran');
      }
      return false;
    }
  }
}

