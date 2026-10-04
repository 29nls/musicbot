import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga urutan[startup `src/index.ts`].
 *
 * Berkas ini tidak bisa diuji dengan cara biasa: ia menjalankan `main()` begitu
 * diimpor, dan `main()` membangun koneksi database, membuka endpoint HTTP, lalu
 * memanggil `client.login()`. Menjalankannya di dalam tes berarti membuka
 * soket asli, dan menutupnya lagi butuh waktu nyata.
 *
 * Yang dijaga di sini bukan perilakunya, tapi **urutan** — dan urutan itulah yang
 * jenis bug-nya diam. Bot bisa start, terlihat sehat, dan log tidak pernah
 * menunjukkan kesalahan — lalu ternyata tidak pernah memakai Redis sama sekali
 * karena store dibangun belakangan. Tidak ada yang gagal; konsekuensinya baru
 * terlihat saat sharding dipakai.
 *
 * Setiap penjaga di bawah memanggil `main()` atau `registerProcessHandlers()`,
 * jadi tidak ada satu pun yang bisa hijau tanpa dieksekusi.
 */

const source = readFileSync(
  fileURLToPath(new URL('../src/index.ts', import.meta.url)),
  'utf8',
);

/** Posisi satu token; -1 kalau tidak ada. */
function at(token: string): number {
  return source.indexOf(token);
}

/** Potongan dari satu token ke token berikutnya. */
function between(start: string, end: string): string {
  const from = at(start);
  const to = at(end);
  expect(from, `token "${start}" tidak ada`).toBeGreaterThanOrEqual(0);
  expect(to, `token "${end}" tidak ada`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('urutan startup: store bersama dibangun lebih dulu', () => {
  it('createKeyValueStore berjalan sebelum setKeyValueStore', () => {
    // Store harus ada sebelum apa pun yang membacanya. Urutan terbalik tidak
    // melempar di mana pun: modul tetap dapat store memori bawaan dan bot
    // tetap hidup, hanya tidak pernah memakai Redis.
    expect(at('createKeyValueStore()')).toBeGreaterThan(-1);
    expect(at('createKeyValueStore()')).toBeLessThan(at('setKeyValueStore(keyValueStore)'));
  });

  it('store baru dipakai cooldown setelah store utama dipasang', () => {
    expect(at('setKeyValueStore(keyValueStore)')).toBeLessThan(at('setCooldownStore(keyValueStore.store)'));
  });

  it('BotClient dibangun setelah store siap', () => {
    expect(at('setCooldownStore(keyValueStore.store)')).toBeLessThan(at('new BotClient()'));
  });

  it('initMusic berjalan setelah client ada', () => {
    // shoukaku memasang listener clientReady saat initMusic dipanggil, dan
    // listener itu hanya terpasang sekali.
    expect(at('new BotClient()')).toBeLessThan(at('initMusic(client)'));
  });

  it('initMusic berjalan setelah perintah/event dimuat tapi sebelum login', () => {
    // shoukaku memasang listener `clientReady` saat initMusic dipanggil, dan
    // listener itu hanya boleh terpasang sekali. Urutannya: muat perintah dan
    // event dulu, baru pasang listener musik, baru login — kalau dibalik,
    // node Lavalink tidak pernah didaftarkan.
    expect(at('loadCommands(client.commands)')).toBeLessThan(at('initMusic(client)'));
    expect(at('loadEvents(client)')).toBeLessThan(at('initMusic(client)'));
    expect(at('initMusic(client)')).toBeLessThan(at('client.login('));
  });
});

describe('urutan startup: gerbang dan metering', () => {
  it('assertShardingReady menolak start lebih dulu daripada apa pun', () => {
    // Sharding tanpa store bersama merusak state diam-diam: rate limit, antrean,
    // dan lease player saling menimpa. Menolak start lebih jujur daripada
    // menjalankan bot yang nanti melapor "antrean kosong" tanpa penjelasan.
    expect(at('assertShardingReady(')).toBeGreaterThan(-1);
    expect(at('assertShardingReady(')).toBeLessThan(at('connectDatabase()'));
    expect(at('assertShardingReady(')).toBeLessThan(at('client.login('));
  });

  it('initMetrics berjalan sebelum health server yang memakainya', () => {
    expect(at('initMetrics(startedAt)')).toBeLessThan(at('startHealthServer('));
  });

  it('health server naik sebelum login, supaya proses terlihat hidup lebih awal', () => {
    // Endpoint harus menjawab "proses hidup, gateway belum siap" selama
    // handshake, bukan baru setelah bot selesai masuk.
    expect(at('startHealthServer(')).toBeLessThan(at('client.login('));
  });

  it('metrik lintas shard membaca store lewat getter, bukan nilai yang ditangkap', () => {
    // Menangkap store di sini menulis laporan ke store memori lokal yang tidak
    // pernah dibaca shard lain — bot terlihat punya metrik lintas shard padahal
    // tidak.
    expect(source).toContain('store: () => getKeyValueStore()');
    expect(source).not.toContain('store: getKeyValueStore()');
  });

  it('lease retensi juga membaca store lewat getter', () => {
    expect(source).toContain('() => getKeyValueStore(),');
    expect(source).toContain("'retention',");
  });

  it('endpoint metrik menghitung ulang laporan shard saat scrape', () => {
    expect(source).toContain('fleetMetrics: () => collectFleetMetrics(getKeyValueStore())');
  });
});

describe('urutan startup: job yang butuh guild baru jalan setelah login', () => {
  it('job panel, stay, dan probe musik dijalankan setelah login', () => {
    // Ketiganya mengubah pesan Discord atau menyambungkan voice, jadi guild
    // harus sudah ada di cache.
    expect(at('client.login(')).toBeLessThan(at('startPanelExpiryJob('));
    expect(at('client.login(')).toBeLessThan(at('startStayJob('));
    expect(at('client.login(')).toBeLessThan(at('startMetricsProbe('));
  });

  it('job panel dan stay membaca daftar guild secara langsung', () => {
    expect(source).toContain('guilds: () => [...(client?.guilds.cache.values() ?? [])]');
  });
});

describe('urutan shutdown: semua job dihentikan', () => {
  it('job retensi, panel, stay, probe, dan pelapor metrik semuanya dihentikan', () => {
    const shutdown = between('const shutdown =', 'process.once(\'SIGINT\'');

    for (const stop of [
      'retentionJob?.stop()',
      'panelExpiryJob?.stop()',
      'stayJob?.stop()',
      'metricsProbe?.stop()',
      'fleetReporter?.stop()',
    ]) {
      expect(shutdown, `${stop} tidak dihentikan saat shutdown`).toContain(stop);
    }
  });

  it('server health, store, database, musik, dan client ditutup bersamaan', () => {
    const shutdown = between('void Promise.allSettled([', ']).then(() => {');

    for (const close of [
      'healthServer?.close()',
      'keyValueStore?.store.close()',
      'disconnectDatabase()',
      'stopMusic()',
      'bot.destroy()',
    ]) {
      expect(shutdown, `${close} tidak dijalankan saat shutdown`).toContain(close);
    }
  });

  it('tautan kasus dibersihkan, dan tidak bertahan melewati restart', () => {
    expect(between('const shutdown =', 'retentionJob?.stop()')).toContain('clearCaseLinks()');
  });

  it('sinyal kedua tidak memulai penutupan ganda', () => {
    const shutdown = between('const shutdown =', 'process.once(\'SIGINT\'');

    // Dua sinyal beruntun (Ctrl-C lalu SIGTERM dari supervisor) tidak boleh
    // menjalankan `process.exit` dua kali di tengah promise yang sama.
    expect(shutdown).toContain('if (shuttingDown) return;');
    expect(shutdown).toContain('shuttingDown = true;');
  });

  it('penutupan punya watchdog supaya proses tidak menggantung selamanya', () => {
    const shutdown = between('const shutdown =', 'process.once(\'SIGINT\'');

    expect(shutdown).toContain('setTimeout(() => process.exit(1), 10_000)');
    expect(shutdown).toContain('forceExit.unref()');
  });
});

describe('kegagalan startup dilaporkan dengan benar', () => {
  it('EnvError dan error lain punya pesan yang berbeda', () => {
    // EnvError berarti file .env belum lengkap: perintahnya harus menyebut
    // konfigurasi, bukan "bot gagal dijalankan".
    expect(source).toContain('if (error instanceof EnvError)');
    expect(source).toContain('describeStartupFailure(error)');
  });

  it('koneksi ditutup dulu sebelum process.exit dipanggil', () => {
    const catchBlock = between('await Promise.allSettled([disconnectDatabase()', 'process.exitCode = 1;');

    // process.exit() saat socket masih aktif memicu assertion libuv di Windows.
    expect(catchBlock).toContain('stopMusic()');
    expect(catchBlock).toContain('client?.destroy()');
  });

  it('kegagalan start tidak menggantung: ada watchdog yang menutup proses', () => {
    expect(source).toContain('setTimeout(() => process.exit(1), 5_000)');
    expect(source).toContain('process.exitCode = 1;');
  });

  it('exception yang tidak tertangani menghentikan proses, bukan hanya dicatat', () => {
    const handlers = between('process.on(\'unhandledRejection\'', 'async function stopMusic');

    // Melewatkan exception berarti proses hidup dengan keadaan tidak diketahui.
    expect(handlers).toContain('process.exit(1)');
  });
});