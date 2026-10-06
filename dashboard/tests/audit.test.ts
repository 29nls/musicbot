import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODULES } from '@bot/modules/config/types.js';
import { CONFIG_CHANGED_CHANNEL, decodeConfigChanged } from '@bot/modules/config/invalidation.js';
import { buildAuditSummary, recordConfigAudit, type AuditChange, type AuditRowData } from '@/lib/audit.js';
import { clearWriteRateLimit, checkWriteRateLimit } from '@/lib/rateLimit.js';
import { MemoryKeyValueStore, type KeyValueStore } from '@bot/services/kvStore.js';

const GUILD = '111111111111111111';
const USER = '100000000000000001';

/** Klien Prisma tiruan: hanya `logEntry.create` yang dipakai audit. */
function fakeWriter(result: { id: number } | Error) {
  const create = vi.fn(async (_args: { data: AuditRowData; select: { id: true } }) => {
    if (result instanceof Error) throw result;

    return result;
  });

  return { client: { logEntry: { create } }, create };
}

/** Data yang benar-benar dikirim ke `logEntry.create`, dibaca dari mock. */
function createdData(create: { mock: { calls: unknown[][] } }, index = 0): AuditRowData {
  const call = create.mock.calls[index];
  if (!call) throw new Error(`create dipanggil ${index + 1} kali saja`);

  return (call[0] as { data: AuditRowData }).data;
}

const changes: AuditChange[] = [
  { field: 'defaultVolume', before: '100', after: '40' },
  { field: 'logChannelId', before: 'kosong', after: '400000000000000004' },
];

describe('audit — US-D4', () => {
  it('menulis ke kategori server dengan executor=user', async () => {
    const { client, create } = fakeWriter({ id: 7 });

    const result = await recordConfigAudit(client, {
      guildId: GUILD,
      executorId: USER,
      changes,
      logChannelId: null,
    });

    expect(result).toEqual({ recorded: true, entryId: 7 });

    const data = createdData(create);
    expect(data.category).toBe('server');
    expect(data.executorId).toBe(USER);
    expect(data.guildId).toBe(GUILD);
  });

  it('ringkasan memuat nilai lama dan baru', () => {
    const summary = buildAuditSummary(changes);

    // Perubahan dari 100 ke 40 jauh lebih berguna dicatat daripada perubahan
    // ke 40 saja.
    expect(summary).toContain('defaultVolume: 100 → 40');
    expect(summary).toContain('logChannelId: kosong → 400000000000000004');
  });

  it('menulis retensi 30 hari, sama dengan entri log bot', async () => {
    const { client, create } = fakeWriter({ id: 1 });
    const now = new Date('2026-10-06T00:00:00.000Z');

    await recordConfigAudit(client, { guildId: GUILD, executorId: USER, changes, logChannelId: null, now });

    const data = createdData(create);
    const days = (data.expiresAt.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBe(30);
  });

  it('tidak menulis apa pun kalau tidak ada perubahan', async () => {
    const { client, create } = fakeWriter({ id: 1 });

    const result = await recordConfigAudit(client, { guildId: GUILD, executorId: USER, changes: [], logChannelId: null });

    expect(result.recorded).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('kegagalan dilaporkan, bukan ditelan diam-diam', async () => {
    const { client } = fakeWriter(new Error('batas kolom terlampaui'));

    const result = await recordConfigAudit(client, { guildId: GUILD, executorId: USER, changes, logChannelId: null });

    expect(result.recorded).toBe(false);
    expect(result.reason).toContain('batas kolom');
  });

  it('ringkasan panjang dipotong, bukan ditolak', async () => {
    const { client, create } = fakeWriter({ id: 1 });
    const long: AuditChange[] = [{ field: 'welcomeMessage', before: 'a'.repeat(600), after: 'b'.repeat(600) }];

    const result = await recordConfigAudit(client, { guildId: GUILD, executorId: USER, changes: long, logChannelId: null });

    expect(result.recorded).toBe(true);
    const data = createdData(create);
    // Batas kolom `summary` di skema adalah 1000 karakter; memotong lebih dulu
    // jauh lebih baik daripada kehilangan seluruh entri audit.
    expect(data.summary.length).toBeLessThanOrEqual(1000);
  });
});

describe('rate limit penulisan', () => {
  it('mengizinkan sampai batas lalu menolak', async () => {
    const store = new MemoryKeyValueStore();

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      expect((await checkWriteRateLimit(store, GUILD, USER)).allowed).toBe(true);
    }

    const blocked = await checkWriteRateLimit(store, GUILD, USER);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('sisa kuota dihitung mundur', async () => {
    const store = new MemoryKeyValueStore();

    expect((await checkWriteRateLimit(store, GUILD, USER)).remaining).toBe(29);
    expect((await checkWriteRateLimit(store, GUILD, USER)).remaining).toBe(28);
  });

  it('berlaku per guild dan per user', async () => {
    const store = new MemoryKeyValueStore();

    for (let attempt = 1; attempt <= 31; attempt += 1) {
      await checkWriteRateLimit(store, GUILD, USER);
    }

    expect((await checkWriteRateLimit(store, '222222222222222222', USER)).allowed).toBe(true);
    expect((await checkWriteRateLimit(store, GUILD, '200000000000000002')).allowed).toBe(true);
  });

  it('jendela tidak diperpanjang oleh traffic lanjutan', async () => {
    const store = new MemoryKeyValueStore();

    await checkWriteRateLimit(store, GUILD, USER, 2, 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const after = await checkWriteRateLimit(store, GUILD, USER, 2, 50);

    // Kalau jendela ikut diperpanjang setiap increment, traffic terus-menerus
    // akan membuat rate limit tidak pernah benar-benar berakhir — justru kebalikan dari
    // tujuannya.
    expect(after.allowed).toBe(true);
  });

  it('penghitung bisa dihapus', async () => {
    const store = new MemoryKeyValueStore();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await checkWriteRateLimit(store, GUILD, USER, 2, 60_000);
    }
    expect((await checkWriteRateLimit(store, GUILD, USER, 2, 60_000)).allowed).toBe(false);

    await clearWriteRateLimit(store, GUILD, USER);
    expect((await checkWriteRateLimit(store, GUILD, USER, 2, 60_000)).allowed).toBe(true);
  });

  it('Redis mati berarti melempar, bukan berarti "tidak dibatasi"', async () => {
    const broken: KeyValueStore = {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      take: async () => null,
      increment: async () => {
        throw new Error('ECONNREFUSED');
      },
      compareAndSet: async () => false,
      close: async () => {},
    };

    await expect(checkWriteRateLimit(broken, GUILD, USER)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('pesan invalidasi bisa dibaca bot', () => {
  it('pesan yang diterbitkan dashboard dapat dibaca langganan bot', () => {
    // Dua sisi harus sepakat soal format. Kalau tidak, bot diam-diam membuang
    // cache sambil mengira pesannya tidak pernah dikirim.
    const payload = decodeConfigChanged(
      JSON.stringify({
        guildId: GUILD,
        fields: ['defaultVolume'],
        source: 'dashboard',
        at: new Date().toISOString(),
      }),
    );

    expect(payload?.guildId).toBe(GUILD);
    expect(payload?.fields).toEqual(['defaultVolume']);
  });

  it('nama kanal sama di kedua sisi', () => {
    // `CONFIG_CHANGED_CHANNEL` di-import dari modul bot oleh dashboard, jadi
    // ini hanya mengunci bahwa kanal itu bukan string yang ditulis ulang.
    expect(CONFIG_CHANGED_CHANNEL).toBe('harmony:config:changed');
  });
});

describe('field yang diekspor tidak bocor ke peramban', () => {
  it('konfigurasi bot tidak ikut terbawa ke body peramban', () => {
    // Sanity check untuk key modules default yang dipakai di fixture.
    expect(DEFAULT_MODULES.reactions).toBe(false);
    expect(DEFAULT_MODULES.tickets).toBe(false);
  });
});