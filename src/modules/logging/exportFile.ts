import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '../../services/logger.js';
import type { LogExport } from './export.js';

/** Folder arsip lokal; bisa diganti lewat `LOG_EXPORT_DIR`. */
const DEFAULT_DIR = path.resolve('data', 'exports');

/**
 * Simpan file ekspor ke disk untuk arsip jangka panjang (opsional).
 *
 * Best-effort: kalau folder tidak bisa dibuat atau tidak writable, hasil tetap
 * dikirim sebagai lampiran Discord dan pemanggil hanya diberi catatan null.
 */
export async function saveLogExport(
  file: LogExport,
  dir = process.env.LOG_EXPORT_DIR ?? DEFAULT_DIR,
): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, file.filename);
    await writeFile(target, file.content, 'utf8');
    return target;
  } catch (error) {
    getLogger().warn(
      { err: error, dir },
      'File ekspor tidak bisa ditulis di disk — lampiran tetap dikirim',
    );
    return null;
  }
}
