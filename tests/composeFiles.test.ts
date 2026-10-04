import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga berkas compose.
 *
 * Compose YAML tidak bisa diuji dengan modul YAML karena tidak ada parser YAML
 * di dependency tree proyek ini, dan menambahkan satu hanya untuk dua berkas
 * terasa berlebihan. Jadi penjaga di bawah membaca sumbernya secara langsung.
 *
 * Yang dijaga pertama adalah jebakan yang baru saja menggigit: **scalar polos yang
 * memuat `: ` (kolom + spasi)**. YAML membaca pola itu sebagai pemisah mapping,
 * jadi satu baris seperti
 *
 *     NAMA: ${VAR:?pesan - jalankan: node something}
 *
 * membuat **seluruh berkas** gagal dimuat dengan
 * `mapping values are not allowed in this context` — bukan hanya baris itu.
 * Gejalanya jauh dari baris penyebabnya, dan tidak ada container yang sempat
 * start, jadi penyebabnya baru terlihat dari pesan parser.
 *
 * Baris compose yang aman harus diapit tanda kutip: `NAMA: '${VAR:?...}'`.
 * Compose menginterpolasi apa adanya string hasil YAML, jadi tanda kutip hanya
 * dibaca YAML dan tidak mengubah apa pun bagi compose.
 */

const ROOT = new URL('../', import.meta.url);
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.dev.yml', 'deploy/casaos/docker-compose.yml'];

/**
 * Satu blok service: kunci di indentasi 2, lalu isinya sampai service
 * berikutnya — atau sampai akhir berkas untuk service terakhir.
 *
 * Anchor akhirnya `(?![\s\S])`, bukan `$`: dengan flag `m`, `$` cocok dengan
 * akhir baris mana pun, sehingga blok yang bersifat malas akan berhenti di
 * baris pertama dan isi service di bawahnya tidak pernah diperiksa.
 */
const SERVICE_BLOCK = /^ {2}([a-zA-Z0-9_-]+):\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/gm;

/** Satu entri daftar port: `- "127.0.0.1:2333:2333"` atau `- 6379:6379`. */
const PUBLISHED_PORT = /^\s+- ["']?([^"'\s]+)["']?\s*$/gm;

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, ROOT)), 'utf8');
}

/** Buang komentar di akhir baris, tanpa menyentuh `#` di dalam nilai ber-kutip. */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble && /\s/.test(line[index - 1] ?? ' ')) {
      return line.slice(0, index);
    }
  }

  return line;
}

/**
 * Nilai baris compose: bagian setelah `key:` pertama.
 *
 * Mengembalikan `null` kalau baris itu bukan pasangan kunci/nilai (daftar,
 * sambungan multi-baris, atau baris tanpa indentasi).
 */
function valueOf(line: string): { key: string; value: string } | null {
  const match = line.match(/^(\s*)([A-Za-z0-9_.$-]+):(?:\s+(.*))?$/);
  if (!match) return null;
  return { key: match[2] ?? '', value: (match[3] ?? '').trim() };
}

/** Apakah nilai dibungkus tanda kutip YAML? */
function isQuoted(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  );
}

describe('compose: jebakan YAML mapping values', () => {
  for (const file of COMPOSE_FILES) {
    it(`${file} bebas dari scalar polos yang memuat ': '`, () => {
      const offenders: string[] = [];

      read(file)
        .split(/\r?\n/)
        .forEach((raw, index) => {
          const line = stripComment(raw);
          const pair = valueOf(line);
          if (!pair || pair.value === '') return;

          // Nilai ber-kutip aman: YAML memperlakukannya sebagai string utuh.
          if (isQuoted(pair.value)) return;

          // `: ` di dalam nilai polos berarti YAML mengira ini mapping baru.
          if (pair.value.includes(': ')) {
            offenders.push(`baris ${index + 1}: ${raw.trim()}`);
          }
        });

      // Pesan sengaja menyebut cara memperbaikinya, bukan hanya lokasinya.
      expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it(`${file} tidak memakai TAB untuk indentasi`, () => {
      // Baris di dalam blok yang salah indentasi adalah penyebab umum
      // "mapping values are not allowed". Yang diperiksa di sini hanya baris
      // yang memakai TAB, karena YAML melarangnya sama sekali.
      const offenders = read(file)
        .split(/\r?\n/)
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => /^\s*\t/.test(line))
        .map(([number, line]) => `baris ${number}: ${line.trim()}`);

      expect(offenders).toEqual([]);
    });
  }

  it('penjaga benar-benar menangkap baris yang rusak', () => {
    // Kalau penjaga di atas rapuh, ia akan lolos baik untuk berkas rusak
    // maupun untuk yang benar — persis seperti yang terjadi sebelum penjaga ini ada.
    const rusak = [
      "      LAVALINK_SERVER_PASSWORD: ${LAVALINK_PASSWORD:?isi - jalankan: node x.mjs}",
      '      NAMA: nilai polos: ada',
    ];
    const healthy = [
      "      LAVALINK_SERVER_PASSWORD: '${LAVALINK_PASSWORD:?isi - jalankan: node x.mjs}'",
      '      NAMA: "nilai ber-kutip: aman"',
      '      URL: https://example.com:8080/path',
    ];

    const terperangkap = rusak.filter((line) => {
      const pair = valueOf(line);
      return pair !== null && pair.value !== '' && !isQuoted(pair.value) && pair.value.includes(': ');
    });

    expect(terperangkap).toHaveLength(2);
    for (const line of healthy) {
      const pair = valueOf(line);
      if (pair === null || pair.value === '' || isQuoted(pair.value)) continue;
      expect(pair.value.includes(': '), line).toBe(false);
    }
  });
});

describe('compose: invariants yang harus bertahan', () => {
  const casaos = read('deploy/casaos/docker-compose.yml');

  it('berkas CasaOS punya blok x-casaos yang lengkap', () => {
    for (const key of ['id', 'main', 'index', 'port_map', 'scheme', 'icon', 'title', 'category']) {
      expect(casaos, `x-casaos.${key} tidak ada`).toMatch(new RegExp(`^ {2}${key}:`, 'm'));
    }
  });

  it('port_map tetap sama dengan port yang benar-benar dipublish', () => {
    const mapPort = casaos.match(/^ {2}port_map:\s*"?(\d+)"?\s*$/m)?.[1];
    const published = casaos.match(/CASAOS_PORT:-(\d+)}:(\d+)/);

    expect(mapPort).toBeDefined();
    expect(published).not.toBeNull();

    // Kalau ketiganya melenceng, CasaOS membuka port yang salah dan satu-satunya
    // gejalanya adalah "apinya tidak merespons".
    expect(mapPort).toBe(published?.[1]);
    expect(mapPort).toBe(published?.[2]);
  });

  it('tidak ada service infrastruktur yang membocorkan port ke luar loopback', () => {
    // Overlay `dev` memang mem-bind ke 127.0.0.1 supaya bot yang jalan di host
    // bisa menjangkau Lavalink — itu sah dan disengaja. Yang dilarang adalah
    // port yang diikat ke semua antarmuka (0.0.0.0 atau ::), karena itu membuat
    // mesin audio dan cache state bisa dijangkau dari jaringan rumah tanpa
    // password tambahan.
    //
    // Satu-satunya service yang boleh mempublish ke luar loopback adalah `bot`,
    // dan hanya lewat port health yang memang untuk monitoring.
    const PUBLISHABLE = new Set(['bot']);

    for (const file of COMPOSE_FILES) {
      const source = read(file);

      for (const match of source.matchAll(SERVICE_BLOCK)) {
        const service = match[1] ?? '';
        const block = match[2] ?? '';

        const published = [...block.matchAll(PUBLISHED_PORT)]
          .map((line) => line[1] ?? '')
          .filter((mapping) => /:\d/.test(mapping));

        if (published.length === 0) continue;

        for (const mapping of published) {
          const host = mapping.split(':')[0] ?? '';

          // Loopback (127.0.0.1, localhost) selalu aman.
          const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
          // Tanpa host = hanya expose ke jaringan compose, bukan ke host.
          const internal = host === '';

          if (loopback || internal) continue;

          if (service === 'bot' && PUBLISHABLE.has(service)) continue;

          expect(
            PUBLISHABLE.has(service) || mapping.startsWith('127.0.0.1:'),
            `${file}: service ${service} mempublish ${mapping} ke luar loopback`,
          ).toBe(true);
        }
      }
    }
  });

  it('DATABASE_URL tidak pernah ditimpa di compose mana pun', () => {
    // Database produksi ada di luar stack. Compose yang menulis
    // `DATABASE_URL: postgres://...` membuat bot diam-diam bicara ke database
    // yang berbeda dari yang migrasinya baru diterapkan — dan tidak ada yang
    // gagal saat start.
    for (const file of COMPOSE_FILES) {
      expect(read(file), `${file} menimpa DATABASE_URL`).not.toMatch(
        /^\s*DATABASE_URL:\s*\S+/m,
      );
    }
  });
});