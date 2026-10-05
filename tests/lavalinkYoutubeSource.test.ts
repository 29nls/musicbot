import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga konfigurasi sumber YouTube Lavalink.
 *
 * Kenapa penjaga ini perlu: `plugins.youtube.clients` dibaca plugin dengan cara
 * yang diam-diam menerima input buruk. Nama yang tidak dikenal TIDAK
 * digagalkan -- ia dilewati, lalu diisi klien bawaan. Akibatnya config bisa
 * terlihat punya empat klient sementara yang benar-benar dipakai hanya tiga,
 * dan tidak ada apa pun di log yang memperingatkan. Nama `MUSIC` dan
 * `WEB_REMIX` sudah terbukti behaving begitu di lapangan: keduanya hilang
 * tanpa jejak dari daftar "initialised with clients:".
 *
 * Jadi daftar di bawah bukan sekadar daftar yang saat ini benar; daftar itu
 * perluDijaga supaya tidak ada yang salah nama lagi.
 *
 * Cara verifikasi: `node tools/yts-probe.mjs` mencetak daftar klien yang
 * benar-benar terpakai pada bagian "dipakai=...". Kalau penjaga ini gagal,
 * jalankan probe itu dan cocokkan.
 */

/**
 * Nama klien yang diterima plugin SEBAGAI nilai konfigurasi.
 *
 * Hanya nama yang benar-benar dipakai plugin tanpa lalu diabaikan. Jangan
 * menaruh sebuah nama hanya karena muncul di README upstream: `MUSIC` ada
 * di sana, tapi tidak masuk daftar ini. Buktinya di baris
 * "YouTube source initialised with clients: ..." pada log Lavalink.
 */
const KNOWN_CLIENTS = new Set([
  'ANDROID',
  'ANDROID_MUSIC',
  'ANDROID_VR',
  'IOS',
  'MWEB',
  'TV',
  'TVHTML5',
  'TVHTML5_SIMPLY',
  'WEB',
  'WEBEMBEDDED',
  'WEB_CREATOR',
]);

/**
 * Nama yang TIDAK diterima sebagai nilai konfigurasi, meski kelihatan wajar.
 * `MUSIC` masih ada di tabel README upstream sebagai nama klien, tapi parser
 * konfigurasi youtube-source tidak mengenali itu dan menggantinya diam-diam.
 * `WEB_REMIX` hanya nama internal yang dipakai di dalam plugin.
 */
const REJECTED_CLIENTS = new Map([
  ['MUSIC', 'diabaikan plugin, diganti klien bawaan tanpa peringatan'],
  ['WEB_REMIX', 'nama internal plugin, bukan nama konfigurasi'],
]);

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

/**
 * Baca daftar `lavalink.server.sources` sebagai peta nama -> nyala/mati.
 *
 * Harus dibatasi ke blok itu. Nama `youtube:` muncul lebih dari sekali di
 * berkas yang sama, jadi assertion yang cuma mencari `youtube: false` di mana
 * saja akan tetap hijau walau yangSources.bawaan sudah dihidupkan.
 */
function lavalinkSources(config: string): Record<string, boolean> {
  const server = /^ {2}server:\n((?:^(?! {2}\S)[^\n]*\n)*)/m.exec(config);
  if (!server || !server[1]) throw new Error('lavalink.server: tidak ditemukan');

  const sources = /^[ ]{4}sources:\n((?:^[ ]{6}\S.*\n)+)/m.exec(server[1]);
  if (!sources || !sources[1]) throw new Error('lavalink.server.sources: tidak ditemukan');

  const out: Record<string, boolean> = {};
  for (const line of sources[1].split('\n')) {
    const entry = /^ {6}([a-z]+):\s*(true|false)\b/.exec(line);
    if (!entry) continue;
    const name = entry[1];
    const value = entry[2];
    if (name === undefined || value === undefined) continue;
    if (name in out) throw new Error(`sumber dobel: ${name}`);
    out[name] = value === 'true';
  }
  return out;
}

/**
 * Ambil daftar klien YouTube dari application.yml.
 *
 * Batasannya penting: blok yang diambil harus persis bagian `clients:` di dalam
 * `plugins.youtube`, bukan seluruh berkas -- kalau tidak, nama klient dari
 * sumber lain ikut terbaca dan penjaganya jadi tidak bergigi.
 */
function youtubeClients(config: string): string[] {
  const section = /^plugins:\n(?:^[ \t].*\n|^\s*$)*/m.exec(config);
  if (!section) throw new Error('blok plugins: tidak ditemukan');
  const block = section[0];

  const list = /^[ \t]+clients:\n((?:^[ \t]+-[ \t]*[A-Za-z_0-9]+\n)+)/m.exec(block);
  if (!list || !list[1]) throw new Error('plugins.youtube.clients: tidak ditemukan');

  return [...list[1].matchAll(/[ \t]+-[ \t]*([A-Za-z_0-9]+)/g)].map((m) => m[1] ?? '');
}

describe('konfigurasi sumber YouTube Lavalink', () => {
  const config = read('lavalink/application.yml');

  it('memuat daftar klien', () => {
    expect(youtubeClients(config).length).toBeGreaterThan(0);
  });

  it('tidak punya nama yang sekaligus dikenal dan ditolak', () => {
    // Dua daftar itu boleh tumpang tindih hanya kalau isinya konsisten.
    // Kalau sebuah nama masuk ke keduanya, minimal salah satu salah, dan
    // penjaga lain jadi tidak bisa dipercaya -- jadi tolak lebih dulu di sini.
    const overlap = [...REJECTED_CLIENTS.keys()].filter((name) => KNOWN_CLIENTS.has(name));
    expect(overlap).toEqual([]);
  });

  it('tidak mengklaim MUSIC sebagai nama konfigurasi yang sah', () => {
    // Pengukuran: config memuat MUSIC, plugin menginisialisasi klien lain.
    expect(KNOWN_CLIENTS.has('MUSIC')).toBe(false);
  });

  it('tidak memuat nama klien yang diabaikan diam-diam', () => {
    const rejected = youtubeClients(config).filter((name) => REJECTED_CLIENTS.has(name));
    expect(rejected).toEqual([]);
  });

  it('semua nama klien dikenal plugin', () => {
    const unknown = youtubeClients(config).filter((name) => !KNOWN_CLIENTS.has(name));
    expect(unknown).toEqual([]);
  });

  it('mencoba ANDROID_VR lebih dulu', () => {
    // Terukur: ini satu-satunya klien yang benar-benar bisa mengirim audio
    // dari mesin tempat pengukuran dilakukan.
    expect(youtubeClients(config)[0]).toBe('ANDROID_VR');
  });

  it('mematikan OAuth secara bawaan supaya tidak ada yang berubah tanpa diminta', () => {
    expect(config).toMatch(/enabled:\s*\$\{YOUTUBE_OAUTH_ENABLED:false\}/);
  });

  it('membaca refresh token dari environment, bukan menyalinnya ke dalam berkas', () => {
    expect(config).toMatch(/refreshToken:\s*"\$\{YOUTUBE_REFRESH_TOKEN:\}"/);
  });

  it('mematikan sumber YouTube bawaan Lavalink yang bentrok dengan plugin', () => {
    // Kalau ini true, dua sumber YouTube berebut memperebutkan lagu yang sama.
    expect(lavalinkSources(config).youtube).toBe(false);
  });

  it('memakai youtube-plugin versi terbaru yang diterbitkan', () => {
    // 1.18.2 adalah rilis terakhir di maven.lavalink.dev (diperiksa 5 Okt 2026).
    // Lavalink sendiri memberi peringatan saat menemukan versi lebih baru.
    expect(config).toMatch(/dev\.lavalink\.youtube:youtube-plugin:1\.18\.2/);
  });
});

describe('pass-through OAuth ke container Lavalink', () => {
  const COMPOSE_FILES = ['docker-compose.yml', 'deploy/casaos/docker-compose.yml'];

  for (const file of COMPOSE_FILES) {
    it(`${file} meneruskan kedua variabel OAuth`, () => {
      const compose = read(file);
      // `\s\S` hanya memakan satu karakter tiap iterasi, sedangkan `^` hanya
      // cocok di awal baris -- blok ini jadi hanya pernah dapat satu karakter isi
      // service, dan penjaganya tidak bergigi. Konsumsi satu baris penuh.
      const lavalink = /^ {2}lavalink:\n((?:^(?! {2}\S)[^\n]*\n)*)/m.exec(compose);
      expect(lavalink).not.toBeNull();

      const block = lavalink?.[0] ?? '';
      expect(block).toMatch(/YOUTUBE_OAUTH_ENABLED:\s*\$\{YOUTUBE_OAUTH_ENABLED:-false\}/);
      expect(block).toMatch(/YOUTUBE_REFRESH_TOKEN:\s*\$\{YOUTUBE_REFRESH_TOKEN:-\}/);
    });

    it(`${file} tidak memaksa OAuth menyala`, () => {
      // Kalau defaultnya true, siapa pun yang tidak sengaja menyalakannya akan
      // ikut menjalankan alur OAuth.
      const compose = read(file);
      expect(compose).not.toMatch(/YOUTUBE_OAUTH_ENABLED:\s*\$\{YOUTUBE_OAUTH_ENABLED:-true\}/);
    });
  }
});
