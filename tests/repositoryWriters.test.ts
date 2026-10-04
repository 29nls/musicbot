import { describe, expect, it, vi } from 'vitest';
import { PrismaAutomodRepository } from '../src/modules/automod/repository.js';
import { PrismaCustomCommandRepository } from '../src/modules/customcommands/repository.js';
import { PrismaModerationRepository } from '../src/modules/moderation/repository.js';
import { PrismaPlaylistRepository } from '../src/modules/playlists/repository.js';
import { parseStoredTracks } from '../src/modules/playlists/tracks.js';
import { buildRecordInput, resolveLogTarget } from '../src/modules/logging/record.js';

/**
 * Dua singleton yang dipakai `record.ts` tidak punya setter, jadi modulnya
 * dimock. Menambahkan setter ke kode produksi hanya untuk tes adalah cara
 * membiarkan bentuk kodenya ditentukan oleh bentuk tesnya.
 */
const configRef: { current: unknown } = { current: undefined };
const loggingRef: { current: unknown } = { current: undefined };

vi.mock('../src/modules/config/index.js', () => ({
  getGuildConfigService: () => configRef.current,
}));

vi.mock('../src/modules/logging/singleton.js', () => ({
  getLoggingService: () => loggingRef.current,
}));

/**
 * Lima penulis yang sebelumnya 0% cakupan: repository automod, custom command,
 * dan moderasi, plus penyusun baris log dan penerbit routing log.
 *
 * Yang diuji bukan "Prisma dipanggil", tapi **bentuk kueri dan apa yang terjadi
 * kalau barisnya tidak ada**. Klien tiruannya menyimpan state sungguhan,
 * jadi `updateMany` yang mengembalikan `count: 0` benar-benar berarti tidak
 * ada baris yang berubah — bukan sekadar catatan bahwa metodenya dipanggil.
 * bedanya tes yang bisa menangkap bug dengan tes yang hanya mencatat bentuk.
 *
 * Batas yang jujur dan tidak disembunyikan: PostgreSQL tidak pernah hidup di
 * lingkungan ini, jadi yang terbukti adalah where-clause, claim yang bersifat
 * bersyarat, dan idempotensi penulisan — bukan `DELETE` yang benar-benar jalan.
 */

type Row = Record<string, unknown>;

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';

/** Klien Prisma tiruan yang benar-benar menyimpan baris. */
function fakePrisma(
  seed: { cases?: Row[]; warnings?: Row[]; commands?: Row[]; rules?: Row[]; playlists?: Row[] } = {},
) {
  const state = {
    cases: [...(seed.cases ?? [])],
    warnings: [...(seed.warnings ?? [])],
    commands: [...(seed.commands ?? [])],
    rules: [...(seed.rules ?? [])],
    playlists: [...(seed.playlists ?? [])],
  };
  const calls: Record<string, unknown> = {};

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'guildId_caseNumber') {
        const w = value as { guildId: string; caseNumber: number };
        return row.guildId === w.guildId && row.caseNumber === w.caseNumber;
      }
      if (key === 'dmStatus' && value === null) return row.dmStatus === null || row.dmStatus === undefined;
      if (value !== null && typeof value === 'object' && 'lt' in (value as Row)) {
        const lt = (value as { lt: Date }).lt;
        return (row.createdAt as Date) < lt;
      }
      if (value !== null && typeof value === 'object' && 'in' in (value as Row)) {
        return ((value as { in: string[] }).in as unknown[]).includes(row[key]);
      }
      if (value !== null && typeof value === 'object' && 'equals' in (value as Row)) {
        return String(row[key]).toLowerCase() === String((value as { equals: string }).equals).toLowerCase();
      }
      return row[key] === value;
    });

  let nextId = 1000;

  const prisma = {
    automodRule: {
      async findMany(args: { where: Row }) {
        calls.ruleFindWhere = args.where;
        return state.rules.filter((row) => matches(row, args.where));
      },
      async upsert(args: { where: Row; create: Row; update: Row }) {
        calls.ruleUpsert = args;
        const key = args.where.guildId_type as { guildId: string; type: string };
        const existing = state.rules.find(
          (row) => row.guildId === key.guildId && row.type === key.type,
        );

        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }

        const created = { ...args.create };
        state.rules.push(created);
        return created;
      },
    },
    customCommand: {
      async create(args: { data: Row }) {
        calls.commandCreate = args.data;
        const row = { id: (nextId += 1), ...args.data };
        state.commands.push(row);
        return row;
      },
      async findFirst(args: { where: Row }) {
        calls.commandFindWhere = args.where;
        return state.commands.find((row) => matches(row, args.where)) ?? null;
      },
      async findMany(args: { where: Row; orderBy?: { name: string }; take?: number }) {
        calls.commandListArgs = args;
        const found = state.commands
          .filter((row) => matches(row, args.where))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        return args.take === undefined ? found : found.slice(0, args.take);
      },
      async update(args: { where: { id: number }; data: Row }) {
        const row = state.commands.find((item) => item.id === args.where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, args.data);
        return row;
      },
      async delete(args: { where: { id: number } }) {
        const index = state.commands.findIndex((item) => item.id === args.where.id);
        if (index === -1) throw Object.assign(new Error('not found'), { code: 'P2025' });
        return state.commands.splice(index, 1)[0];
      },
      async count(args: { where: Row }) {
        calls.commandCountWhere = args.where;
        return state.commands.filter((row) => matches(row, args.where)).length;
      },
      async updateMany(args: { where: Row; data: Row }) {
        calls.commandAnonWhere = args.where;
        calls.commandAnonData = args.data;
        let count = 0;
        for (const row of state.commands) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    moderationCase: {
      async findUnique(args: { where: Row }) {
        calls.caseFindWhere = args.where;
        return state.cases.find((row) => matches(row, args.where)) ?? null;
      },
      async update(args: { where: { id: number }; data: Row }) {
        const row = state.cases.find((item) => item.id === args.where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, args.data);
        return row;
      },
      async updateMany(args: { where: Row; data: Row }) {
        calls.caseUpdateMany = args;
        let count = 0;
        for (const row of state.cases) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count += 1;
          }
        }
        return { count };
      },
      async deleteMany(args: { where: Row }) {
        const before = state.cases.length;
        state.cases = state.cases.filter((row) => !matches(row, args.where));
        return { count: before - state.cases.length };
      },
      async groupBy(args: { by: string[]; where: Row }) {
        calls.caseGroupWhere = args.where;
        const buckets = new Map<string, { type: string; active: boolean; count: number }>();
        for (const row of state.cases) {
          if (!matches(row, args.where)) continue;
          const key = `${row.type}|${row.active}`;
          const bucket = buckets.get(key) ?? { type: row.type as string, active: row.active as boolean, count: 0 };
          bucket.count += 1;
          buckets.set(key, bucket);
        }
        return [...buckets.values()].map((bucket) => ({
          ...bucket,
          _count: { _all: bucket.count },
        }));
      },
    },
    playlist: {
      async create(args: { data: Row }) {
        calls.playlistCreate = args.data;
        const row = { id: (nextId += 1), isPublic: false, tracks: [], ...args.data };
        state.playlists.push(row);
        return row;
      },
      async findFirst(args: { where: Row }) {
        calls.playlistFindWhere = args.where;
        return state.playlists.find((row) => matches(row, args.where)) ?? null;
      },
      async findMany(args: { where: Row; take?: number }) {
        calls.playlistListArgs = args;
        const found = state.playlists.filter((row) => matches(row, args.where));
        return args.take === undefined ? found : found.slice(0, args.take);
      },
      async findUnique(args: { where: Row }) {
        calls.playlistUniqueWhere = args.where;
        return state.playlists.find((row) => row.id === args.where.id) ?? null;
      },
      async update(args: { where: { id: number }; data: Row }) {
        const row = state.playlists.find((item) => item.id === args.where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, args.data);
        return row;
      },
      async deleteMany(args: { where: Row }) {
        const before = state.playlists.length;
        state.playlists = state.playlists.filter((row) => !matches(row, args.where));
        return { count: before - state.playlists.length };
      },
      async count(args: { where: Row }) {
        calls.playlistCountWhere = args.where;
        return state.playlists.filter((row) => matches(row, args.where)).length;
      },
      async updateMany(args: { where: Row; data: Row }) {
        calls.playlistAnonWhere = args.where;
        let count = 0;
        for (const row of state.playlists) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    warning: {
      async deleteMany(args: { where: Row }) {
        calls.warningDeleteWhere = args.where;
        const before = state.warnings.length;
        state.warnings = state.warnings.filter((row) => !matches(row, args.where));
        return { count: before - state.warnings.length };
      },
      async updateMany(args: { where: Row; data: Row }) {
        calls.warningAnonWhere = args.where;
        let count = 0;
        for (const row of state.warnings) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
  };

  return { prisma: prisma as never, state, calls };
}

function commandRow(overrides: Row = {}): Row {
  return {
    id: 1,
    guildId: GUILD_A,
    name: 'ping',
    response: 'pong',
    createdBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function playlistRow(overrides: Row = {}): Row {
  return {
    id: 1,
    guildId: GUILD_A,
    ownerId: 'user-1',
    name: 'Putih',
    isPublic: false,
    tracks: [
      { uri: 'https://a/1', title: 'Lagu satu' },
      { uri: 'https://a/2', title: 'Lagu dua' },
    ],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function caseRow(overrides: Row = {}): Row {
  return {
    id: 10,
    guildId: GUILD_A,
    caseNumber: 3,
    type: 'warn',
    targetId: 'user-1',
    moderatorId: 'mod-1',
    reason: 'kasar',
    active: true,
    dmStatus: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaAutomodRepository', () => {
  it('hanya membaca rule milik guild itu', async () => {
    const { prisma, calls } = fakePrisma({
      rules: [
        { guildId: GUILD_A, type: 'spam', enabled: true, threshold: 5, actions: ['delete'], whitelist: {} },
        { guildId: GUILD_B, type: 'spam', enabled: true, threshold: 5, actions: ['delete'], whitelist: {} },
      ],
    });

    const rules = await new PrismaAutomodRepository(prisma).list(GUILD_A);

    expect(calls.ruleFindWhere).toEqual({ guildId: GUILD_A });
    expect(rules.length).toBe(1);
  });

  it('melewatkan baris yang tidak bisa dipetakan, bukan gagal seluruhnya', async () => {
    const { prisma } = fakePrisma({
      rules: [
        { guildId: GUILD_A, type: 'spam', enabled: true, threshold: 5, actions: ['delete'], whitelist: {} },
        // Tipe tak dikenal: mapper akan menolaknya.
        { guildId: GUILD_A, type: 'entah', enabled: true, threshold: 5, actions: ['delete'], whitelist: {} },
      ],
    });

    const rules = await new PrismaAutomodRepository(prisma).list(GUILD_A);

    // Satu baris rusak tidak boleh membuat semua rule server hilang — kalau
    // begini, satu penulisan rusak di masa lalu mematikan moderasi selamanya.
    expect(rules.length).toBe(1);
  });

  it('menyimpan lewat upsert dengan kunci guild + tipe', async () => {
    const { prisma, calls } = fakePrisma();

    await new PrismaAutomodRepository(prisma).save(GUILD_A, {
      type: 'spam',
      enabled: true,
      threshold: 5,
      actions: ['delete', 'warn'],
      whitelist: { users: ['u1'] },
    } as never);

    expect((calls.ruleUpsert as { where: Row }).where).toEqual({
      guildId_type: { guildId: GUILD_A, type: 'spam' },
    });
  });

  it('menyalin daftar aksi, tidak menyimpan referensinya', async () => {
    // Kalau array-nya diteruskan apa adanya, aksi yang diubah di memori service
    // akan mengubah isi baris yang sudah "tersimpan" tanpa satu pun penulisan.
    //
    // Yang diperiksa adalah baris yang benar-benar diterima klien, bukan hasil
    // `list()`: mapper menyalin ulang array-nya, jadi memeriksa domain selalu
    // hijau walau rujukannya sama.
    const { prisma, state } = fakePrisma();
    const actions = ['delete'];
    const whitelist = { users: ['u1'] };

    await new PrismaAutomodRepository(prisma).save(GUILD_A, {
      type: 'spam',
      enabled: true,
      threshold: 5,
      actions,
      whitelist,
    } as never);

    actions.push('warn');

    expect((state.rules[0]?.actions as string[]) ?? []).toEqual(['delete']);
  });

  it('menyalin objek whitelist, tapi array di dalamnya ikut terbawa', async () => {
    // Batas yang ditulis, bukan disembunyikan: `whitelist` disalin dangkal, jadi
    // array `users` masih rujukan yang sama. Tidak berbahaya sekarang karena
    // Prisma men-serialisasi payload di dalam panggilan yang di-`await` — tidak
    // ada jeda tempat mutated bisa menyusul. Kalau suatu saat repository ini
    // mulai menunda penulisan, batas ini jadi bug dan tes ini harus gagal.
    const { prisma, state } = fakePrisma();
    const whitelist = { users: ['u1'] };

    await new PrismaAutomodRepository(prisma).save(GUILD_A, {
      type: 'spam',
      enabled: true,
      threshold: 5,
      actions: ['delete'],
      whitelist,
    } as never);

    expect(state.rules[0]?.whitelist).not.toBe(whitelist);
    expect((state.rules[0]?.whitelist as { users: string[] }).users).toBe(whitelist.users);
  });
});

describe('PrismaCustomCommandRepository', () => {
  it('mencari nama tanpa membedakan huruf besar-kecil', async () => {
    // `!Ping` dan `!ping` yang tersimpan dua baris hanya membuat admin tidak
    // tahu yang mana yang dipakai member.
    const { prisma, calls, state } = fakePrisma({ commands: [commandRow({ name: 'Ping' })] });
    const repository = new PrismaCustomCommandRepository(prisma);

    const found = await repository.findByName(GUILD_A, 'ping');

    expect((calls.commandFindWhere as Row).name).toEqual({ equals: 'ping', mode: 'insensitive' });
    // Barisnya tetap `Ping` di database; yang dinormalkan adalah nama saat
    // dipetakan, jadi domain selalu memakai huruf kecil.
    expect(found?.name).toBe('ping');
    expect(state.commands[0]?.name).toBe('Ping');
    expect(state.commands.length).toBe(1);
  });

  it('tidak menemukan perintah guild lain', async () => {
    const { prisma } = fakePrisma({ commands: [commandRow({ guildId: GUILD_B })] });

    expect(await new PrismaCustomCommandRepository(prisma).findByName(GUILD_A, 'ping')).toBeNull();
  });

  it('daftar dibatasi guild, diurutkan nama, dan dipotong sesuai take', async () => {
    const { prisma, calls } = fakePrisma({
      commands: [
        commandRow({ id: 1, name: 'zeta' }),
        commandRow({ id: 2, name: 'alpha' }),
        commandRow({ id: 3, guildId: GUILD_B, name: 'beta' }),
      ],
    });

    const list = await new PrismaCustomCommandRepository(prisma).list(GUILD_A, 1);

    expect((calls.commandListArgs as Row).take).toBe(1);
    expect((calls.commandListArgs as Row).orderBy).toEqual({ name: 'asc' });
    expect(list.map((item) => item.name)).toEqual(['alpha']);
  });

  it('update balasan mengembalikan null kalau barisnya hilang', async () => {
    // Admin lain menghapus perintah yang sama di antara baca dan tulis: itu
    // hasil yang wajar, bukan kegagalan sistem.
    const { prisma } = fakePrisma({ commands: [] });

    expect(await new PrismaCustomCommandRepository(prisma).updateResponse(99, 'baru', new Date())).toBeNull();
  });

  it('update balasan melempar ulang kegagalan yang bukan baris hilang', async () => {
    const { prisma } = fakePrisma();
    const boom = new Error('koneksi putus');
    vi.spyOn(prisma as never, 'customCommand' as never, 'get').mockReturnValue({
      update: async () => {
        throw boom;
      },
    } as never);

    await expect(
      new PrismaCustomCommandRepository(prisma).updateResponse(1, 'baru', new Date()),
    ).rejects.toBe(boom);
  });

  it('hapus mengembalikan baris yang benar-benar terhapus', async () => {
    const { prisma, state } = fakePrisma({ commands: [commandRow({ name: 'ping' })] });

    const deleted = await new PrismaCustomCommandRepository(prisma).deleteByName(GUILD_A, 'ping');

    expect(deleted?.name).toBe('ping');
    expect(state.commands.length).toBe(0);
  });

  it('hapus nama yang tidak ada menghasilkan null, bukan error', async () => {
    const { prisma } = fakePrisma({ commands: [] });

    expect(await new PrismaCustomCommandRepository(prisma).deleteByName(GUILD_A, 'tidak-ada')).toBeNull();
  });

  it('anonimkan pembuat hanya untuk server dan orang itu', async () => {
    const { prisma, state, calls } = fakePrisma({
      commands: [
        commandRow({ id: 1, createdBy: 'admin-1' }),
        commandRow({ id: 2, createdBy: 'admin-2' }),
        commandRow({ id: 3, guildId: GUILD_B, createdBy: 'admin-1' }),
      ],
    });

    const changed = await new PrismaCustomCommandRepository(prisma).anonymizeCreator(
      GUILD_A,
      'admin-1',
      'anon:abc',
    );

    expect(calls.commandAnonWhere).toEqual({ guildId: GUILD_A, createdBy: 'admin-1' });
    expect(changed).toBe(1);
    expect(state.commands.map((row) => row.createdBy)).toEqual(['anon:abc', 'admin-2', 'admin-1']);
  });

  it('anonimkan tidak menyentuh isi balasan', async () => {
    // Balasan bukan tentang orang; menghapusnya mematikan perintah yang masih
    // dipakai server.
    const { prisma, state } = fakePrisma({ commands: [commandRow()] });

    await new PrismaCustomCommandRepository(prisma).anonymizeCreator(GUILD_A, 'admin-1', 'anon:abc');

    expect(state.commands[0]?.response).toBe('pong');
  });

  it('inventaris privasi menghitung per server dan per pembuat', async () => {
    const { prisma, calls } = fakePrisma({
      commands: [
        commandRow({ id: 1, createdBy: 'admin-1' }),
        commandRow({ id: 2, createdBy: 'admin-1' }),
        commandRow({ id: 3, createdBy: 'admin-2' }),
      ],
    });

    expect(await new PrismaCustomCommandRepository(prisma).countByCreator(GUILD_A, 'admin-1')).toBe(2);
    expect(calls.commandCountWhere).toEqual({ guildId: GUILD_A, createdBy: 'admin-1' });
  });
});

describe('PrismaModerationRepository', () => {
  it('menyaring penghitungan per moderator dan per guild', async () => {
    const { prisma, calls } = fakePrisma({
      cases: [
        caseRow({ id: 1, type: 'warn', moderatorId: 'mod-1' }),
        caseRow({ id: 2, type: 'warn', moderatorId: 'mod-1' }),
        caseRow({ id: 3, type: 'ban', moderatorId: 'mod-1' }),
        caseRow({ id: 4, type: 'warn', moderatorId: 'mod-2' }),
        caseRow({ id: 5, guildId: GUILD_B, type: 'warn', moderatorId: 'mod-1' }),
      ],
    });

    const rows = await new PrismaModerationRepository(prisma).countByTypeAndActive(GUILD_A, 'mod-1');

    expect(calls.caseGroupWhere).toEqual({ guildId: GUILD_A, moderatorId: 'mod-1' });
    const warn = rows.find((row) => row.type === 'warn');
    expect(warn?.count).toBe(2);
    expect(rows.find((row) => row.type === 'ban')?.count).toBe(1);
  });

  it('status DM hanya ditulis kalau belum ada — jadi idempoten', async () => {
    const { prisma, state } = fakePrisma({ cases: [caseRow({ dmStatus: 'sent' })] });

    await new PrismaModerationRepository(prisma).setCaseDmStatus(GUILD_A, 3, 'failed');

    // Sudah 'sent' dari percobaan pertama; menulis 'failed' lagi akan membuat
    // kasus punya dua status DM yang saling bertentangan.
    expect(state.cases[0]?.dmStatus).toBe('sent');
  });

  it('status DM baru ditulis pada kasus yang belum punya status', async () => {
    const { prisma, state } = fakePrisma({ cases: [caseRow({ dmStatus: null })] });

    await new PrismaModerationRepository(prisma).setCaseDmStatus(GUILD_A, 3, 'sent');

    expect(state.cases[0]?.dmStatus).toBe('sent');
  });

  it('menghapus hanya baris yang benar-benar lewat masa berlaku', async () => {
    const { prisma, calls } = fakePrisma({
      cases: [
        caseRow({ id: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }),
        caseRow({ id: 2, createdAt: new Date('2026-09-30T00:00:00.000Z') }),
      ],
    });

    const deleted = await new PrismaModerationRepository(prisma).deleteExpiredCases(
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(calls.caseUpdateMany).toBeUndefined();
    expect(deleted).toBe(1);
  });

  it('menghapus peringatan lewat masa berlaku dan mengembalikan jumlahnya', async () => {
    const { prisma, state } = fakePrisma({
      warnings: [
        { id: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') },
        { id: 2, createdAt: new Date('2026-09-30T00:00:00.000Z') },
      ],
    });

    const deleted = await new PrismaModerationRepository(prisma).deleteExpiredWarnings(
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(deleted).toBe(1);
    expect(state.warnings.length).toBe(1);
  });

  it('menarik peringatan hanya kalau kasusnya benar-benar peringatan', async () => {
    const { prisma, state } = fakePrisma({
      cases: [caseRow({ id: 10, type: 'ban' })],
      warnings: [{ id: 5, caseId: 10 }],
    });

    const result = await new PrismaModerationRepository(prisma).revokeWarning(GUILD_A, 3);

    // Kasus ban bukan peringatan; menariknya berarti membatalkan kasus, dan
    // hubungan peringatan tidak boleh ikut terhapus.
    expect(result).toBeNull();
    expect(state.warnings.length).toBe(1);
    expect(state.cases[0]?.active).toBe(true);
  });

  it('menarik peringatan menonaktifkan kasusnya', async () => {
    const { prisma, state } = fakePrisma({
      cases: [caseRow({ id: 10, type: 'warn' })],
      warnings: [{ id: 5, caseId: 10 }],
    });

    const result = await new PrismaModerationRepository(prisma).revokeWarning(GUILD_A, 3);

    expect(result?.active).toBe(false);
    expect(state.warnings.length).toBe(0);
  });

  it('anonimkan target menutup kasus dan peringatan milik orang itu saja', async () => {
    const { prisma, state } = fakePrisma({
      cases: [
        caseRow({ id: 1, targetId: 'user-1' }),
        caseRow({ id: 2, targetId: 'user-2' }),
        caseRow({ id: 3, guildId: GUILD_B, targetId: 'user-1' }),
      ],
      warnings: [
        { id: 1, guildId: GUILD_A, userId: 'user-1' },
        { id: 2, guildId: GUILD_A, userId: 'user-2' },
      ],
    });

    const result = await new PrismaModerationRepository(prisma).anonymizeTarget(
      GUILD_A,
      'user-1',
      'anon:user-1',
      'permintaan penghapusan',
    );

    expect(result).toEqual({ cases: 1, warnings: 1 });
    expect(state.cases[0]?.targetId).toBe('anon:user-1');
    expect(state.cases[0]?.reason).toBe('permintaan penghapusan');
    expect(state.cases[1]?.targetId).toBe('user-2');
    // Milik server lain tidak boleh ikut tersentuh.
    expect(state.cases[2]?.targetId).toBe('user-1');
  });
});

describe('PrismaPlaylistRepository', () => {
  it('menambah lagu di akhir playlist tanpa menimpa yang sudah ada', async () => {
    const { prisma, state } = fakePrisma({ playlists: [playlistRow()] });

    const updated = await new PrismaPlaylistRepository(prisma).appendTracks(1, [
      { uri: 'https://a/3', title: 'Lagu baru', author: 'Artis', durationMs: 210_000, encoded: null },
    ]);

    const stored = parseStoredTracks(state.playlists[0]?.tracks as never);
    expect(stored.map((track) => track.title)).toEqual(['Lagu satu', 'Lagu dua', 'Lagu baru']);
    expect(updated?.tracks).toHaveLength(3);
  });

  it('playlist yang sudah hilang menghasilkan null, bukan playlist kosong', async () => {
    const { prisma } = fakePrisma({ playlists: [] });

    expect(
      await new PrismaPlaylistRepository(prisma).appendTracks(99, [
        { uri: 'https://a/3', title: 'Lagu baru', author: 'Artis', durationMs: 210_000, encoded: null },
      ]),
    ).toBeNull();
  });

  it('menghapus berdasarkan posisi, dan posisi di luar jangkauan tidak mengubah apa pun', async () => {
    const { prisma, state } = fakePrisma({ playlists: [playlistRow()] });
    const repository = new PrismaPlaylistRepository(prisma);

    const removed = await repository.removeTrackAt(1, 0);

    expect(parseStoredTracks(state.playlists[0]?.tracks as never).map((t) => t.title)).toEqual([
      'Lagu dua',
    ]);
    expect(removed).not.toBeNull();

    // Posisi yang tidak ada: playlist utuh, dan pemanggil diberi null supaya
    // bisa bilang "lagu itu tidak ada" alih-alih melaporkan berhasil.
    expect(await repository.removeTrackAt(1, 99)).toBeNull();
    expect(parseStoredTracks(state.playlists[0]?.tracks as never)).toHaveLength(1);
  });

  it('playlist milik orang lain tidak bisa dibaca lewat pencarian publik', async () => {
    const { prisma, calls } = fakePrisma({
      playlists: [playlistRow({ guildId: GUILD_B, isPublic: true })],
    });

    expect(await new PrismaPlaylistRepository(prisma).findPublicByName(GUILD_A, 'putih')).toBeNull();
    expect(calls.playlistFindWhere).toMatchObject({
      guildId: GUILD_A,
      isPublic: true,
      name: { equals: 'putih', mode: 'insensitive' },
    });
  });

  it('pencarian milik sendiri dibatasi guild DAN pemilik', async () => {
    const { prisma, calls } = fakePrisma({ playlists: [playlistRow()] });

    await new PrismaPlaylistRepository(prisma).findByName(GUILD_A, 'user-1', 'putih');

    expect(calls.playlistFindWhere).toMatchObject({ guildId: GUILD_A, ownerId: 'user-1' });
  });

  it('daftar publik hanya yang publik; daftar milik sendiri semua playlist server itu', async () => {
    const { prisma, calls } = fakePrisma({
      playlists: [playlistRow({ id: 1, isPublic: true }), playlistRow({ id: 2, isPublic: false })],
    });

    const publicList = await new PrismaPlaylistRepository(prisma).listPublic(GUILD_A, 10);
    expect(calls.playlistListArgs).toMatchObject({ where: { guildId: GUILD_A, isPublic: true } });
    expect(publicList).toHaveLength(1);

    const owned = await new PrismaPlaylistRepository(prisma).listOwned(GUILD_A, 'user-1', 10);
    expect(calls.playlistListArgs).toMatchObject({ where: { guildId: GUILD_A, ownerId: 'user-1' } });
    expect(owned).toHaveLength(2);
  });

  it('hapus mengembalikan false kalau barisnya sudah tidak ada', async () => {
    const { prisma } = fakePrisma({ playlists: [] });

    expect(await new PrismaPlaylistRepository(prisma).delete(99)).toBe(false);
  });

  it('anonimkan pemilik hanya untuk playlist orang itu di server itu', async () => {
    const { prisma, state, calls } = fakePrisma({
      playlists: [
        playlistRow({ id: 1, ownerId: 'user-1' }),
        playlistRow({ id: 2, ownerId: 'user-2' }),
        playlistRow({ id: 3, guildId: GUILD_B, ownerId: 'user-1' }),
      ],
    });

    const changed = await new PrismaPlaylistRepository(prisma).anonymizeOwner(
      GUILD_A,
      'user-1',
      'anon:user-1',
    );

    expect(calls.playlistAnonWhere).toEqual({ guildId: GUILD_A, ownerId: 'user-1' });
    expect(changed).toBe(1);
    expect(state.playlists.map((row) => row.ownerId)).toEqual([
      'anon:user-1',
      'user-2',
      'user-1',
    ]);
  });

  it('isi playlist tidak ikut hilang saat pemilik dianonimkan', async () => {
    // Playlist adalah data orang: isinya ikut dibangunkan, bukan hanya
    // kolom pemiliknya.
    const { prisma, state } = fakePrisma({ playlists: [playlistRow({ ownerId: 'user-1' })] });

    await new PrismaPlaylistRepository(prisma).anonymizeOwner(GUILD_A, 'user-1', 'anon:user-1');

    expect(state.playlists[0]?.ownerId).toBe('anon:user-1');
    expect(parseStoredTracks(state.playlists[0]?.tracks as never)).toHaveLength(2);
  });

  it('inventaris privasi menghitung per server dan per pemilik', async () => {
    const { prisma, calls } = fakePrisma({
      playlists: [
        playlistRow({ id: 1, ownerId: 'user-1' }),
        playlistRow({ id: 2, ownerId: 'user-1' }),
        playlistRow({ id: 3, ownerId: 'user-2' }),
      ],
    });

    expect(await new PrismaPlaylistRepository(prisma).countByOwner(GUILD_A, 'user-1')).toBe(2);
    expect(calls.playlistCountWhere).toEqual({ guildId: GUILD_A, ownerId: 'user-1' });
  });
});

describe('penyusun baris log', () => {
  it('menyalin judul embed, dan jatuh ke nama kategori kalau tidak ada', () => {
    const withTitle = buildRecordInput(
      'server',
      { data: { title: 'Kasus #0003' } } as never,
      null,
      { eventKey: 'moderation.warn' },
    );
    const withoutTitle = buildRecordInput(
      'server',
      { data: {} } as never,
      null,
      { eventKey: 'moderation.warn' },
    );

    expect(withTitle.title).toBe('Kasus #0003');
    expect(withoutTitle.title).toBe('server');
  });

  it('meneruskan channel tujuan yang sudah diputuskan', () => {
    const input = buildRecordInput('member', { data: {} } as never, '999', {
      eventKey: 'member.join',
      executorId: 'u1',
      caseNumber: 4,
    });

    expect(input.logChannelId).toBe('999');
    expect(input.executorId).toBe('u1');
    expect(input.caseNumber).toBe(4);
  });
});

describe('resolveLogTarget', () => {
  function useConfig(get: () => Promise<unknown>): void {
    configRef.current = { get } as never;
  }

  function useLogging(getChannel: () => Promise<string | null>): void {
    loggingRef.current = { getChannel } as never;
  }

  it('null saat konfigurasi tidak terbaca — pemanggil harus berhenti, bukan menebak', async () => {
    useConfig(async () => {
      throw new Error('database mati');
    });

    // `null` berbeda dari `{ enabled: false }`: yang pertama berarti "tidak
    // tahu", dan membedakannya mencegah bot menulis ke channel yang salah.
    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toBeNull();
  });

  it('modul mati berarti enabled false tanpa channel', async () => {
    useConfig(async () => ({ modules: { logging: false }, logChannelId: '999' }));

    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toEqual({
      enabled: false,
      channelId: null,
    });
  });

  it('memakai channel routing kalau ada', async () => {
    useConfig(async () => ({ modules: { logging: true }, logChannelId: 'fallback' }));
    useLogging(async () => 'routed');

    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toEqual({
      enabled: true,
      channelId: 'routed',
    });
  });

  it('jatuh ke logChannelId saat routing kosong', async () => {
    useConfig(async () => ({ modules: { logging: true }, logChannelId: 'fallback' }));
    useLogging(async () => null);

    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toEqual({
      enabled: true,
      channelId: 'fallback',
    });
  });

  it('routing yang gagal dibaca tidak membuat catatan hilang', async () => {
    useConfig(async () => ({ modules: { logging: true }, logChannelId: 'fallback' }));
    useLogging(async () => {
      throw new Error('tabel routing belum ada');
    });

    // Catatan moderasi tidak boleh hilang hanya karena routing gagal dibaca.
    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toEqual({
      enabled: true,
      channelId: 'fallback',
    });
  });

  it('tanpa routing dan tanpa logChannelId tetap aktif tanpa tujuan', async () => {
    useConfig(async () => ({ modules: { logging: true }, logChannelId: null }));
    useLogging(async () => null);

    expect(await resolveLogTarget({ id: GUILD_A } as never, 'member')).toEqual({
      enabled: true,
      channelId: null,
    });
  });
});
