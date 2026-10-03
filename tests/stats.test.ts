import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import {
  bar,
  buildSummary,
  countActiveDays,
  dailyTotals,
  mergeEntries,
  peakDay,
  rankTotals,
  sharePercent,
} from '../src/modules/stats/aggregate.js';
import {
  MS_PER_DAY,
  dayKey,
  dayRange,
  eachDay,
  parseDayKey,
  startOfUtcDay,
} from '../src/modules/stats/day.js';
import { toDomain, toDomainList, toDayColumn } from '../src/modules/stats/mapping.js';
import { statsEmbed } from '../src/modules/stats/embeds.js';
import { purgeStatsBefore, statRetentionCutoff } from '../src/modules/stats/retention.js';
import type { PlaybackStatRepository } from '../src/modules/stats/repository.js';
import { StatsService } from '../src/modules/stats/service.js';
import type { StatEntry, StatKind, StatSummary } from '../src/modules/stats/types.js';
import { STAT_MAX_DAYS, STAT_TOP_LIMIT } from '../src/modules/stats/types.js';
import {
  assertStatInput,
  commandKey,
  isStatKind,
  statLabel,
  StatValidationError,
  trackKey,
} from '../src/modules/stats/validation.js';

const GUILD_ID = '123456789012345678';
const NOW = new Date('2026-10-03T21:40:00.000Z');

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
};

function entry(overrides: Partial<StatEntry> = {}): StatEntry {
  return {
    guildId: GUILD_ID,
    kind: 'track',
    key: 'https://youtu.be/abc',
    label: 'Lagu Satu',
    day: new Date('2026-10-03T00:00:00.000Z'),
    count: 1,
    listenedMs: 210_000,
    ...overrides,
  };
}

/** Repository palsu: menyimpan baris di memori dengan logika upsert yang sama. */
class FakeStatRepository implements PlaybackStatRepository {
  public readonly rows: StatEntry[] = [];
  public failOnWrite = false;
  public failOnRead = false;

  async increment(input: {
    guildId: string;
    kind: StatKind;
    key: string;
    label: string;
    day: Date;
    count: number;
    listenedMs: number;
  }): Promise<void> {
    if (this.failOnWrite) throw new Error('database mati');

    const day = toDayColumn(input.day);
    const existing = this.rows.find(
      (row) => row.guildId === input.guildId && row.kind === input.kind && row.key === input.key && toDayColumn(row.day).getTime() === day.getTime(),
    );

    if (existing) {
      existing.count += input.count;
      existing.listenedMs += input.listenedMs;
      return;
    }

    this.rows.push({
      guildId: input.guildId,
      kind: input.kind,
      key: input.key,
      label: input.label,
      day,
      count: input.count,
      listenedMs: input.listenedMs,
    });
  }

  async listRange(guildId: string, kind: StatKind, since: Date, until: Date): Promise<StatEntry[]> {
    if (this.failOnRead) throw new Error('query gagal');

    return this.rows.filter(
      (row) =>
        row.guildId === guildId &&
        row.kind === kind &&
        row.day >= toDayColumn(since) &&
        row.day <= toDayColumn(until),
    );
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const before = this.rows.filter((row) => toDayColumn(row.day) < toDayColumn(cutoff));
    const keep = this.rows.filter((row) => toDayColumn(row.day) >= toDayColumn(cutoff));

    this.rows.length = 0;
    this.rows.push(...keep);

    return before.length;
  }
}

describe('bucket hari', () => {
  it('memotong jam ke 00:00 UTC', () => {
    const day = startOfUtcDay(new Date('2026-10-03T23:59:59.999Z'));

    expect(day.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('menghasilkan kunci YYYY-MM-DD yang bisa dibalik', () => {
    const key = dayKey(new Date('2026-01-05T10:00:00.000Z'));

    expect(key).toBe('2026-01-05');
    expect(parseDayKey(key)?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('menolak tanggal yang tidak pernah ada', () => {
    expect(parseDayKey('2026-02-31')).toBeNull();
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('bukan tanggal')).toBeNull();
  });

  it('rentang N hari berisi tepat N titik dan berakhir hari ini', () => {
    const { since, until } = dayRange(30, NOW);

    expect(until.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(since.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(eachDay(since, until)).toHaveLength(30);
  });

  it('rentang satu hari berarti hari ini saja', () => {
    const { since, until } = dayRange(1, NOW);

    expect(since.getTime()).toBe(until.getTime());
  });

  it('rentang tidak pernah kosong walau inputnya aneh', () => {
    const { since, until } = dayRange(0, NOW);

    expect(since.getTime()).toBe(until.getTime());
    expect(dayRange(-5, NOW).since.getTime()).toBe(until.getTime());
  });

  it('MS_PER_DAY sesuai kalender, bukan tebakan 86400000', () => {
    expect(MS_PER_DAY).toBe(86_400_000);
  });
});

describe('kunci statistik', () => {
  it('perintah hanya memakai namanya sendiri, tanpa argumen', () => {
    expect(commandKey('play')).toBe('play');
    expect(commandKey('  BAN  ')).toBe('ban');
  });

  it('argumen perintah tidak pernah ikut menjadi kunci', () => {
    const fromCommand = commandKey('play');

    expect(fromCommand).not.toContain('situs');
    expect(fromCommand).not.toContain('rahasia');
  });

  it('lagu memakai uri sebagai pengenal, judul sebagai cadangan', () => {
    expect(trackKey({ uri: 'https://youtu.be/ABC', title: 'Lagu' })).toBe('https://youtu.be/abc');
    expect(trackKey({ uri: null, title: 'Lagu Baru' })).toBe('lagu baru');
  });

  it('judul yang sama dari dua sumber jadi satu baris yang sama', () => {
    expect(trackKey({ uri: null, title: 'Halo Dunia' })).toBe(trackKey({ uri: null, title: 'halo dunia' }));
  });

  it('kunci dipotong ke batas kolom database', () => {
    const key = trackKey({ uri: null, title: 'x'.repeat(400) });

    expect(key.length).toBe(200);
  });

  it('label mengosongkan spasi berlebih dan punya cadangan', () => {
    expect(statLabel('  Lagu   Dua  ')).toBe('Lagu Dua');
    expect(statLabel('   ')).toBe('Tidak diketahui');
  });

  it('jenis tak dikenal ditolak, bukan dianggap track', () => {
    expect(isStatKind('track')).toBe(true);
    expect(isStatKind('command')).toBe(true);
    expect(isStatKind('user')).toBe(false);
  });

  it('validasi menolak kunci kosong sebelum menyentuh database', () => {
    expect(() => assertStatInput({ kind: 'track', key: '  ', label: 'Lagu' })).toThrow(
      StatValidationError,
    );
    expect(() =>
      assertStatInput({ kind: 'track', key: 'abc', label: 'Lagu' }),
    ).not.toThrow();
  });
});

describe('pembacaan baris', () => {
  it('membaca listenedMs dari bigint maupun number', () => {
    expect(toDomain({ guildId: GUILD_ID, kind: 'track', key: 'a', label: 'A', day: new Date('2026-10-01'), count: 2, listenedMs: 10n })?.listenedMs).toBe(10);
    expect(toDomain({ guildId: GUILD_ID, kind: 'track', key: 'a', label: 'A', day: new Date('2026-10-01'), count: 2, listenedMs: 10 })?.listenedMs).toBe(10);
  });

  it('baris dengan jenis tak dikenal dilewati, bukan dipaksa jadi track', () => {
    const row = { guildId: GUILD_ID, kind: 'mantan', key: 'a', label: 'A', day: new Date('2026-10-01'), count: 1, listenedMs: 0 };

    expect(toDomain(row)).toBeNull();
    expect(toDomainList([row, { ...row, kind: 'track' }])).toHaveLength(1);
  });

  it('nilai rusak tidak membuat satu baris menggagalkan seluruh daftar', () => {
    const rows = [
      { guildId: GUILD_ID, kind: 'track', key: 'a', label: 'A', day: new Date('invalid'), count: 1, listenedMs: 0 },
      { guildId: GUILD_ID, kind: 'track', key: 'b', label: 'B', day: new Date('2026-10-01'), count: 1, listenedMs: 0 },
    ];

    expect(toDomainList(rows)).toHaveLength(1);
  });

  it('kolom day dipotong ke 00:00 UTC', () => {
    expect(toDayColumn(new Date('2026-10-03T18:22:00.000Z')).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
  });
});

describe('agregasi', () => {
  it('menggabungkan baris harian jadi satu baris per item', () => {
    const merged = mergeEntries([
      entry({ count: 2, listenedMs: 100_000, day: new Date('2026-10-01') }),
      entry({ count: 3, listenedMs: 200_000, day: new Date('2026-10-02') }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ count: 5, listenedMs: 300_000 });
  });

  it('urutan leaderboard menurun dan seri dipecah secara stabil', () => {
    const ranked = rankTotals([
      { key: 'b', label: 'B', count: 5, listenedMs: 0, lastDay: NOW },
      { key: 'a', label: 'A', count: 5, listenedMs: 0, lastDay: NOW },
      { key: 'c', label: 'C', count: 9, listenedMs: 0, lastDay: NOW },
    ]);

    expect(ranked.map((item) => item.label)).toEqual(['C', 'A', 'B']);
  });

  it('leaderboard dipotong ke batas default', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      key: `k${index}`,
      label: `Lagu ${index}`,
      count: index + 1,
      listenedMs: 0,
      lastDay: NOW,
    }));

    expect(rankTotals(many)).toHaveLength(STAT_TOP_LIMIT);
  });

  it('bar mengikuti nilai terbesar dan tidak pernah melebihi lebar', () => {
    expect(bar(10, 10, 8)).toBe('████████');
    expect(bar(5, 10, 8)).toBe('████────');
    expect(bar(1, 10, 8)).toBe('█───────');
    expect(bar(0, 10, 8)).toBe('────────');
    expect(bar(10, 10, 8).length).toBe(8);
  });

  it('porsi dihitung dari total, nol aman saat totalnya nol', () => {
    expect(sharePercent(1, 4)).toBe(25);
    expect(sharePercent(1, 0)).toBe(0);
  });

  it('deret harian menyertakan hari tanpa aktivitas', () => {
    const daily = dailyTotals([
      entry({ day: new Date('2026-10-01') }),
      entry({ day: new Date('2026-10-03') }),
    ]);

    expect(daily.map((point) => dayKey(point.day))).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('hari paling ramai dipilih dari jumlah, bukan urutan baris', () => {
    const peak = peakDay([
      entry({ day: new Date('2026-10-01'), count: 1 }),
      entry({ day: new Date('2026-10-02'), count: 8 }),
      entry({ day: new Date('2026-10-03'), count: 3 }),
    ]);

    expect(dayKey(peak?.day ?? NOW)).toBe('2026-10-02');
  });

  it('tidak ada data berarti tidak ada hari puncak', () => {
    expect(peakDay([])).toBeNull();
  });

  it('menghitung hari aktif dari hari unik, bukan jumlah baris', () => {
    expect(countActiveDays([entry({ day: new Date('2026-10-01') }), entry({ day: new Date('2026-10-01') })])).toBe(1);
  });
});

describe('buildSummary', () => {
  const since = new Date('2026-10-01T00:00:00.000Z');
  const until = new Date('2026-10-07T00:00:00.000Z');

  it('mengisi hari kosong dengan nol supaya grafik lebarnya tetap', () => {
    const summary = buildSummary({
      guildId: GUILD_ID,
      kind: 'track',
      since,
      until,
      entries: [entry({ day: new Date('2026-10-03'), count: 4 })],
    });

    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.every((point) => point.day.getTime() >= since.getTime())).toBe(true);
    expect(summary.totalCount).toBe(4);
    expect(summary.activeDays).toBe(1);
    expect(summary.days).toBe(7);
  });

  it('baris di luar rentang tidak ikut dihitung', () => {
    const summary = buildSummary({
      guildId: GUILD_ID,
      kind: 'track',
      since,
      until,
      entries: [entry({ day: new Date('2026-09-01'), count: 99 })],
    });

    expect(summary.totalCount).toBe(0);
    expect(summary.top).toHaveLength(0);
  });

  it('server tanpa data tetap dapat ringkasan, bukan error', () => {
    const summary = buildSummary({ guildId: GUILD_ID, kind: 'command', since, until, entries: [] });

    expect(summary.totalCount).toBe(0);
    expect(summary.peak).toBeNull();
    expect(summary.daily.every((point) => point.count === 0)).toBe(true);
  });
});

describe('StatsService', () => {
  it('menyimpan satu tally per hari dan menggabungkannya saat dibaca', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await service.recordTrack({ guildId: GUILD_ID, title: 'Lagu', uri: 'https://youtu.be/abc', listenedMs: 200_000 });
    await service.recordTrack({ guildId: GUILD_ID, title: 'Lagu', uri: 'https://youtu.be/abc', listenedMs: 100_000 });

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]?.count).toBe(2);

    const summary = await service.summary({ guildId: GUILD_ID, kind: 'track', now: NOW });
    expect(summary.totalCount).toBe(2);
    expect(summary.totalListenedMs).toBe(300_000);
  });

  it('menyimpan label yang bisa dibaca manusia', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await service.recordTrack({ guildId: GUILD_ID, title: '  Lagu  Baru ', listenedMs: 60_000 });

    expect(repository.rows[0]?.label).toBe('Lagu Baru');
  });

  it('perintah disimpan sebagai /nama tanpa argumen', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await service.recordCommand('play', GUILD_ID);

    expect(repository.rows[0]).toMatchObject({ kind: 'command', key: 'play', label: '/play' });
    expect(repository.rows[0]?.listenedMs).toBe(0);
  });

  it('perintah terpisah dari lagu pada jenis yang berbeda', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await service.recordCommand('play', GUILD_ID);
    await service.recordTrack({ guildId: GUILD_ID, title: 'Lagu', listenedMs: 10_000 });

    expect(await service.summary({ guildId: GUILD_ID, kind: 'command', now: NOW })).toMatchObject({ totalCount: 1 });
    expect(await service.summary({ guildId: GUILD_ID, kind: 'track', now: NOW })).toMatchObject({ totalCount: 1 });
  });

  it('kegagalan menulis tidak pernah dilempar ke pemanggil playback', async () => {
    const repository = new FakeStatRepository();
    repository.failOnWrite = true;
    const service = new StatsService(repository, quietLogger);

    await expect(
      service.recordTrack({ guildId: GUILD_ID, title: 'Lagu', listenedMs: 10_000 }),
    ).resolves.toBe(false);
  });

  it('lagu tanpa judul tidak ditulis, dan tidak menggagalkan apa pun', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await expect(service.recordTrack({ guildId: GUILD_ID, title: '   ', listenedMs: 10_000 })).resolves.toBe(false);
    expect(repository.rows).toHaveLength(0);
  });

  it('kegagalan membaca tetap dilempar supaya /stats tidak menampilkan nol palsu', async () => {
    const repository = new FakeStatRepository();
    repository.failOnRead = true;
    const service = new StatsService(repository, quietLogger);

    await expect(service.summary({ guildId: GUILD_ID, kind: 'track', now: NOW })).rejects.toThrow(
      'query gagal',
    );
  });

  it('periode di luar batas dijepit, bukan jadi query besar', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    const summary = await service.summary({
      guildId: GUILD_ID,
      kind: 'track',
      days: 100_000,
      now: NOW,
    });

    expect(summary.days).toBe(STAT_MAX_DAYS);
  });

  it('periode tidak valid jatuh ke default, bukan nol hari', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    const summary = await service.summary({ guildId: GUILD_ID, kind: 'track', days: -1, now: NOW });

    expect(summary.days).toBe(1);
  });

  it('hari pencatatan mengikuti waktu yang diberikan, untuk tes yang deterministik', async () => {
    const repository = new FakeStatRepository();
    const service = new StatsService(repository, quietLogger);

    await service.recordTrack({
      guildId: GUILD_ID,
      title: 'Lagu',
      listenedMs: 10_000,
      at: new Date('2026-10-02T23:30:00.000Z'),
    });

    expect(dayKey(repository.rows[0]?.day ?? NOW)).toBe('2026-10-02');
  });
});

describe('retensi statistik', () => {
  it('memotong batas ke 90 hari lalu 00:00 UTC', () => {
    const cutoff = statRetentionCutoff(NOW);

    expect(cutoff.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });

  it('menghapus baris yang lebih tua dan menyimpan yang terbaru', async () => {
    const repository = new FakeStatRepository();
    repository.rows.push(
      entry({ key: 'lama', day: new Date('2026-01-01') }),
      entry({ key: 'baru', day: new Date('2026-10-01') }),
    );

    const result = await purgeStatsBefore(repository, NOW);

    expect(result.deleted).toBe(1);
    expect(repository.rows.map((row) => row.key)).toEqual(['baru']);
  });

  it('baris tepat di batas retensi tidak dihapus', async () => {
    const repository = new FakeStatRepository();
    repository.rows.push(entry({ day: statRetentionCutoff(NOW) }));

    await purgeStatsBefore(repository, NOW);

    expect(repository.rows).toHaveLength(1);
  });

  it('service meneruskan purge ke repository', async () => {
    const repository = new FakeStatRepository();
    repository.rows.push(entry({ day: new Date('2026-01-01') }));
    const service = new StatsService(repository, quietLogger);

    const result = await service.purgeExpired(NOW);

    expect(result.deleted).toBe(1);
  });
});
describe('embed /stats', () => {
  function summaryFor(overrides: Partial<StatSummary> = {}): StatSummary {
    return {
      guildId: GUILD_ID,
      kind: 'track',
      since: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-10-03T00:00:00.000Z'),
      totalCount: 6,
      totalListenedMs: 600_000,
      activeDays: 2,
      days: 3,
      top: [
        {
          key: 'a',
          label: 'Lagu A',
          count: 5,
          listenedMs: 500_000,
          lastDay: new Date('2026-10-03'),
        },
      ],
      daily: [
        { day: new Date('2026-10-01'), count: 1, listenedMs: 100_000 },
        { day: new Date('2026-10-02'), count: 0, listenedMs: 0 },
        { day: new Date('2026-10-03'), count: 5, listenedMs: 500_000 },
      ],
      peak: { day: new Date('2026-10-03'), count: 5, listenedMs: 500_000 },
      ...overrides,
    };
  }

  function fieldsOf(embed: EmbedBuilder): Array<{ name: string; value: string }> {
    return (embed.toJSON().fields ?? []).map((field) => ({
      name: field.name ?? '',
      value: field.value ?? '',
    }));
  }

  it('server tanpa data tetap melihat embed berisi angka, bukan pesan kosong', () => {
    const json = statsEmbed(summaryFor({ totalCount: 0, top: [], peak: null })).toJSON();

    expect(json.description).toContain('Belum ada data');
    expect(fieldsOf(statsEmbed(summaryFor({ totalCount: 0, top: [], peak: null })))).toHaveLength(1);
  });

  it('leaderboard menampilkan bar, jumlah, dan porsi', () => {
    const field = fieldsOf(statsEmbed(summaryFor())).find((item) => item.name === 'Lagu paling sering');

    expect(field?.value).toContain('Lagu A');
    expect(field?.value).toContain('5x');
    expect(field?.value).toContain('83.3%');
  });

  it('grafik harian menampilkan semua hari dalam rentang', () => {
    const field = fieldsOf(statsEmbed(summaryFor())).find((item) => item.name === 'Harian');

    expect(field?.value).toContain('2026-10-01');
    expect(field?.value).toContain('2026-10-02');
    expect(field?.value).toContain('2026-10-03');
  });

  it('rentang panjang dijumlahkan per minggu, dan itu disebut apa adanya', () => {
    const daily = Array.from({ length: 30 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 8, 4 + index)),
      count: index + 1,
      listenedMs: 0,
    }));

    const field = fieldsOf(statsEmbed(summaryFor({ daily, days: 30 }))).find(
      (item) => item.name === 'Harian',
    );

    expect(field?.value).toContain('dijumlahkan per minggu');
    expect(field?.value.split('\n').length).toBeLessThan(30);
  });

  it('jenis perintah punya judul dan field sendiri', () => {
    const json = statsEmbed(summaryFor({ kind: 'command' })).toJSON();

    expect(json.title).toBe('Statistik Perintah');
    expect(fieldsOf(statsEmbed(summaryFor({ kind: 'command' })))[0]?.name).toBe('Perintah paling sering');
  });

  it('footer menyebut rentang hari dan sifat tanpa data pribadi', () => {
    const json = statsEmbed(summaryFor()).toJSON();

    expect(json.footer?.text).toContain('2026-10-01 sampai 2026-10-03');
    expect(json.footer?.text).toContain('tanpa data pribadi');
  });
});
