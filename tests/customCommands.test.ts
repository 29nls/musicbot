import { describe, expect, it } from 'vitest';
import {
  CustomCommandService,
  CustomCommandValidationError,
  GUILD_CACHE_TTL_MS,
  MAX_NAME_LENGTH,
  MAX_RESPONSE_LENGTH,
  TRIGGER_COOLDOWN_SECONDS,
  TRIGGER_PREFIX,
  creatorLabel,
  customCommandDeletedEmbed,
  customCommandDetailEmbed,
  customCommandListEmbed,
  isSameName,
  nameKey,
  parseResponse,
  parseTrigger,
  parseTriggerName,
  renderResponse,
  renderedMessage,
  toCustomCommandDomain,
  type CustomCommand,
  type CustomCommandRepository,
} from '../src/modules/customcommands/index.js';

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const USER = '333333333333333333';

function commandRow(overrides: Partial<CustomCommand> = {}): CustomCommand {
  return {
    id: 1,
    guildId: GUILD_A,
    name: 'ping',
    response: 'pong',
    createdBy: USER,
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
    ...overrides,
  };
}

/** Repository palsu: menyimpan baris di memori dan mencatat setiap pembacaan. */
class FakeRepository implements CustomCommandRepository {
  public rows: CustomCommand[] = [];
  public listCalls = 0;
  /** Simulasi baris hilang di antara find dan update (P2025). */
  public updateVanishes = false;

  constructor(seed: CustomCommand[] = []) {
    this.rows = [...seed];
  }

  async create(input: {
    guildId: string;
    name: string;
    response: string;
    createdBy: string;
  }, now: Date): Promise<CustomCommand> {
    const row: CustomCommand = {
      id: this.rows.length + 1,
      guildId: input.guildId,
      name: input.name,
      response: input.response,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async findByName(guildId: string, name: string): Promise<CustomCommand | null> {
    return (
      this.rows.find(
        (row) => row.guildId === guildId && row.name === name.toLocaleLowerCase('id'),
      ) ?? null
    );
  }

  async list(guildId: string, take: number): Promise<CustomCommand[]> {
    this.listCalls += 1;
    return this.rows.filter((row) => row.guildId === guildId).slice(0, take);
  }

  async updateResponse(id: number, response: string, now: Date): Promise<CustomCommand | null> {
    if (this.updateVanishes) return null;
    const row = this.rows.find((item) => item.id === id);
    if (!row) return null;
    row.response = response;
    row.updatedAt = now;
    return row;
  }

  async deleteByName(guildId: string, name: string): Promise<CustomCommand | null> {
    const index = this.rows.findIndex(
      (row) => row.guildId === guildId && row.name === name.toLocaleLowerCase('id'),
    );
    if (index === -1) return null;
    const [removed] = this.rows.splice(index, 1);
    return removed ?? null;
  }

  async countByCreator(guildId: string, createdBy: string): Promise<number> {
    return this.rows.filter((row) => row.guildId === guildId && row.createdBy === createdBy).length;
  }

  async anonymizeCreator(guildId: string, createdBy: string, pseudonym: string): Promise<number> {
    let touched = 0;
    for (const row of this.rows) {
      if (row.guildId === guildId && row.createdBy === createdBy) {
        row.createdBy = pseudonym;
        touched += 1;
      }
    }
    return touched;
  }
}

describe('parseTriggerName', () => {
  it('menerima nama dengan atau tanpa tanda seru', () => {
    expect(parseTriggerName('ping')).toBe('ping');
    expect(parseTriggerName('!ping')).toBe('ping');
    expect(parseTriggerName('  !Rules-Of-Server  ')).toBe('rules-of-server');
    expect(parseTriggerName('PING')).toBe('ping');
  });

  it('menolak nama kosong, terlalu panjang, dan karakter aneh', () => {
    expect(() => parseTriggerName('  ')).toThrow(CustomCommandValidationError);
    expect(() => parseTriggerName('!')).toThrow(CustomCommandValidationError);
    expect(() => parseTriggerName('a'.repeat(MAX_NAME_LENGTH + 1))).toThrow(
      /maksimal 32 karakter/,
    );

    for (const name of ['ping pong', 'ping!', 'halo?', '<script>', '🎵', 'a/b', '123']) {
      expect(() => parseTriggerName(name)).toThrow(CustomCommandValidationError);
    }
  });

  it('menolak nama yang dipakai perintah Harmony yang lain', () => {
    // `!play` yang memanggil `/play` bukan pintasan, hanya kebingungan.
    expect(() => parseTriggerName('play', { reserved: ['play', 'queue'] })).toThrow(
      /dipakai perintah Harmony/,
    );
    expect(() => parseTriggerName('!Play', { reserved: ['play'] })).toThrow(
      CustomCommandValidationError,
    );
    expect(parseTriggerName('played', { reserved: ['play'] })).toBe('played');
  });

  it('membandingkan nama tanpa melihat huruf besar-kecil', () => {
    expect(nameKey('  Ping ')).toBe('ping');
    expect(isSameName('RULES', 'rules')).toBe(true);
    expect(isSameName('rules', 'rule')).toBe(false);
  });
});

describe('parseResponse', () => {
  it('mempertahankan baris baru dan meratakan spasi beruntun', () => {
    expect(parseResponse('  baris  satu\n\nbaris   dua  ')).toBe('baris satu\n\nbaris dua');
  });

  it('menolak balasan kosong atau kelewat panjang', () => {
    expect(() => parseResponse('   ')).toThrow(CustomCommandValidationError);
    expect(() => parseResponse('x'.repeat(MAX_RESPONSE_LENGTH + 1))).toThrow(
      /maksimal 1900 karakter/,
    );
  });
});

describe('parseTrigger', () => {
  it('membaca nama dan sisa pesan sebagai argumen', () => {
    expect(parseTrigger('!ping')).toEqual({ name: 'ping', args: '' });
    expect(parseTrigger('!rules  baca  di sini ')).toEqual({
      name: 'rules',
      args: 'baca  di sini',
    });
    expect(parseTrigger('!PING')).toEqual({ name: 'ping', args: '' });
    expect(parseTrigger('!halo dunia.saya')).toEqual({ name: 'halo', args: 'dunia.saya' });
  });

  it('mengenali pemicu setelah mention bot', () => {
    expect(parseTrigger('<@42> !ping', { botId: '42' })).toEqual({ name: 'ping', args: '' });
    expect(parseTrigger('<@!42>!ping', { botId: '42' })).toEqual({ name: 'ping', args: '' });
  });

  it('mengabaikan pesan yang bukan pemicu', () => {
    const notTriggers = [
      'halo semua',
      '!',
      '!  ',
      '!halo!dunia',
      '!1234',
      '!-halo',
      '!@everyone',
      '<@42> halo',
      '',
    ];

    for (const content of notTriggers) {
      expect(parseTrigger(content, { botId: '42' })).toBeNull();
    }
  });
});

describe('renderResponse', () => {
  const context = {
    userId: USER,
    username: 'Rina',
    guildName: 'Server Uji',
    channelId: '555555555555555555',
    args: 'argumen pertama',
  };

  it('mengganti semua placeholder resmi', () => {
    expect(renderResponse('Halo {nama} dari {server} di {channel}: {args}', context)).toBe(
      `Halo Rina dari Server Uji di <#555555555555555555>: argumen pertama`,
    );
    expect(renderResponse('ping {pengguna}', context)).toBe(`ping <@${USER}>`);
  });

  it('mengganti semua kemunculan placeholder', () => {
    expect(renderResponse('{nama} {nama} {nama}', context)).toBe('Rina Rina Rina');
  });

  it('membiarkan placeholder yang tidak dikenal tetap tertulis', () => {
    // Placeholder yang hilang diam-diam akan membuat admin mencari bug di bot,
    // bukan di teksnya sendiri.
    expect(renderResponse('halo {discord}', context)).toBe('halo {discord}');
  });

  it('mengembalikan null kalau balasannya jadi kosong', () => {
    expect(renderedMessage('   ', context)).toBeNull();
    expect(renderedMessage('{args}', { ...context, args: '   ' })).toBeNull();
    expect(renderedMessage('{args}', { ...context, args: 'halo' })).toBe('halo');
  });
});

describe('CustomCommandService.create', () => {
  it('menyimpan perintah baru dan menormalkan namanya', async () => {
    const repository = new FakeRepository();
    const service = new CustomCommandService(repository);

    const result = await service.create({
      guildId: GUILD_A,
      name: '!Ping',
      response: '  pong  ',
      createdBy: USER,
    });

    expect(result.kind).toBe('created');
    expect(result.command.name).toBe('ping');
    expect(result.command.response).toBe('pong');
    expect(repository.rows).toHaveLength(1);
  });

  it('nama yang sudah dipakai diperbarui, bukan dibuat dobel', async () => {
    const repository = new FakeRepository();
    const service = new CustomCommandService(repository);

    await service.create({ guildId: GUILD_A, name: 'ping', response: 'v1', createdBy: USER });
    const second = await service.create({
      guildId: GUILD_A,
      name: 'PING',
      response: 'v2',
      createdBy: USER,
    });

    expect(second.kind).toBe('replaced');
    expect(second.command.response).toBe('v2');
    expect(repository.rows).toHaveLength(1);
  });

  it('membuat ulang perintah kalau barisnya hilang saat diperbarui', async () => {
    // Dua admin mengubah perintah yang sama di detik yang sama: tanpa jalur ini,
    // permintaan salah satunya selesai tanpa efek sama sekali.
    const repository = new FakeRepository();
    const service = new CustomCommandService(repository);

    await service.create({ guildId: GUILD_A, name: 'ping', response: 'v1', createdBy: USER });
    repository.updateVanishes = true;

    const result = await service.create({
      guildId: GUILD_A,
      name: 'ping',
      response: 'v2',
      createdBy: USER,
    });

    expect(result.kind).toBe('created');
    expect(repository.rows).toHaveLength(2);
  });

  it('menolak nama & balasan cacat tanpa menyentuh database', async () => {
    const repository = new FakeRepository();
    const service = new CustomCommandService(repository);

    await expect(
      service.create({ guildId: GUILD_A, name: '!!', response: 'halo', createdBy: USER }),
    ).rejects.toThrow(CustomCommandValidationError);

    await expect(
      service.create({ guildId: GUILD_A, name: 'ping', response: '  ', createdBy: USER }),
    ).rejects.toThrow(CustomCommandValidationError);

    await expect(
      service.create({ guildId: GUILD_A, name: 'ping', response: 'halo', createdBy: USER }, {
        reserved: ['ping'],
      }),
    ).rejects.toThrow(CustomCommandValidationError);

    expect(repository.rows).toHaveLength(0);
  });
});

describe('CustomCommandService.edit & remove', () => {
  it('mengubah balasan perintah yang ada', async () => {
    const repository = new FakeRepository([commandRow()]);
    const service = new CustomCommandService(repository);

    const result = await service.edit(GUILD_A, 'Ping', 'pong baru');

    expect(result.kind).toBe('updated');
    expect(result.kind === 'updated' && result.command.response).toBe('pong baru');
  });

  it('melaporkan perintah yang tidak ada, bukan diam-diam berhasil', async () => {
    const service = new CustomCommandService(new FakeRepository());

    expect((await service.edit(GUILD_A, 'tidak-ada', 'halo')).kind).toBe('not-found');
    expect((await service.remove(GUILD_A, 'tidak-ada')).kind).toBe('not-found');
  });

  it('menghapus perintah dan mengembalikan baris yang terhapus', async () => {
    const repository = new FakeRepository([commandRow()]);
    const service = new CustomCommandService(repository);

    const result = await service.remove(GUILD_A, '!ping');

    expect(result.kind).toBe('deleted');
    expect(result.kind === 'deleted' && result.command.response).toBe('pong');
    expect(repository.rows).toHaveLength(0);
  });

  it('hanya menyentuh server tempat perintahnya berada', async () => {
    const repository = new FakeRepository([
      commandRow({ id: 1, guildId: GUILD_A, name: 'ping' }),
      commandRow({ id: 2, guildId: GUILD_B, name: 'ping' }),
    ]);
    const service = new CustomCommandService(repository);

    await service.remove(GUILD_A, 'ping');

    expect(repository.rows.map((row) => row.guildId)).toEqual([GUILD_B]);
  });
});

describe('CustomCommandService.find & cache', () => {
  it('membaca daftar server sekali lalu memakai cache', async () => {
    const repository = new FakeRepository([commandRow({ name: 'ping' })]);
    const service = new CustomCommandService(repository);

    const first = await service.find(GUILD_A, 'PING');
    const second = await service.find(GUILD_A, 'ping');
    const missing = await service.find(GUILD_A, 'tidak-ada');

    expect(first?.response).toBe('pong');
    expect(second?.id).toBe(first?.id);
    expect(missing).toBeNull();
    // Dua pemanggilan setelah satu baca = kunci cache-nya bekerja.
    expect(repository.listCalls).toBe(1);
  });

  it('membaca ulang setelah cache kedaluwarsa', async () => {
    const repository = new FakeRepository([commandRow()]);
    let now = 1_000_000;
    const service = new CustomCommandService(repository, {
      now: () => now,
      cacheTtlMs: GUILD_CACHE_TTL_MS,
    });

    await service.find(GUILD_A, 'ping');
    now += GUILD_CACHE_TTL_MS - 1;
    await service.find(GUILD_A, 'ping');
    expect(repository.listCalls).toBe(1);

    now += 2;
    await service.find(GUILD_A, 'ping');
    expect(repository.listCalls).toBe(2);
  });

  it('membuang cache begitu ada perubahan (tidak menunggu 60 detik)', async () => {
    const repository = new FakeRepository([commandRow()]);
    const service = new CustomCommandService(repository);

    await service.find(GUILD_A, 'ping');
    await service.edit(GUILD_A, 'ping', 'v2');
    const afterEdit = await service.find(GUILD_A, 'ping');
    expect(afterEdit?.response).toBe('v2');

    await service.remove(GUILD_A, 'ping');
    expect(await service.find(GUILD_A, 'ping')).toBeNull();
  });

  it('cache server lain tidak ikut terpengaruh', async () => {
    const repository = new FakeRepository([
      commandRow({ id: 1, guildId: GUILD_A, name: 'ping' }),
      commandRow({ id: 2, guildId: GUILD_B, name: 'ping', response: 'pong server lain' }),
    ]);
    const service = new CustomCommandService(repository);

    const a = await service.find(GUILD_A, 'ping');
    const b = await service.find(GUILD_B, 'ping');

    expect(a?.response).toBe('pong');
    expect(b?.response).toBe('pong server lain');
    expect(service.cachedGuilds).toBe(2);
  });

  it('membatasi jumlah server yang menyimpan cache', async () => {
    // Tanpa batas ini, bot yang berdiri di banyak server kecil akan menahan
    // daftar perintah tiap server selamanya.
    const repository = new FakeRepository([
      commandRow({ id: 1, guildId: GUILD_A, name: 'ping' }),
      commandRow({ id: 2, guildId: GUILD_B, name: 'ping' }),
      commandRow({ id: 3, guildId: '444444444444444444', name: 'ping' }),
    ]);
    const service = new CustomCommandService(repository, { cacheLimit: 2 });

    await service.find(GUILD_A, 'ping');
    await service.find(GUILD_B, 'ping');
    expect(service.cachedGuilds).toBe(2);

    await service.find('444444444444444444', 'ping');
    expect(service.cachedGuilds).toBe(2);
    // Server pertama yang dibuang akan dibaca ulang, bukan isinya hilang.
    await service.find(GUILD_A, 'ping');
    expect(repository.listCalls).toBe(4);
  });

  it('list() selalu membaca langsung dari database', async () => {
    // Daftar untuk `/customcommand list` harus apa adanya, bukan versi cache
    // yang bisa saja sudah basi.
    const repository = new FakeRepository([commandRow()]);
    const service = new CustomCommandService(repository);

    await service.find(GUILD_A, 'ping');
    repository.rows.push(commandRow({ id: 2, name: 'rules' }));
    const listed = await service.list(GUILD_A);

    expect(listed.map((row) => row.name)).toEqual(['ping', 'rules']);
  });

  it('invalidate() tanpa guildId membersihkan semuanya', async () => {
    const service = new CustomCommandService(new FakeRepository([commandRow()]));

    await service.find(GUILD_A, 'ping');
    expect(service.cachedGuilds).toBe(1);

    service.invalidate();
    expect(service.cachedGuilds).toBe(0);
  });
});

describe('toCustomCommandDomain', () => {
  it('menormalkan nama huruf besar dari baris lama', () => {
    expect(toCustomCommandDomain({ ...commandRow({ name: 'PING' }) }).name).toBe('ping');
  });
});

describe('embed custom command', () => {
  it('daftar kosong tetap menjelaskan cara membuatnya', () => {
    const json = customCommandListEmbed([]).toJSON();

    expect(json.description).toContain('/customcommand add');
    expect(json.description).toContain(`${TRIGGER_PREFIX}nama`);
    expect(json.fields).toBeUndefined();
  });

  it('daftar menampilkan pemicu tiap perintah', () => {
    const json = customCommandListEmbed([
      commandRow({ name: 'ping' }),
      commandRow({ id: 2, name: 'rules' }),
    ]).toJSON();

    expect(json.description).toContain('2 perintah');
    expect(json.fields?.[0]?.value).toContain('!ping');
    expect(json.fields?.[0]?.value).toContain('!rules');
  });

  it('detail memuat balasan, pratinjau, dan bantuan placeholder', () => {
    const json = customCommandDetailEmbed(commandRow(), {
      text: 'pong untuk Rina',
      truncated: false,
    }).toJSON();

    expect(json.title).toContain('!ping');
    expect(json.fields?.some((field) => field.name === 'Balasan')).toBe(true);
    expect(json.fields?.some((field) => field.name === 'Pratinjau')).toBe(true);
    expect(JSON.stringify(json.fields)).toContain('{args}');
  });

  it('pembuat yang sudah dianonimkan tidak ditampilkan sebagai mention', () => {
    const json = customCommandDetailEmbed(commandRow({ createdBy: 'anon:abcdef0123' }), null).toJSON();

    expect(JSON.stringify(json.fields)).toContain('Anonim');
    expect(JSON.stringify(json.fields)).not.toContain('anon:abcdef0123');
    expect(creatorLabel('anon:abcdef0123')).toBe('Anonim');
    expect(creatorLabel(USER)).toBe(`<@${USER}>`);
  });

  it('embed penghapusan menyebut nama perintahnya', () => {
    const json = customCommandDeletedEmbed(commandRow()).toJSON();

    expect(json.description).toContain('!ping');
  });
});

describe('konstanta pemicu', () => {
  it('batas yang dipakai konsisten dengan yang dijanjikan', () => {
    expect(TRIGGER_PREFIX).toBe('!');
    expect(MAX_NAME_LENGTH).toBe(32);
    expect(MAX_RESPONSE_LENGTH).toBe(1_900);
    // Jeda ini yang membuat spam pemicu tidak jadi Ready Steady Go.
    expect(TRIGGER_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});