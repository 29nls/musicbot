/**
 * Bandingkan plugin yang benar-benar dimuat node Lavalink dengan yang diminta
 * `lavalink/application.yml`.
 *
 * **Kenapa file ini ada.** Satu putaran diagnosis terbuang karena log Lavalink
 * dibaca dari proses yang sudah lama jalan: config di repo sudah meminta plugin
 * 1.18.2, sementara proses yang hidup masih memuat 1.18.1, jadi semua angka di
 * log itu berbicara tentang config yang sudah tidak ada lagi. Datanya tidak
 * salah — hanya bukan tentang repo. Peringatan ini menutup celah itu: begitu
 * node tersambung, bot membandingkan versi plugin yang dilaporkan node
 * (`GET /v4/info`, field `plugins`) dengan versi yang tertulis di config, lalu
 * menyebut selisihnya apa adanya.
 *
 * **Kenapa dibandingkan, bukan sekadar dilaporkan.** Angka tanpa pembanding
 * tidak memberi tahu apa-apa: node yang memuat 1.18.1 terlihat sama sehatnya
 * dengan node yang memuat 1.18.2. Yang membuatnya berguna adalah pasangan
 * "diminta vs dimuat".
 *
 * **Batas yang jujur.** Daftar *klien* di dalam plugin tidak bisa dibaca dari
 * node yang jalan. Rute yang diekspos plugin hanya `/youtube`,
 * `/youtube/stream/{videoId}`, dan `/youtube/oauth/{refreshToken}`; tidak ada
 * yang mengembalikan konfigurasi klien. Parameter `withClient` juga tidak bisa
 * dipakai menebaknya: nama yang tidak ada di daftar dan nama yang ada tapi
 * kebetulan tidak menemukan format sama-sama berakhir `400 Could not find
 * formats`. Jadi pemeriksaan di sini berlaku untuk versi plugin — dan itu sudah
 * cukup untuk menangkap kasus yang benar-benar terjadi — sedangkan daftar klien
 * diverifikasi lewat `node tools/yts-probe.mjs`, yang mencetak `dipakai=`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Satu plugin beserta versinya. */
export interface LavalinkPluginRef {
  /** Nama artifact, seperti yang dilaporkan `/v4/info` (mis. `youtube-plugin`). */
  name: string;
  version: string;
}

/**
 * Hasil membaca harapan dari config.
 *
 * Config yang tidak terbaca **bukan** kegagalan startup: bot harus tetap jalan
 * walau `application.yml` tidak ada — image Docker memang tidak memuat folder
 * `lavalink/` (lihat `.dockerignore`), jadi di sana pemeriksaan ini hanya
 * dilewati. Karena itu bentuknya hasil, bukan pengecualian.
 */
export type LavalinkPluginExpectations =
  | { kind: 'ok'; plugins: LavalinkPluginRef[] }
  | { kind: 'unknown'; reason: string };

/** Satu selisih antara yang diminta config dan yang dimuat node. */
export interface LavalinkPluginMismatch {
  name: string;
  expected: string;
  /** Versi yang dilaporkan node; `undefined` = node tidak memuat plugin ini. */
  actual: string | undefined;
}

/** Hasil pemeriksaan, siap dipakai untuk log. */
export interface LavalinkPluginCheck {
  mismatches: LavalinkPluginMismatch[];
  /** Kalimat peringatan; `undefined` kalau tidak ada selisih. */
  warning: string | undefined;
}

/** Lokasi config relatif akar repo; dipakai saat bot dijalankan dari akar repo. */
export const LAVALINK_CONFIG_PATH = path.join('lavalink', 'application.yml');

/** Satu baris `- dependency: "..."` di bawah `lavalink: plugins:`. */
const DEPENDENCY_LINE = /^\s*-\s*dependency:\s*"?([^"\s]+)"?\s*$/;

/**
 * Baca daftar plugin yang diminta dari isi `application.yml`.
 *
 * Sengaja tidak memakai parser YAML: satu-satunya yang dibutuhkan adalah daftar
 * `dependency:` di blok `lavalink.plugins`, dan menambah dependensi baru untuk
 * itu tidak sebanding. Kalau bentuk berkasnya berubah, hasilnya `unknown`
 * dengan alasan yang bisa dibaca — bukan daftar kosong yang diam-diam membuat
 * pemeriksaan selalu lolos.
 */
export function readExpectedPlugins(yamlText: string): LavalinkPluginExpectations {
  const lines = yamlText.split(/\r?\n/);

  const lavalinkAt = lines.findIndex((line) => /^lavalink:\s*$/.test(line));
  if (lavalinkAt === -1) {
    return { kind: 'unknown', reason: 'tidak ada blok "lavalink:" di config' };
  }

  // Blok `lavalink:` berakhir di baris pertama berikutnya yang kembali ke kolom 0.
  const blockEnd = lines.findIndex((line, index) => index > lavalinkAt && /^\S/.test(line));
  const end = blockEnd === -1 ? lines.length : blockEnd;

  const pluginsAt = lines.findIndex(
    (line, index) => index > lavalinkAt && index < end && /^ {2}plugins:\s*$/.test(line),
  );
  if (pluginsAt === -1) {
    return { kind: 'unknown', reason: 'tidak ada daftar "lavalink.plugins" di config' };
  }

  const plugins: LavalinkPluginRef[] = [];
  for (let i = pluginsAt + 1; i < end; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || /^\s*#/.test(line)) continue;

    // Baris dengan indentasi dua spasi menandai kunci berikutnya (mis.
    // `  server:`), jadi daftar plugin berakhir di situ.
    if (/^ {2}\S/.test(line)) break;

    const match = DEPENDENCY_LINE.exec(line);
    if (!match) continue;

    const ref = parseDependency(match[1] ?? '');
    if (ref) plugins.push(ref);
  }

  if (plugins.length === 0) {
    return { kind: 'unknown', reason: 'daftar "lavalink.plugins" tidak berisi dependency yang bisa dibaca' };
  }
  return { kind: 'ok', plugins };
}

/**
 * `group:artifact:version` (atau `artifact:version`) jadi nama dan versi.
 *
 * Nama yang dicocokkan nanti adalah **artifact**-nya, karena itulah yang
 * dilaporkan `/v4/info` sebagai `youtube-plugin` / `lavasrc-plugin`.
 */
function parseDependency(value: string): LavalinkPluginRef | null {
  const parts = value.split(':').map((part) => part.trim());
  if (parts.length === 3) {
    return parts[1] && parts[2] ? { name: parts[1], version: parts[2] } : null;
  }
  if (parts.length === 2) {
    return parts[0] && parts[1] ? { name: parts[0], version: parts[1] } : null;
  }
  return null;
}

/**
 * Bandingkan harapan config dengan laporan node.
 *
 * Versi yang berbeda dan plugin yang tidak dimuat sama-sama dianggap selisih:
 * yang pertama biasanya berarti proses lama masih hidup, yang kedua biasanya
 * berarti plugin gagal diunduh. Dua-duanya membuat diagnosa dari node itu
 * menyesatkan, jadi dua-duanya perlu disebut.
 */
export function checkLavalinkPlugins(
  expected: readonly LavalinkPluginRef[],
  reported: readonly LavalinkPluginRef[],
): LavalinkPluginCheck {
  const byName = new Map(reported.map((plugin) => [plugin.name.toLowerCase(), plugin]));
  const mismatches: LavalinkPluginMismatch[] = [];

  for (const plugin of expected) {
    const actual = byName.get(plugin.name.toLowerCase());
    if (!actual || actual.version !== plugin.version) {
      mismatches.push({ name: plugin.name, expected: plugin.version, actual: actual?.version });
    }
  }

  if (mismatches.length === 0) return { mismatches, warning: undefined };

  const detail = mismatches
    .map((item) => `${item.name}: diminta ${item.expected}, dimuat ${item.actual ?? 'tidak ada'}`)
    .join('; ');

  return {
    mismatches,
    warning:
      `Plugin Lavalink yang dimuat node tidak cocok dengan application.yml (${detail}). ` +
      'Kemungkinan besar Lavalink yang tersambung masih proses lama yang belum dimuat ulang setelah ' +
      'config diubah, jadi log dan angka darinya bukan tentang config di repo. Restart Lavalink ' +
      '(`npm run infra:lavalink`, atau `docker compose restart lavalink`), lalu jalankan ' +
      '`node tools/yts-probe.mjs` — daftar klien tidak bisa dibaca dari node, dan keluaran ' +
      '`dipakai=` di alat itu yang bisa dipercaya.',
  };
}

/**
 * Baca harapan dari berkas config.
 *
 * Tidak pernah melempar: berkas yang tidak ada (image Docker) atau tidak terbaca
 * membuat pemeriksaan dilewati, dan itu memang perilaku yang diinginkan.
 */
export async function loadExpectedPlugins(
  options: { path?: string; cwd?: string } = {},
): Promise<LavalinkPluginExpectations> {
  const target = options.path ?? path.resolve(options.cwd ?? process.cwd(), LAVALINK_CONFIG_PATH);

  try {
    return readExpectedPlugins(await readFile(target, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: 'unknown', reason: `tidak bisa membaca ${target}: ${reason}` };
  }
}
