/**
 * Daftar node Lavalink dari environment (PRD §5.3, NFR §11).
 *
 * **Kenapa file ini ada.** NFR §11 menjanjikan "tambah node Lavalink tanpa
 * mengubah kode bot", tapi janji itu belum terpenuhi: `LAVALINK_HOST` dan
 * `LAVALINK_PORT` cuma punya satu pasangan, dan `MusicService` selalu membangun
 * persis satu node. Menambah node kedua berarti mengubah kode bot, lalu
 * membangun ulang, lalu deploy ulang. Janji yang tidak ditepati seperti ini
 * paling mudah dilanggar tanpa disadari, karena tidak ada yang gagal — bot
 * tetap jalan, hanya tidak bisa bertambah kapasitas seperti yang ditulis.
 *
 * Baru dengan `LAVALINK_NODES` yang daftar node masuk sebagai teks. Yang
 * dipisah ke sini adalah parsernya supaya aturannya bisa diuji tanpa Lavalink
 * dan tanpa network.
 *
 * **Bentuk input:** `host:port` dipisah koma, boleh tanpa port (dipakai port
 * bawaan). IPv6 wajib ditulis dengan kurung siku — `[::1]:2333` — karena
 * `::1` tanpa kurung tidak bisa dibedakan dari `host:port`.
 *
 * **Entri rusak dibuang, bukan menggagalkan startup.** Salah ketik satu node di
 * antara lima node lain tidak boleh membuat bot tidak mau menyala sama sekali:
 * empat node yang sehat tetap bisa menerima playback, dan entri yang dibuang
 * dikembalikan supaya bisa disebut apa adanya di log.
 */

/** Batas node. Di atas ini hampir pasti salah ketik, bukan cluster sungguhan. */
export const MAX_LAVALINK_NODES = 16;

/** Satu node Lavalink. */
export interface LavalinkNodeSpec {
  host: string;
  port: number;
}

/** Hasil parsing: node yang dipakai, plus entri yang dibuang. */
export interface LavalinkNodeList {
  nodes: LavalinkNodeSpec[];
  /** Entri yang tidak dipakai, apa adanya, supaya bisa disebut di log. */
  skipped: string[];
  /** true kalau daftar diambil dari `LAVALINK_HOST`/`LAVALINK_PORT`. */
  fromFallback: boolean;
}

/** Nama node untuk log dan dasbor: selalu `host:port`. */
export function lavalinkNodeName(spec: LavalinkNodeSpec): string {
  return `${spec.host}:${spec.port}`;
}

/**
 * Baca daftar node dari environment.
 *
 * `raw` kosong (atau tidak diisi) berarti pakai pasangan `fallback`, jadi
 * konfigurasi yang sudah ada di server mana pun tetap bekerja tanpa perubahan.
 * Kalau `raw` diisi, itu yang jadi sumber kebenaran sepenuhnya — operator yang
 * menulis `LAVALINK_NODES` jelas sedang pindah ke multi-node, dan
 * mencampurkannya dengan host bawaan hanya menghasilkan satu node yang tersesat.
 */
export function parseLavalinkNodes(
  raw: string | undefined,
  fallback: LavalinkNodeSpec,
  options: { maxNodes?: number } = {},
): LavalinkNodeList {
  const maxNodes = options.maxNodes ?? MAX_LAVALINK_NODES;
  const trimmed = raw?.trim() ?? '';

  if (trimmed === '') {
    return { nodes: [{ ...fallback }], skipped: [], fromFallback: true };
  }

  const nodes: LavalinkNodeSpec[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const entry of trimmed.split(',')) {
    const label = entry.trim();

    if (label === '') {
      skipped.push('(entri kosong)');
      continue;
    }

    const spec = parseNodeEntry(label, fallback.port);

    if (!spec) {
      skipped.push(label);
      continue;
    }

    const key = `${spec.host.toLowerCase()}:${spec.port}`;
    if (seen.has(key)) {
      skipped.push(`${label} (duplikat)`);
      continue;
    }

    if (nodes.length >= maxNodes) {
      skipped.push(`${label} (melebihi batas ${maxNodes} node)`);
      continue;
    }

    seen.add(key);
    nodes.push(spec);
  }

  return { nodes, skipped, fromFallback: false };
}

/**
 * Satu entri jadi spec node, atau null kalau tidak bisa dibaca.
 *
 * Menolak port di luar rentang, bukan diam-diam memotongnya: `lavalink:70000`
 * hampir pasti salah ketik, dan memotongnya diam-diam hanya membuat bot
 * terlihat hidup padahal tidak pernah tersambung.
 */
function parseNodeEntry(entry: string, defaultPort: number): LavalinkNodeSpec | null {
  // IPv6 wajib berkurung siku; tanpa itu `::1` tidak bisa dibedakan dari host:port.
  if (entry.startsWith('[')) {
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (!bracketed) return null;

    const host = (bracketed[1] ?? '').trim();
    const port = readPort(bracketed[2], defaultPort);
    return host && port ? { host, port } : null;
  }

  const separators = entry.split(':').length - 1;
  if (separators > 1) return null;

  if (separators === 0) {
    const host = entry.trim();
    return host ? { host, port: defaultPort } : null;
  }

  const split = entry.lastIndexOf(':');
  const host = entry.slice(0, split).trim();
  const port = readPort(entry.slice(split + 1), defaultPort);

  return host && port ? { host, port } : null;
}

function readPort(raw: string | undefined, defaultPort: number): number | null {
  const text = (raw ?? '').trim();
  if (text === '') return defaultPort;

  if (!/^\d+$/.test(text)) return null;

  const port = Number.parseInt(text, 10);
  return port >= 1 && port <= 65_535 ? port : null;
}

/** Status satu node untuk log dan laporan kesehatan. */
export interface LavalinkNodeStatus {
  name: string;
  connected: boolean;
  /** Player yang dilaporkan node itu lewat `/stats`; 0 kalau belum ada laporan. */
  players: number;
}

/** Ringkasan semua node Lavalink. */
export interface LavalinkNodeReport {
  /** Berapa node yang dikonfigurasi. */
  configured: number;
  /** Berapa yang benar-benar terhubung. */
  connected: number;
  nodes: LavalinkNodeStatus[];
}

/**
 * Ringkas daftar node; dipakai `MusicService` untuk log dan `/health`.
 *
 * Dihitung di sini, bukan di dalam service, supaya "berapa node yang hidup"
 * punya bentuk yang bisa diuji tanpa manager Shoukaku.
 */
export function summarizeLavalinkNodes(nodes: readonly LavalinkNodeStatus[]): LavalinkNodeReport {
  return {
    configured: nodes.length,
    connected: nodes.filter((node) => node.connected).length,
    // Disalin per item, bukan cuma array-nya: laporan ini dibaca dari log dan
    // endpoint kesehatan, jadi tidak boleh berubah sendiri karena pemanggil
    // masih memegang objek aslinya.
    nodes: nodes.map((node) => ({ ...node })),
  };
}