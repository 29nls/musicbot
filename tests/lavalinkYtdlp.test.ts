import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga jalur audio `yt-dlp`.
 *
 * Kenapa penjaga ini perlu: sumber `ytdlp` di LavaSrc adalah satu-satunya jalur
 * yang terukur bisa memutar lagu YouTube dari mesin ini saat semua klien
 * youtube-plugin dijawab "This video requires login". Ia bergantung pada tiga
 * sambungan yang gampang putus tanpa ada yang gagal:
 *
 *   1. `plugins.lavasrc.sources.ytdlp: true` + `ytdlp.path` di application.yml.
 *   2. `YTDLP_PATH` diteruskan `tools/start-lavalink.mjs` dari environment/.env
 *      ke JVM — tanpa itu, mengisi .env tampak berhasil tapi tidak berpengaruh.
 *   3. Biner yt-dlp benar-benar ada di dalam image Docker yang dipakai (compose
 *      resmi maupun image CasaOS), karena image resmi Lavalink tidak memuatnya.
 *
 * Kalau salah satu putus, gejalanya kembali jadi satu baris "All clients failed"
 * di log — jauh dari penyebabnya. Yang TIDAK dijaga di sini: apakah biner
 * `yt-dlp` sendiri benar-benar bisa mengunduh audio; itu diukur
 * `tools/ytdlp-probe.mjs` dengan Lavalink sungguhan, bukan tes unit.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

/**
 * Ambil satu blok anak YAML: baris `name:` pada indentasi `indent` spasi,
 * sampai kunci berikutnya yang indentasinya sama atau lebih dangkal.
 *
 * Harus seketat ini: nama `sources:` dan `ytdlp:` muncul di lebih dari satu
 * konteks di application.yml, jadi assertion yang mencari di seluruh berkas
 * bisa tetap hijau walau blok yang benar sudah berubah.
 */
function blockAt(text: string, indent: number, name: string): string {
  const header = new RegExp(`^ {${indent}}${name}:\\r?\\n`, 'm').exec(text);
  if (!header || header.index === undefined) {
    throw new Error(`blok ${name}: tidak ditemukan pada indentasi ${indent}`);
  }

  const out: string[] = [];
  for (const line of text.slice(header.index + header[0].length).split('\n')) {
    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    const leading = /^ */.exec(line)?.[0].length ?? 0;
    if (leading <= indent) break; // kunci lain / akar sudah mulai
    out.push(line);
  }
  return out.join('\n');
}

describe('helper blok YAML', () => {
  it('melempar kalau kunci tidak ditemukan, bukan mengembalikan teks kosong', () => {
    expect(() => blockAt('a:\n  b: 1\n', 2, 'c')).toThrow();
  });

  it('berhenti di kunci berikutnya yang segaris atau lebih dangkal', () => {
    const text = ['root:', '  sub:', '    a: 1', '  lain:', '    b: 2'].join('\n');
    expect(blockAt(text, 2, 'sub')).toBe('    a: 1');
  });
});

describe('sumber ytdlp di lavalink/application.yml', () => {
  const config = read('lavalink/application.yml');
  const lavasrc = blockAt(config, 2, 'lavasrc');

  it('menyalakan sumber ytdlp — pengambil audio yang bisa memutar lagu yang ditolak youtube-plugin', () => {
    expect(blockAt(lavasrc, 4, 'sources')).toMatch(/^ {6}ytdlp: true$/m);
  });

  it('mengambil biner dari YTDLP_PATH (default yt-dlp), bukan jalur mesin', () => {
    // Jalur Windows/macOS yang ditulis langsung di sini akan ikut masuk ke
    // container Linux dan tidak ada artinya di sana.
    expect(blockAt(lavasrc, 4, 'ytdlp')).toMatch(/^ {6}path: "\$\{YTDLP_PATH:yt-dlp\}"$/m);
  });
});

describe('pass-through YTDLP_PATH ke JVM (tools/start-lavalink.mjs)', () => {
  const source = read('tools/start-lavalink.mjs');

  it('membaca YTDLP_PATH dari environment/.env dan memperlakukan kosong sebagai default', () => {
    expect(source).toMatch(/process\.env\.YTDLP_PATH \?\? dotEnv\.YTDLP_PATH/);
    // String kosong BUKAN nilai hilang bagi Spring: placeholder
    // `${YTDLP_PATH:yt-dlp}` akan resolve ke '' kalau env berisi kosong, jadi
    // fallback-nya harus dipasang di sini.
    expect(source).toMatch(/\|\| 'yt-dlp';/);
  });

  it('meneruskan YTDLP_PATH ke environment JVM', () => {
    expect(source).toMatch(/YTDLP_PATH: ytdlpPath,/);
  });
});

describe('pass-through YTDLP_PATH ke container', () => {
  const COMPOSE_FILES = ['docker-compose.yml', 'deploy/casaos/docker-compose.yml'];

  for (const file of COMPOSE_FILES) {
    it(`${file}: lavalink memakai yt-dlp dari PATH image`, () => {
      const compose = read(file);
      const lavalink = /^ {2}lavalink:\n((?:^(?! {2}\S)[^\n]*\n)*)/m.exec(compose);
      expect(lavalink).not.toBeNull();

      const block = lavalink?.[0] ?? '';
      expect(block).toMatch(/^ {6}YTDLP_PATH: yt-dlp$/m);
      // Sengaja TIDAK dari .env: di sana biasanya jalur host (Windows/macOS),
      // sedangkan container butuh `yt-dlp` dari PATH image.
      expect(block).not.toMatch(/YTDLP_PATH: \$\{/);
    });
  }

  it('Dockerfile CasaOS memasang yt-dlp di dalam image', () => {
    // Tanpa baris ini sumber ytdlp menyala tapi tidak punya biner, dan
    // gejalanya kembali ke "semua klien gagal" tanpa menyebut yt-dlp.
    expect(read('deploy/casaos/lavalink.Dockerfile')).toMatch(/^RUN apk add --no-cache yt-dlp$/m);
  });
});

describe('.env.example mendokumentasikan YTDLP_PATH', () => {
  it('memuat baris kosong yang bisa diisi beserta penjelasan PATH', () => {
    const example = read('.env.example');

    const line = /^YTDLP_PATH=\r?$/m.exec(example);
    expect(line).not.toBeNull();

    // Komentarnya harus menyebut kasus yang paling mudah salah: biner yang
    // terpasang tapi tidak masuk PATH.
    const context = example.slice(Math.max(0, (line?.index ?? 0) - 700), line?.index ?? 0);
    expect(context).toContain('yt-dlp');
  });
});
