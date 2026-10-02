import { describe, expect, it } from 'vitest';
import type { Guild } from 'discord.js';
import {
  ticketClosedEmbed,
  ticketListEmbed,
  ticketOpenedEmbed,
  ticketPanelEmbed,
} from '../src/modules/tickets/embeds.js';
import { openTicket, closeAndArchive } from '../src/modules/tickets/lifecycle.js';
import { buildTicketSubjectModal } from '../src/modules/tickets/modal.js';
import { missingTicketConfig, parseTicketSubject } from '../src/modules/tickets/validation.js';
import type { GuildConfig } from '../src/modules/config/index.js';
import { toDomain, type TicketRow } from '../src/modules/tickets/mapping.js';
import {
  closedTicketChannelName,
  slugify,
  ticketChannelName,
} from '../src/modules/tickets/naming.js';
import { purgeExpiredTickets, ticketRetentionCutoff } from '../src/modules/tickets/retention.js';
import type { TicketRepository } from '../src/modules/tickets/repository.js';
import type { TicketTranscript } from '../src/modules/tickets/transcript.js';
import { TicketService } from '../src/modules/tickets/service.js';
import {
  MODAL_SUBJECT_MAX_LENGTH,
  TICKET_RETENTION_MONTHS,
  TICKET_SUBJECT_MODAL,
  formatTicketId,
  isTicketStatus,
  isTicketSubjectModal,
  parseTicketButtonId,
  ticketButtonId,
  type CreateTicketInput,
  type Ticket,
} from '../src/modules/tickets/types.js';

const GUILD_ID = '123456789012345678';
const OPENER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const CHANNEL_ID = '444444444444444444';

const NOW = new Date('2026-10-02T12:00:00.000Z');

function row(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 1,
    ticketNumber: 7,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    openerId: OPENER_ID,
    subject: 'Tidak bisa masuk voice',
    status: 'open',
    claimedBy: null,
    createdAt: NOW,
    closedAt: null,
    closedBy: null,
    expiresAt: null,
    transcript: null,
    ...overrides,
  };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return toDomain(row(overrides));
}

class FakeTicketRepository implements TicketRepository {
  public readonly rows: Ticket[] = [];
  public deleteCutoff: Date | null = null;
  /** Disetel untuk menguji jalur best-effort saat penyimpanan transkrip gagal. */
  public transcriptError: Error | null = null;
  private nextId = 1;
  private counter = 0;

  async create(input: CreateTicketInput, now: Date): Promise<Ticket> {
    const created = ticket({
      id: this.nextId++,
      ticketNumber: ++this.counter,
      guildId: input.guildId,
      openerId: input.openerId,
      subject: input.subject,
      channelId: null,
      createdAt: now,
    });
    this.rows.push(created);

    return { ...created };
  }

  async findByNumber(guildId: string, ticketNumber: number): Promise<Ticket | null> {
    const found = this.rows.find(
      (item) => item.guildId === guildId && item.ticketNumber === ticketNumber,
    );

    return found ? { ...found } : null;
  }

  async findAnyByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
    const matches = this.rows.filter(
      (item) => item.guildId === guildId && item.channelId === channelId,
    );
    const found = matches.sort((a, b) => b.ticketNumber - a.ticketNumber)[0];

    return found ? { ...found } : null;
  }

  async attachChannel(ticketId: number, channelId: string): Promise<void> {
    const found = this.rows.find((item) => item.id === ticketId);
    if (found) found.channelId = channelId;
  }

  async findOpenByOpener(guildId: string, openerId: string): Promise<Ticket | null> {
    return (
      this.rows.find(
        (item) => item.guildId === guildId && item.openerId === openerId && item.status === 'open',
      ) ?? null
    );
  }

  async findByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
    return (
      this.rows.find(
        (item) => item.guildId === guildId && item.channelId === channelId && item.status === 'open',
      ) ?? null
    );
  }

  async listOpen(guildId: string, take: number): Promise<Ticket[]> {
    return this.rows
      .filter((item) => item.guildId === guildId && item.status === 'open')
      .slice(0, take);
  }

  async countOpen(guildId: string): Promise<number> {
    return this.rows.filter((item) => item.guildId === guildId && item.status === 'open').length;
  }

  async claim(_guildId: string, _channelId: string, staffId: string): Promise<Ticket | null> {
    const found = this.rows.find((item) => item.status === 'open');
    if (!found) return null;

    found.claimedBy = staffId;

    return { ...found };
  }

  async close(
    guildId: string,
    channelId: string,
    closedBy: string,
    now: Date,
    expiresAt: Date,
  ): Promise<Ticket | null> {
    const found = this.rows.find(
      (item) => item.guildId === guildId && item.channelId === channelId && item.status === 'open',
    );
    if (!found) return null;

    Object.assign(found, { status: 'closed' as const, closedAt: now, closedBy, expiresAt });

    return { ...found };
  }

  async closeById(
    ticketId: number,
    closedBy: string,
    now: Date,
    expiresAt: Date,
  ): Promise<Ticket | null> {
    const found = this.rows.find((item) => item.id === ticketId && item.status === 'open');
    if (!found) return null;

    Object.assign(found, { status: 'closed' as const, closedAt: now, closedBy, expiresAt });

    return { ...found };
  }

  async attachTranscript(ticketId: number, transcript: TicketTranscript): Promise<void> {
    if (this.transcriptError) throw this.transcriptError;

    const found = this.rows.find((item) => item.id === ticketId);
    if (found) found.transcript = transcript;
  }

  async deleteExpired(cutoff: Date): Promise<number> {
    this.deleteCutoff = cutoff;

    const due = this.rows.filter(
      (item) => item.status === 'closed' && item.closedAt !== null && item.closedAt < cutoff,
    );
    for (const item of due) {
      this.rows.splice(this.rows.indexOf(item), 1);
    }

    return due.length;
  }
}

function makeService(): { repository: FakeTicketRepository; service: TicketService } {
  const repository = new FakeTicketRepository();

  return { repository, service: new TicketService(repository) };
}

describe('nama channel tiket', () => {
  it('slugify menyaring karakter yang tidak diizinkan Discord', () => {
    expect(slugify('Sasha Putri!')).toBe('sasha-putri');
    expect(slugify('  spaces  here  ')).toBe('spaces-here');
    expect(slugify('emoji 🎉 only')).toBe('emoji-only');
  });

  it('slugify membuang aksen', () => {
    expect(slugify('Ré Moderateur')).toBe('re-moderateur');
  });

  it('nama tiket terbuka memuat nomor & nama member', () => {
    expect(ticketChannelName(7, 'Sasha')).toBe('ticket-0007-sasha');
  });

  it('tanpa nama member tetap sah karena nomor tiketnya unik', () => {
    expect(ticketChannelName(7, '')).toBe('ticket-0007');
    expect(ticketChannelName(7, '🎉🎉')).toBe('ticket-0007');
  });

  it('nama member yang panjang dipotong, nomor tetap utuh', () => {
    const name = ticketChannelName(7, 'nama yang sangat panjang sekali '.repeat(5));

    expect(name.startsWith('ticket-0007-')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it('nama channel tertutup ditandai dengan prefix closed', () => {
    expect(closedTicketChannelName(7)).toBe('closed-0007');
  });
});

describe('formatTicketId & status', () => {
  it('nomor tiket dipadatkan seperti nomor kasus', () => {
    expect(formatTicketId(7)).toBe('#0007');
    expect(formatTicketId(142)).toBe('#0142');
  });

  it('status asing dianggap tidak valid', () => {
    expect(isTicketStatus('open')).toBe(true);
    expect(isTicketStatus('closed')).toBe(true);
    expect(isTicketStatus('menunggu')).toBe(false);
  });
});

describe('customId tombol tiket', () => {
  it('encode lalu decode', () => {
    for (const action of ['create', 'claim', 'close'] as const) {
      expect(parseTicketButtonId(ticketButtonId(action))).toBe(action);
    }
  });

  it('menolak customId lain', () => {
    expect(parseTicketButtonId('setup:save')).toBeNull();
    expect(parseTicketButtonId('ticket:hapus')).toBeNull();
  });
});

describe('toDomain', () => {
  it('status tak dikenal dianggap tertutup supaya tidak muncul sebagai tiket aktif', () => {
    expect(toDomain(row({ status: 'entah' })).status).toBe('closed');
  });

  it('status yang sah diteruskan apa adanya', () => {
    expect(toDomain(row({ status: 'open' })).status).toBe('open');
  });
});

describe('TicketService.open', () => {
  it('membuat tiket baru dengan nomor naik', async () => {
    const { service } = makeService();

    const first = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: 'A' }, NOW);
    const second = await service.open({ guildId: GUILD_ID, openerId: STAFF_ID, subject: 'B' }, NOW);

    expect(first.ticket.ticketNumber).toBe(1);
    expect(second.ticket.ticketNumber).toBe(2);
    expect(first.existing).toBeNull();
  });

  it('satu member tidak boleh punya dua tiket terbuka', async () => {
    const { service } = makeService();
    await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);

    const again = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);

    expect(again.existing?.ticketNumber).toBe(1);
    expect(again.ticket).toBe(again.existing);
  });

  it('server lain tidak terpengaruh', async () => {
    const { service } = makeService();
    await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);

    const other = await service.open(
      { guildId: '999999999999999999', openerId: OPENER_ID, subject: null },
      NOW,
    );

    expect(other.existing).toBeNull();
  });

  it('subjek dipotong ke batas kolom', async () => {
    const { service } = makeService();

    const opened = await service.open(
      { guildId: GUILD_ID, openerId: OPENER_ID, subject: 'x'.repeat(500) },
      NOW,
    );

    expect(opened.ticket.subject).toHaveLength(200);
  });

  it('tiket yang sudah ditutup tidak lagi memblokir tiket baru', async () => {
    const { repository, service } = makeService();
    const first = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);
    await service.attachChannel(first.ticket.id, CHANNEL_ID);
    await service.close(GUILD_ID, CHANNEL_ID, STAFF_ID, NOW);

    const again = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);

    expect(again.existing).toBeNull();
    expect(again.ticket.ticketNumber).toBe(2);
    expect(repository.rows.filter((item) => item.status === 'closed')).toHaveLength(1);
  });
});

describe('TicketService.close & abandon', () => {
  it('menutup tiket yang channelnya sudah terhubung', async () => {
    const { service } = makeService();
    const opened = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);
    await service.attachChannel(opened.ticket.id, CHANNEL_ID);

    const closed = await service.close(GUILD_ID, CHANNEL_ID, STAFF_ID, NOW);

    expect(closed?.status).toBe('closed');
    expect(closed?.closedBy).toBe(STAFF_ID);
  });

  it('retensi dihitung dari waktu penutupan', async () => {
    const { service } = makeService();
    const opened = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);
    await service.attachChannel(opened.ticket.id, CHANNEL_ID);

    const closed = await service.close(GUILD_ID, CHANNEL_ID, STAFF_ID, NOW);

    const expected = new Date(NOW);
    expected.setMonth(expected.getMonth() + TICKET_RETENTION_MONTHS);
    expect(closed?.expiresAt?.getTime()).toBe(expected.getTime());
  });

  it('tiket yang sudah tertutup tidak bisa ditutup lagi', async () => {
    const { service } = makeService();
    const opened = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);
    await service.attachChannel(opened.ticket.id, CHANNEL_ID);
    await service.close(GUILD_ID, CHANNEL_ID, STAFF_ID, NOW);

    await expect(service.close(GUILD_ID, CHANNEL_ID, STAFF_ID, NOW)).resolves.toBeNull();
  });

  it('abandon menutup tiket yang tidak punya channel', async () => {
    const { service } = makeService();
    const opened = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);

    const abandoned = await service.abandon(opened.ticket.id, STAFF_ID, NOW);

    expect(abandoned?.status).toBe('closed');

    // Setelah di-abandon, member boleh membuka tiket lagi.
    const again = await service.open({ guildId: GUILD_ID, openerId: OPENER_ID, subject: null }, NOW);
    expect(again.existing).toBeNull();
  });
});

describe('retensi tiket', () => {
  it('cutoff mundur tepat sebulan kalender', () => {
    const cutoff = ticketRetentionCutoff(NOW);

    expect(cutoff.getFullYear()).toBe(2025);
    expect(cutoff.getMonth()).toBe(9);
    expect(cutoff.getDate()).toBe(2);
  });

  it('menghapus tiket tertutup yang lewat batas', async () => {
    const { repository } = makeService();

    const result = await purgeExpiredTickets(repository, NOW);

    expect(result.ticketsDeleted).toBe(0);
    expect(result.cutoff).toEqual(ticketRetentionCutoff(NOW));
    expect(repository.deleteCutoff).toEqual(ticketRetentionCutoff(NOW));
  });
});

describe('embed tiket', () => {
  it('panel menjelaskan privasi & batas satu tiket', () => {
    const rendered = JSON.stringify(
      ticketPanelEmbed({ staffRoleId: STAFF_ID, description: null }).toJSON(),
    );

    expect(rendered).toContain('privat');
    expect(rendered).toContain(`<@&${STAFF_ID}>`);
    expect(rendered).toContain('satu tiket terbuka');
  });

  it('deskripsi admin menggantikan teks bawaan', () => {
    const rendered = JSON.stringify(
      ticketPanelEmbed({ staffRoleId: STAFF_ID, description: 'Tanya aja di sini.' }).toJSON(),
    );

    expect(rendered).toContain('Tanya aja di sini.');
  });

  it('embed pembukaan memuat pembuat, staff, dan subjek', () => {
    const rendered = JSON.stringify(ticketOpenedEmbed(ticket(), STAFF_ID).toJSON());

    expect(rendered).toContain(`<@${OPENER_ID}>`);
    expect(rendered).toContain(`<@&${STAFF_ID}>`);
    expect(rendered).toContain('Tidak bisa masuk voice');
  });

  it('embed penutupan menjelaskan isi tetap tersimpan', () => {
    const rendered = JSON.stringify(ticketClosedEmbed(ticket(), STAFF_ID).toJSON());

    expect(rendered).toContain('dikunci');
    expect(rendered).toContain(`<@${STAFF_ID}>`);
  });

  it('daftar kosong memberi kabar baik', () => {
    expect(ticketListEmbed([], 0).toJSON().description).toContain('Tidak ada tiket terbuka');
  });

  it('daftar tiket menyebut channel, pembuat, dan klaim', () => {
    const claimed = ticket({ claimedBy: STAFF_ID });
    const json = ticketListEmbed([claimed], 5).toJSON();

    expect(json.description).toContain(`<#${CHANNEL_ID}>`);
    expect(json.description).toContain(`<@${OPENER_ID}>`);
    expect(json.description).toContain(`<@${STAFF_ID}>`);
    expect(json.footer?.text).toBe('5 tiket terbuka');
  });

  it('channel yang hilang tetap terlihat jelas di daftar', () => {
    const json = ticketListEmbed([ticket({ channelId: null })], 1).toJSON();

    expect(json.description).toContain('channel hilang');
  });
});

describe('parseTicketSubject', () => {
  it('meratakan spasi berulang', () => {
    expect(parseTicketSubject('  tidak   bisa  masuk  ')).toBe('tidak bisa masuk');
  });

  it('memotong ke batas short input Discord', () => {
    expect(parseTicketSubject('x'.repeat(80))).toHaveLength(MODAL_SUBJECT_MAX_LENGTH);
  });

  it('menolak topik kosong atau terlalu pendek', () => {
    expect(() => parseTicketSubject('   ')).toThrow(/minimal 3 karakter/);
    expect(() => parseTicketSubject('ab')).toThrow(/minimal 3 karakter/);
    expect(() => parseTicketSubject(null)).toThrow(/minimal 3 karakter/);
  });

  it('spasi dihitung sebagai karakter setelah diratakan', () => {
    expect(parseTicketSubject('a  b')).toBe('a b');
  });
});

describe('modal tiket', () => {
  it('meminta satu topik wajib dengan batas Discord', () => {
    const json = buildTicketSubjectModal().toJSON();

    expect(json.custom_id).toBe(TICKET_SUBJECT_MODAL);
    const component = (json.components as { components: { type: number; custom_id: string; value?: string; required?: boolean; max_length?: number }[] }[])[0]?.components[0];

    expect(component?.custom_id).toBe('subjek');
    expect(component?.required).toBe(true);
    expect(component?.max_length).toBe(MODAL_SUBJECT_MAX_LENGTH);
  });

  it('hanya menerima customId miliknya sendiri', () => {
    expect(isTicketSubjectModal(TICKET_SUBJECT_MODAL)).toBe(true);
    expect(isTicketSubjectModal('ticket:create')).toBe(false);
    expect(isTicketSubjectModal('setup:save')).toBe(false);
  });

  it('customId tombol tidak tertukar dengan modal', () => {
    expect(parseTicketButtonId(TICKET_SUBJECT_MODAL)).toBeNull();
  });
});

describe('missingTicketConfig', () => {
  const base = {
    ticketCategoryId: CHANNEL_ID,
    ticketStaffRoleId: STAFF_ID,
  } as GuildConfig;

  it('lengkap berarti null', () => {
    expect(missingTicketConfig(base)).toBeNull();
  });

  it('kategori hilang diberi arahan', () => {
    expect(missingTicketConfig({ ...base, ticketCategoryId: null })).toMatch(/Kategori tiket/);
  });

  it('role staff hilang diberi arahan', () => {
    expect(missingTicketConfig({ ...base, ticketStaffRoleId: null })).toMatch(/Role staff/);
  });
});

describe('openTicket', () => {
  interface FakeChannel {
    id: string;
    sent: unknown[];
    send(payload: unknown): Promise<unknown>;
  }

  /** Guild Discord yang dicontoh: butuh channels.create, roles.everyone, members.cache. */
  function makeGuild(createFails: boolean): {
    guild: Guild;
    channel: FakeChannel;
    createdNames: string[];
  } {
    const sent: unknown[] = [];
    const channel: FakeChannel = {
      id: CHANNEL_ID,
      sent,
      send: (payload: unknown) => {
        sent.push(payload);

        return Promise.resolve(payload);
      },
    };

    const createdNames: string[] = [];
    const guild = {
      id: GUILD_ID,
      channels: {
        create: (options: { name: string }) => {
          createdNames.push(options.name);

          return createFails
            ? Promise.reject(new Error('Missing Permissions'))
            : Promise.resolve(channel);
        },
      },
      roles: { everyone: { id: GUILD_ID } },
      members: { cache: new Map([[OPENER_ID, { displayName: 'Sasha Putri' }]]) },
    } as unknown as Guild;

    return { guild, channel, createdNames };
  }

  const input = {
    staffRoleId: STAFF_ID,
    openerId: OPENER_ID,
    subject: 'Tidak bisa masuk voice',
  };

  it('mencatat tiket, membuat channel, dan mengirim embed pembuka', async () => {
    const { repository, service } = makeService();
    const { guild, channel, createdNames } = makeGuild(false);

    const outcome = await openTicket(service, guild, input);

    expect(outcome.ok).toBe(true);
    expect(createdNames).toHaveLength(1);
    expect(createdNames[0]).toContain('sasha-putri');
    expect(repository.rows[0]?.subject).toBe('Tidak bisa masuk voice');
    expect(repository.rows[0]?.channelId).toBe(CHANNEL_ID);
    expect(channel.sent).toHaveLength(1);
  });

  it('member yang sudah punya tiket diarahkan ke channel lama', async () => {
    const { repository, service } = makeService();
    repository.rows.push(ticket({ channelId: CHANNEL_ID }));
    const { guild, createdNames } = makeGuild(false);

    const outcome = await openTicket(service, guild, input);

    expect(outcome).toMatchObject({
      ok: false,
      reason: 'duplicate',
      existingChannelId: CHANNEL_ID,
    });
    expect(createdNames).toHaveLength(0);
  });

  it('kegagalan membuat channel tidak meninggalkan tiket hantu', async () => {
    const { repository, service } = makeService();
    const failing = await openTicket(service, makeGuild(true).guild, input);

    expect(failing).toMatchObject({ ok: false, reason: 'channel_failed' });
    expect(repository.rows[0]?.status).toBe('closed');

    // Tiket hantu sudah tertutup, jadi member boleh mencoba membuka tiket lagi.
    const retry = await openTicket(service, makeGuild(false).guild, input);
    expect(retry.ok).toBe(true);
  });
});

describe('closeAndArchive & transkrip', () => {
  interface FakeTicketChannel {
    id: string;
    isTextBased(): boolean;
    isDMBased(): boolean;
    messages: { fetch: () => Promise<Map<string, unknown>> };
    setName(name: string): Promise<unknown>;
    permissionOverwrites: { edit: () => Promise<unknown> };
    sent: unknown[];
    send(payload: unknown): Promise<unknown>;
  }

  /**
   * Channel tiket tiruan yang mencatat urutan kejadian.
   *
   * `events` dipakai untuk membuktikan transkrip diambil **sebelum** channel
   * diarsipkan — bukan sesudahnya.
   */
  function makeClosedGuild(messageCount: number): {
    guild: Guild;
    events: string[];
  } {
    const events: string[] = [];
    // Discord mengirim pesan terbaru lebih dulu, jadi Map tiruan ini disusun
    // terbalik — kalau tidak, pengujiannya tidak menguji apa pun soal urutan.
    const messages = new Map(
      Array.from({ length: messageCount }, (_, i) => messageCount - 1 - i).map((i) => [
        String(1_000_000_000_000_000_000n + BigInt(i)),
        {
          id: String(1_000_000_000_000_000_000n + BigInt(i)),
          type: 0,
          content: `pesan ${i}`,
          createdAt: new Date(NOW.getTime() + i * 1_000),
          author: { id: OPENER_ID, displayName: 'Sasha Putri' },
          attachments: [],
        },
      ]),
    );

    const channel: FakeTicketChannel = {
      id: CHANNEL_ID,
      isTextBased: () => true,
      isDMBased: () => false,
      messages: {
        fetch: () => {
          events.push('baca-pesan');

          return Promise.resolve(messages as unknown as Map<string, unknown>);
        },
      },
      setName: () => {
        events.push('ganti-nama');

        return Promise.resolve();
      },
      permissionOverwrites: {
        edit: () => {
          events.push('kunci');

          return Promise.resolve();
        },
      },
      sent: [],
      send(payload: unknown) {
        return Promise.resolve(payload);
      },
    };

    const guild = {
      id: GUILD_ID,
      roles: { everyone: { id: GUILD_ID } },
      channels: {
        fetch: () => Promise.resolve(channel),
        cache: new Map([[CHANNEL_ID, channel]]),
      },
    } as unknown as Guild;

    // `archiveTicketChannel` menulis lewat `channel.guild`, jadi channel tiruan
    // butuh arah balik ke guild-nya.
    (channel as unknown as { guild: Guild }).guild = guild;

    return { guild, events };
  }

  async function seedClosedTicket(): Promise<{
    repository: FakeTicketRepository;
    service: TicketService;
  }> {
    const { repository, service } = makeService();
    const opened = await service.open(
      { guildId: GUILD_ID, openerId: OPENER_ID, subject: 'Bantuan' },
      NOW,
    );
    await service.attachChannel(opened.ticket.id, CHANNEL_ID);

    return { repository, service };
  }

  it('transkrip diambil lalu disimpan di tiket yang ditutup', async () => {
    const { repository, service } = await seedClosedTicket();
    const { guild } = makeClosedGuild(3);

    const result = await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    expect(result?.transcriptSaved).toBe(true);
    expect(repository.rows[0]?.transcript?.messageCount).toBe(3);
    expect(repository.rows[0]?.transcript?.messages[0]?.content).toBe('pesan 0');
  });

  it('transkrip diambil SEBELUM channel diarsipkan', async () => {
    const { service } = await seedClosedTicket();
    const { guild, events } = makeClosedGuild(2);

    await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    // Urutan ini yang menjamin bot masih punya akses baca saat pesan diambil.
    expect(events.indexOf('baca-pesan')).toBeLessThan(events.indexOf('ganti-nama'));
  });

  it('kegagalan menyimpan transkrip tidak menggagalkan penutupan', async () => {
    const { repository, service } = await seedClosedTicket();
    repository.transcriptError = new Error('Database tidak bisa dihubungi');
    const { guild } = makeClosedGuild(2);

    const result = await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    expect(result).not.toBeNull();
    expect(result?.ticket.status).toBe('closed');
    expect(result?.transcriptSaved).toBe(false);
  });

  it('channel yang hilang ditutup tanpa transkrip, bukan menggagalkan', async () => {
    const { service } = await seedClosedTicket();
    const guild = {
      id: GUILD_ID,
      channels: { fetch: () => Promise.reject(new Error('Unknown Channel')) },
    } as unknown as Guild;

    const result = await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    expect(result?.ticket.status).toBe('closed');
    expect(result?.channel).toBeNull();
    expect(result?.transcriptSaved).toBe(false);
  });

  it('tiket yang sudah tertutup tidak ditutup dua kali', async () => {
    const { service } = await seedClosedTicket();
    const { guild } = makeClosedGuild(1);
    await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    expect(await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW)).toBeNull();
  });

  it('findAnyByChannel menemukan tiket yang sudah ditutup', async () => {
    const { service } = await seedClosedTicket();
    const { guild } = makeClosedGuild(1);
    await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    // Channel tiket sudah diarsipkan, tapi di sinilah transkrip dibuka.
    const found = await service.findAnyByChannel(GUILD_ID, CHANNEL_ID);

    expect(found?.status).toBe('closed');
    expect(found?.transcript?.messageCount).toBe(1);
  });

  it('findByNumber menemukan tiket tertutup', async () => {
    const { service } = await seedClosedTicket();
    const { guild } = makeClosedGuild(1);
    await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    const found = await service.findByNumber(GUILD_ID, 1);

    expect(found?.status).toBe('closed');
    expect(found?.transcript).not.toBeNull();
  });

  it('transkrip hilang bersama tiketnya saat retensi berjalan', async () => {
    const { service } = await seedClosedTicket();
    const { guild } = makeClosedGuild(1);
    await closeAndArchive(service, guild, CHANNEL_ID, STAFF_ID, NOW);

    // Retensi menghapus baris tiket; karena transkrip disimpan di baris yang
    // sama, tidak ada data percakapan yang bisa tertinggal.
    const purged = await service.purgeExpired(new Date('2028-01-01T00:00:00.000Z'));

    expect(purged.ticketsDeleted).toBe(1);
    expect(await service.findByNumber(GUILD_ID, 1)).toBeNull();
  });
});
