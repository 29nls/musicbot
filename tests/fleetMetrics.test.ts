import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/services/kvStore.js';
import {
  DEFAULT_FLEET_REPORT_INTERVAL_MS,
  DEFAULT_FLEET_TTL_MS,
  FLEET_METRICS_KEY,
  collectFleetMetrics,
  decodeFleetDocument,
  encodeFleetDocument,
  mergeInstances,
  pruneStaleEntries,
  publishFleetReport,
  renderFleetMetrics,
  renderMetrics,
  startFleetReporter,
  toInstanceMetrics,
  type FleetDocument,
  type InstanceMetrics,
} from '../src/modules/metrics/index.js';
import type { MetricsSnapshot } from '../src/modules/metrics/index.js';

/**
 * Agregasi metrik lintas shard (PRD §11, §13).
 *
 * Yang diuji di sini murni: penjumlahan, codec, dan baca-tulis lewat
 * `MemoryKeyValueStore`. Tidak ada Discord, tidak ada Lavalink, dan tidak ada
 * dua proses sungguhan — jadi apa yang **tidak** dibuktikan oleh file ini tetap
 * jujur: agregasi nyata antar proses baru terbukti kalau sharding pernah
 * dijalankan di lingkungan yang punya store bersama sungguhan.
 */

const NOW = 1_700_000_000_000;

function instance(overrides: Partial<InstanceMetrics> = {}): InstanceMetrics {
  return {
    instanceId: 'shard-a',
    uptimeSeconds: 60,
    guildCount: 10,
    tracksPlayed: 5,
    interactions: {
      command: { total: 10, errors: 1 },
      component: { total: 4, errors: 0 },
      message: { total: 2, errors: 2 },
    },
    lavalink: { connected: true, latencyMs: 30, sampledAt: NOW },
    ...overrides,
  };
}

function snapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    uptimeSeconds: 120,
    tracksPlayed: 7,
    interactions: {
      command: { total: 20, errors: 2, errorRate: 0.1 },
      component: { total: 3, errors: 1, errorRate: 1 / 3 },
      message: { total: 0, errors: 0, errorRate: 0 },
    },
    commandErrorRate: 0.1,
    lavalink: { connected: true, latencyMs: 25, sampledAt: NOW },
    ...overrides,
  };
}

describe('mergeInstances', () => {
  it('menjumlahkan penghitung yang menambah', () => {
    const fleet = mergeInstances([
      instance({ instanceId: 'a', guildCount: 10, tracksPlayed: 5 }),
      instance({ instanceId: 'b', guildCount: 7, tracksPlayed: 3 }),
    ]);

    expect(fleet.instances).toBe(2);
    expect(fleet.guildCount).toBe(17);
    expect(fleet.tracksPlayed).toBe(8);
  });

  it('menghitung error rate dari penghitung mentah, bukan rata-rata rate', () => {
    // Rata-rata rate akan memberitahu 0,5 di sini (1/2 dan 0/1). Angka itu
    // salah: dua shard itu menjalankan tiga perintah dan satu gagal, jadi
    // error rate sebenarnya 1/3.
    const fleet = mergeInstances([
      instance({
        instanceId: 'a',
        interactions: {
          command: { total: 1, errors: 1 },
          component: { total: 0, errors: 0 },
          message: { total: 0, errors: 0 },
        },
      }),
      instance({
        instanceId: 'b',
        interactions: {
          command: { total: 2, errors: 0 },
          component: { total: 0, errors: 0 },
          message: { total: 0, errors: 0 },
        },
      }),
    ]);

    expect(fleet.interactions.command.total).toBe(3);
    expect(fleet.interactions.command.errors).toBe(1);
    expect(fleet.commandErrorRate).toBeCloseTo(1 / 3, 10);
  });

  it('memakai uptime proses tertua, bukan jumlah uptime', () => {
    // Dijumlahkan jadi 120+30 = 150 detik, dan itu tidak berarti apa pun:
    // tidak ada proses yang hidup 150 detik.
    const fleet = mergeInstances([
      instance({ instanceId: 'a', uptimeSeconds: 120 }),
      instance({ instanceId: 'b', uptimeSeconds: 30 }),
    ]);

    expect(fleet.uptimeSeconds).toBe(120);
  });

  it('memakai latensi terburuk antar proses', () => {
    // Urutannya disengaja: proses paling lambat wrote **pertama**. Kalau
    // penjumlahan memakai "nilai terakhir yang dibaca", tes ini ikut hijau
    // padahal latensi terburuk tidak pernah dipakai.
    const fleet = mergeInstances([
      instance({ instanceId: 'a', lavalink: { connected: true, latencyMs: 90, sampledAt: NOW } }),
      instance({ instanceId: 'b', lavalink: { connected: true, latencyMs: 30, sampledAt: NOW } }),
    ]);

    expect(fleet.lavalink.worstLatencyMs).toBe(90);
  });

  it('memakai sample Lavalink terbaru, bukan yang terakhir dibaca', () => {
    // Latest berlaku satu arah: sample terbaru hari ini mengalahkan sample
    // lama. Mengurutkan proses dengan sample terbaru di depan memastikan ini
    // bukan sekadar "nilai terakhir yang dibaca".
    const fleet = mergeInstances([
      instance({ instanceId: 'a', lavalink: { connected: true, latencyMs: 10, sampledAt: NOW + 5_000 } }),
      instance({ instanceId: 'b', lavalink: { connected: true, latencyMs: 10, sampledAt: NOW } }),
    ]);

    expect(fleet.lavalink.sampledAt).toBe(NOW + 5_000);
  });

  it('menghitung jumlah proses yang terjangkau dan tidak', () => {
    const fleet = mergeInstances([
      instance({ instanceId: 'a', lavalink: { connected: true, latencyMs: 10, sampledAt: NOW } }),
      instance({ instanceId: 'b', lavalink: { connected: false, latencyMs: null, sampledAt: null } }),
      instance({ instanceId: 'c', lavalink: { connected: false, latencyMs: null, sampledAt: null } }),
    ]);

    expect(fleet.lavalink.reachable).toBe(1);
    expect(fleet.lavalink.unreachable).toBe(2);
  });

  it('tidak menulis latensi yang belum pernah terukur', () => {
    const fleet = mergeInstances([
      instance({ lavalink: { connected: false, latencyMs: null, sampledAt: null } }),
    ]);

    expect(fleet.lavalink.worstLatencyMs).toBeNull();
    expect(renderFleetMetrics(fleet)).not.toContain('harmony_fleet_lavalink_worst_latency_ms');
  });

  it('daftar kosong berarti nol proses, bukan kegagalan', () => {
    const fleet = mergeInstances([]);

    expect(fleet.instances).toBe(0);
    expect(fleet.commandErrorRate).toBe(0);
    expect(renderFleetMetrics(fleet)).toContain('harmony_fleet_instances 0');
  });
});

describe('codec dokumen agregat', () => {
  it('melewatkan instance yang bentuknya salah tanpa menggagalkan sisanya', () => {
    // Satu proses dengan data rusak tidak boleh mematikan angka KPI fleet.
    const raw = JSON.stringify({
      version: 1,
      updatedAt: NOW,
      entries: [
        { instance: instance({ instanceId: 'a' }), reportedAt: NOW },
        { instance: { guildCount: 3 }, reportedAt: NOW },
        'bukan objek',
        { reportedAt: NOW },
        { instance: instance({ instanceId: 'b' }), reportedAt: NOW },
      ],
    });

    const document = decodeFleetDocument(raw);

    expect(document.entries.map((entry) => entry.instance.instanceId)).toEqual(['a', 'b']);
  });

  it('nilai rusak dibaca sebagai dokumen kosong', () => {
    expect(decodeFleetDocument('bukan json').entries).toEqual([]);
    expect(decodeFleetDocument('[1,2,3]').entries).toEqual([]);
    expect(decodeFleetDocument(null).entries).toEqual([]);
  });

  it('bolak-balik encode-decode mempertahankan isi', () => {
    const document: FleetDocument = {
      version: 1,
      updatedAt: NOW,
      entries: [{ instance: instance(), reportedAt: NOW }],
    };

    const decoded = decodeFleetDocument(encodeFleetDocument(document));

    expect(decoded.entries[0]?.instance.tracksPlayed).toBe(5);
    expect(decoded.updatedAt).toBe(NOW);
  });
});

describe('toInstanceMetrics', () => {
  it('membawa penghitung mentah dan mengabaikan rate yang sudah jadi', () => {
    // Kalau `commandErrorRate` ikut disalin, KPI jadi dua angka dalam satu
    // metrik: rate per proses bisa berbeda dari penjumlahan penghitungnya.
    const report = toInstanceMetrics(snapshot(), { instanceId: 'shard-1', guildCount: 9 });

    expect(report.instanceId).toBe('shard-1');
    expect(report.guildCount).toBe(9);
    expect(report.uptimeSeconds).toBe(120);
    expect(report.interactions.command).toEqual({ total: 20, errors: 2 });
    expect('errorRate' in report.interactions.command).toBe(false);
  });
});

describe('publikasi ke store bersama', () => {
  it('laporan proses menggantikan namanya sendiri, bukan menumpuk', async () => {
    const store = new MemoryKeyValueStore();

    await publishFleetReport(store, instance({ instanceId: 'a', tracksPlayed: 5 }), NOW);
    await publishFleetReport(store, instance({ instanceId: 'a', tracksPlayed: 9 }), NOW + 1_000);

    const fleet = await collectFleetMetrics(store, { now: NOW + 1_000 });

    expect(fleet.instances).toBe(1);
    expect(fleet.tracksPlayed).toBe(9);
  });

  it('menjumlahkan laporan dari beberapa proses', async () => {
    const store = new MemoryKeyValueStore();

    await publishFleetReport(store, instance({ instanceId: 'a' }), NOW);
    await publishFleetReport(store, instance({ instanceId: 'b', guildCount: 4 }), NOW);

    const fleet = await collectFleetMetrics(store, { now: NOW });

    expect(fleet.instances).toBe(2);
    expect(fleet.guildCount).toBe(14);
  });

  it('dua proses yang melapor bersamaan tidak saling menghapus', async () => {
    const store = new MemoryKeyValueStore();
    // Keduanya membaca dokumen kosong lebih dulu, lalu mencoba menulis
    // versinya. Tanpa compareAndSet, shard 'a' hilang diam-diam di sini:
    // hanya satu dokumen yang tersisa, dan tidak ada yang melaporkannya.

    const results = await Promise.all([
      publishFleetReport(store, instance({ instanceId: 'a' }), NOW),
      publishFleetReport(store, instance({ instanceId: 'b' }), NOW),
    ]);

    expect(results).toEqual(['published', 'published']);
    expect((await collectFleetMetrics(store, { now: NOW })).instances).toBe(2);
  });

  it('dokumen yang sudah ada tapi tidak berubah boleh ditulis ulang', async () => {
    const store = new MemoryKeyValueStore();
    await publishFleetReport(store, instance({ instanceId: 'a' }), NOW);

    // Percobaan kedua melihat isi yang sudah ada; compareAndSet harus tetap
    // menerima karena isinya persis sama.
    const outcome = await publishFleetReport(store, instance({ instanceId: 'a' }), NOW);

    expect(outcome).toBe('published');
  });

  it('melewati proses yang berhenti melapor setelah dokumen kedaluwarsa', async () => {
    // Kalau tidak, angka lama membekas sebagai "bot hidup tapi diam".
    // Store memori memakai jam sungguhan, jadi TTL pendek bisa ditunggu.
    const store = new MemoryKeyValueStore();
    const now = Date.now();
    // TTL 60 ms, bukan 1 ms. Store memori memakai jam sungguhan, jadi TTL
    // 1 ms bisa sudah habis sebelum assertion pertama sempat membacanya —
    // tesnya jadi menolak bukan karena prune, tapi karena kelambatan mesin.
    await publishFleetReport(store, instance({ instanceId: 'a' }), now, 60);
    expect((await collectFleetMetrics(store, { now })).instances).toBe(1);

    // Jeda nyata dibuat jauh lebih besar dari TTL, jadi kadaluarsa di sini
    // ditentukan oleh store, bukan oleh scheduler yang kebetulan lambat.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Jam pembaca ikut maju supaya yang diuji benar-benar TTL store.
    expect((await collectFleetMetrics(store, { now: now + 500 })).instances).toBe(0);
  });

  it('membuang laporan proses yang berhenti melapor, walau dokumennya masih hidup', async () => {
    // Ini kasus yang paling mudah terlewat: TTL dokumen disegarkan setiap kali
    // shard lain menulis, jadi dokumennya tidak pernah kedaluwarsa selama ada
    // yang hidup. Kalau prune hanya mengandalkan TTL dokumen, shard yang sudah
    // mati akan tetap dihitung selamanya.
    const store = new MemoryKeyValueStore();

    await publishFleetReport(store, instance({ instanceId: 'a' }), NOW, 1_000);
    await publishFleetReport(store, instance({ instanceId: 'b' }), NOW, 1_000);

    // 'a' berhenti melapor; 'b' terus menulis dan menyegarkan dokumen.
    const afterWindow = NOW + 5_000;
    await publishFleetReport(store, instance({ instanceId: 'b' }), afterWindow, 1_000);

    const document = decodeFleetDocument(await store.get(FLEET_METRICS_KEY));
    expect(document.entries.map((entry) => entry.instance.instanceId)).toEqual(['b']);
    expect((await collectFleetMetrics(store, { now: afterWindow })).instances).toBe(1);
  });

  it('pembacaan juga mengabaikan laporan basi tanpa harus ada penulisan baru', async () => {
    const store = new MemoryKeyValueStore();
    await publishFleetReport(store, instance({ instanceId: 'a' }), NOW, 1_000);

    // Tidak ada tulisan baru sama sekali: prosesnya yang diam, bukan store-nya
    // yang kosong.
    const fleet = await collectFleetMetrics(store, { now: NOW + 10 * 60_000 });

    expect(fleet.instances).toBe(0);
  });

  it('mempertahankan laporan yang waktunya di depan jam pembaca', async () => {
    // Jam antar proses tidak dijamin sama. Selisih negatif berarti jam
    // pembaca lebih lambat, dan membuang laporan orang karena itu akan
    // menghilangkan shard yang sehat. Selisihnya sengaja jauh lebih besar
    // daripada TTL pembaca: kalau tidak, penyaringan mana pun akan
    // tetap uncompromisi dan tes ini tidak benar-benar menjaga apa pun.
    const store = new MemoryKeyValueStore();
    await publishFleetReport(store, instance({ instanceId: 'a' }), NOW + 10 * 60_000, 1_000);

    const fleet = await collectFleetMetrics(store, { now: NOW });

    expect(fleet.instances).toBe(1);
  });

  it('pruneStaleEntries membuang yang basi dan mempertahankan yang segar', () => {
    const entries = [
      { instance: instance({ instanceId: 'a' }), reportedAt: NOW },
      { instance: instance({ instanceId: 'b' }), reportedAt: NOW + 900 },
      { instance: instance({ instanceId: 'c' }), reportedAt: NOW - 1 },
    ];

    const kept = pruneStaleEntries(entries, NOW + 1_000, 1_000).map((entry) => entry.instance.instanceId);

    // Batasnya inklusif: laporan yang umurnya tepat sama dengan TTL masih
    // dipakai, karena proses yang melapor tepat di detik terakhir tidak
    // seharusnya hilang lebih dulu daripada proses yang melambat.
    expect(kept).toEqual(['a', 'b']);
  });

  it('umur dokumen punya nilai default yang masuk akal', () => {
    expect(DEFAULT_FLEET_TTL_MS).toBeGreaterThan(0);
  });

  it('store yang melempar tidak menjatuhkan pembacaan', async () => {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error('redis mati');
      },
      set: async () => undefined,
      delete: async () => undefined,
      take: async () => null,
      increment: async () => 0,
      compareAndSet: async () => true,
      close: async () => undefined,
    };

    const fleet = await collectFleetMetrics(broken);

    expect(fleet.instances).toBe(0);
  });

  it('menulis lewat set biasa dan admitsinya, kalau store tidak punya compareAndSet', async () => {
    const backing = new MemoryKeyValueStore();
    const noCas: KeyValueStore = {
      get: (key) => backing.get(key),
      set: (key, value, options) => backing.set(key, value, options),
      delete: (key) => backing.delete(key),
      take: (key) => backing.take(key),
      increment: (key, options) => backing.increment(key, options),
      close: () => backing.close(),
    };

    const outcome = await publishFleetReport(noCas, instance({ instanceId: 'a' }), NOW);

    // Hasilnya jujur: ditulis, tapi tidak dijaga, jadi tidak diklaim atomik.
    expect(outcome).toBe('published-unguarded');
    expect((await collectFleetMetrics(backing, { now: NOW })).instances).toBe(1);
  });

  it('kegagalan menulis dilaporkan, bukan ditelan diam-diam', async () => {
    const broken: KeyValueStore = {
      get: async () => null,
      set: async () => {
        throw new Error('store penuh');
      },
      delete: async () => undefined,
      take: async () => null,
      increment: async () => 0,
      compareAndSet: async () => {
        throw new Error('store penuh');
      },
      close: async () => undefined,
    };

    expect(await publishFleetReport(broken, instance(), NOW)).toBe('failed');
  });

  it('berhenti setelah retry habis, bukan menimpa dokumen orang', async () => {
    const store = new MemoryKeyValueStore();
    let reads = 0;
    const held = JSON.stringify({
      version: 1,
      updatedAt: NOW,
      entries: [{ instance: instance({ instanceId: 'keeper' }), reportedAt: NOW }],
    });

    // Tiap pembacaan mengembalikan nilai yang sedikit berbeda, jadi setiap
    // percobaan melihat dokumen sudah berubah sejak baca sebelumnya.
    vi.spyOn(store, 'get').mockImplementation(async () => {
      reads += 1;
      return `${held} ${reads}`;
    });

    const outcome = await publishFleetReport(store, instance({ instanceId: 'b' }), NOW + 1);

    expect(outcome).toBe('contended');
    // Mengulang beberapa kali, lalu menyerah alih-alih menimpa.
    expect(reads).toBeGreaterThan(1);
  });
});

describe('job pelapor', () => {
  it('menulis laporan saat dijalankan', async () => {
    const store = new MemoryKeyValueStore();
    const reporter = startFleetReporter({
      store: () => store,
      instanceId: 'shard-x',
      snapshot: () => snapshot(),
      guildCount: () => 11,
      intervalMs: 0,
      runOnStart: false,
    });

    await reporter.runOnce();
    reporter.stop();

    const fleet = await collectFleetMetrics(store, { now: Date.now() });
    expect(fleet.instances).toBe(1);
    expect(fleet.guildCount).toBe(11);
    expect(fleet.commandErrorRate).toBeCloseTo(0.1, 10);
  });

  it('berulang sendiri sesuai jeda', async () => {
    // Job tanpa jeda hanya akan pernah melapor sekali, jadi angka KPI-nya
    // akan berhenti di detik pertama. Pelaporan berulang itu yang membuat ini
    // fitur, bukan starter.
    //
    // Syaratnya ditunggu, bukan ditidurkan: "tulis lebih dari sekali" hanya
    // gagal kalau jadwalnya memang tidak jalan. Tidur dengan durasi tetap
    // bisa gagal karena mesinnya sedang sibuk, dan itu bukan cacat apa pun.
    const counting = new MemoryKeyValueStore();
    let writes = 0;
    const compareAndSet = counting.compareAndSet.bind(counting);
    counting.compareAndSet = async (key, value, options) => {
      writes += 1;
      return compareAndSet(key, value, options);
    };

    const reporter = startFleetReporter({
      store: () => counting,
      instanceId: 'shard-z',
      snapshot: () => snapshot(),
      guildCount: () => 1,
      intervalMs: 5,
      runOnStart: true,
    });

    await vi.waitFor(() => {
      expect(writes).toBeGreaterThan(1);
    });

    reporter.stop();
  });

  it('berhenti menulis setelah stop()', async () => {
    const store = new MemoryKeyValueStore();
    let writes = 0;
    const compareAndSet = store.compareAndSet.bind(store);
    store.compareAndSet = async (key, value, options) => {
      writes += 1;
      return compareAndSet(key, value, options);
    };

    const reporter = startFleetReporter({
      store: () => store,
      instanceId: 'shard-z',
      snapshot: () => snapshot(),
      guildCount: () => 1,
      intervalMs: 5,
      runOnStart: true,
    });

    await vi.waitFor(() => {
      expect(writes).toBeGreaterThan(1);
    });

    reporter.stop();
    const afterStop = writes;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(writes).toBe(afterStop);
  });

  it('pakai jeda dan TTL default saat tidak diberi', async () => {
    const store = new MemoryKeyValueStore();
    const reporter = startFleetReporter({
      store: () => store,
      instanceId: 'shard-default',
      snapshot: () => snapshot(),
      guildCount: () => 2,
      runOnStart: false,
    });

    await reporter.runOnce();
    reporter.stop();

    // TTL default harus cukup panjang untuk satu siklus pelaporan, kalau tidak
    // dokumennya akan kedaluwarsa di antara dua laporan dan KPI jadi bolong.
    expect(DEFAULT_FLEET_TTL_MS).toBeGreaterThan(DEFAULT_FLEET_REPORT_INTERVAL_MS);
    expect((await collectFleetMetrics(store, { now: Date.now() })).instances).toBe(1);
  });

  it('melaporkan sekali saat start, walau tidak ada jadwal', async () => {
    // Tanpa laporan pertama, /metrics menjawab nol selama satu siklus penuh
    // setelah restart — persis saat orang Sedang melihat apakah bot pulih.
    // Jeda dimatikan supaya yang diuji benar-benar jalur start, bukan timer.
    const store = new MemoryKeyValueStore();
    startFleetReporter({
      store: () => store,
      instanceId: 'shard-start',
      snapshot: () => snapshot(),
      guildCount: () => 5,
      intervalMs: 0,
    });

    await vi.waitFor(async () => {
      expect((await collectFleetMetrics(store)).instances).toBe(1);
    });
  });

  it('gagal melapor tidak melempar keluar', async () => {
    const reporter = startFleetReporter({
      store: () => {
        throw new Error('store belum siap');
      },
      instanceId: 'shard-x',
      snapshot: () => snapshot(),
      guildCount: () => 0,
      intervalMs: 0,
      runOnStart: false,
    });

    await expect(reporter.runOnce()).resolves.toBeUndefined();
    reporter.stop();
  });

  it('store dibaca saat dipakai, bukan saat job dibuat', async () => {
    // Job dibangun sebelum store siap adalah urutan yang nyata di startup.
    const store = new MemoryKeyValueStore();
    const reporter = startFleetReporter({
      store: () => store,
      instanceId: 'shard-y',
      snapshot: () => snapshot(),
      guildCount: () => 3,
      intervalMs: 0,
      runOnStart: false,
    });

    await reporter.runOnce();
    await reporter.runOnce();
    reporter.stop();

    const fleet = await collectFleetMetrics(store, { now: Date.now() });
    expect(fleet.instances).toBe(1);
    expect(fleet.tracksPlayed).toBe(7);
  });
});

describe('renderFleetMetrics', () => {
  it('menulis KPI error rate sebagai satu angka bot', () => {
    const fleet = mergeInstances([
      instance({
        instanceId: 'a',
        interactions: {
          command: { total: 90, errors: 0 },
          component: { total: 0, errors: 0 },
          message: { total: 0, errors: 0 },
        },
      }),
      instance({
        instanceId: 'b',
        interactions: {
          command: { total: 10, errors: 5 },
          component: { total: 0, errors: 0 },
          message: { total: 0, errors: 0 },
        },
      }),
    ]);

    const body = renderFleetMetrics(fleet);

    // 5 dari 100 perintah lintas shard. Rata-rata per-shard akan menulis 0.25.
    expect(body).toContain('harmony_fleet_command_error_rate 0.05');
    expect(body).toContain('harmony_fleet_instances 2');
    expect(body).toContain('harmony_fleet_interactions_total{kind="command"} 100');
    expect(body).toContain('harmony_fleet_interaction_errors_total{kind="command"} 5');
  });

  it('tidak pernah membulatkan angka', () => {
    const fleet = mergeInstances([
      instance({
        instanceId: 'a',
        interactions: {
          command: { total: 3, errors: 1 },
          component: { total: 0, errors: 0 },
          message: { total: 0, errors: 0 },
        },
      }),
    ]);

    // 0,3333... dibulatkan jadi 0,33 menghapus hampir seperempat kejadian.
    expect(renderFleetMetrics(fleet)).toContain('harmony_fleet_command_error_rate 0.3333333333333333');
  });

  it('memakai prefix fleet tanpa menimpa seri proses', () => {
    const body = renderFleetMetrics(mergeInstances([instance()]));

    expect(body).toContain('# TYPE harmony_fleet_guilds gauge');
    expect(body).not.toContain('\nharmony_guilds ');
    expect(body).not.toContain('\nharmony_command_error_rate ');
  });

  it('tidak pernah memakai nama seri yang sama dengan seri proses', () => {
    // Tabrakan nama berarti scraper menyimpan dua nilai berbeda pada satu
    // label, dan grafik_error_rate-mu berubah bentuk tanpa ada yang mengubahnya.
    const processBody = renderMetrics(snapshot(), { guildCount: 7 });
    const fleetBody = renderFleetMetrics(mergeInstances([instance()]));

    const names = (body: string) =>
      new Set(
        body
          .split('\n')
          .filter((line) => line.startsWith('# TYPE '))
          .map((line) => line.split(' ')[2] ?? ''),
      );

    for (const name of names(fleetBody)) {
      expect(names(processBody).has(name)).toBe(false);
    }
    expect(names(fleetBody).size).toBeGreaterThan(0);
  });

  it('menulis HELP dan TYPE untuk tiap seri', () => {
    const body = renderFleetMetrics(mergeInstances([instance()]));

    expect(body).toContain('# HELP harmony_fleet_instances ');
    expect(body).toContain('# TYPE harmony_fleet_tracks_played_total counter');
    expect(body.endsWith('\n')).toBe(true);
  });
});

describe('kunci dokumen', () => {
  it('berawalan harmony: dan tidak bentrok dengan lease', () => {
    expect(FLEET_METRICS_KEY).toBe('harmony:metrics:fleet');
    expect(FLEET_METRICS_KEY.startsWith('harmony:sweep-lease:')).toBe(false);
  });
});
