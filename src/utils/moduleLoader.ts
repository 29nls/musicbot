import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MODULE_EXTENSIONS = new Set(['.ts', '.js', '.mts', '.mjs']);
const IGNORED_SUFFIXES = ['.d.ts', '.test.ts', '.spec.ts'];

/**
 * File yang diawali `_` bukan modul yang didaftarkan (mis. `_shared.ts` berisi
 * helper untuk sekumpulan perintah). File test juga dilewati.
 */
export function isRegisterableModule(fileName: string): boolean {
  if (fileName.startsWith('_')) return false;
  if (IGNORED_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) return false;
  return MODULE_EXTENSIONS.has(path.extname(fileName));
}

/**
 * Daftar file modul di sebuah folder (rekursif), urut alfabetis.
 * Bekerja baik saat dev (file .ts lewat tsx) maupun produksi (file .js hasil build).
 */
export function listModuleFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true, recursive: true });

  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => isRegisterableModule(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/** Import dinamis dan ambil default export-nya (validasi bentuk dilakukan pemanggil). */
export async function importDefault(filePath: string): Promise<unknown> {
  const module = (await import(pathToFileURL(filePath).href)) as { default?: unknown };
  return module.default;
}
