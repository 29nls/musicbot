import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  TicketValidationError,
  buildCreateButton,
  buildTicketControls,
  buildTicketSubjectModal,
  missingTicketConfig,
  parseTicketSubject,
  renderTranscriptText,
  ticketClosedEmbed,
  ticketListEmbed,
  ticketOpenedEmbed,
  ticketPanelEmbed,
  ticketTranscriptEmbed,
  transcriptPreviewLines,
  type Ticket,
  type TicketTranscript,
} from '../src/modules/tickets/index.js';
import { translator } from '../src/modules/i18n/index.js';
import type { GuildConfig } from '../src/modules/config/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

const GUILD_ID = '123456789012345678';
const OPENER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const NOW = new Date('2026-10-02T12:00:00.000Z');

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    ticketNumber: 7,
    guildId: GUILD_ID,
    channelId: '444444444444444444',
    openerId: OPENER_ID,
    subject: 'Tidak bisa masuk voice',
    status: 'closed',
    claimedBy: null,
    createdAt: NOW,
    closedAt: NOW,
    closedBy: STAFF_ID,
    expiresAt: new Date('2027-10-02T12:00:00.000Z'),
    transcript: null,
    ...overrides,
  };
}

function transcript(overrides: Partial<TicketTranscript> = {}): TicketTranscript {
  return {
    capturedAt: NOW.toISOString(),
    messageCount: 1,
    truncated: false,
    messages: [
      {
        messageId: '900000000000000001',
        authorId: OPENER_ID,
        authorName: 'Sasha Putri',
        content: 'Halo, tidak bisa masuk voice',
        createdAt: '2026-10-02T11:00:00.000Z',
        attachments: [],
      },
    ],
    ...overrides,
  };
}

interface EmbedData {
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

/** Seluruh teks embed apa adanya, supaya tidak ada bagian yang lolos dari cek. */
function embedText(embed: EmbedBuilder): string {
  const data = embed.toJSON() as EmbedData;
  const parts: string[] = [];

  for (const key of ['title', 'description', 'footer'] as const) {
    const value = data[key];
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object' && 'text' in value) {
      parts.push(String((value as { text: unknown }).text));
    }
  }

  for (const field of data.fields ?? []) {
    parts.push(String(field.name ?? ''), String(field.value ?? ''));
  }

  return parts.join('\n');
}

describe('tiket dalam bahasa Inggris', () => {
  it('panel memakai judul, penjelasan privasi, dan footer bahasa server', () => {
    const text = embedText(ticketPanelEmbed({ staffRoleId: STAFF_ID, description: null }, en));

    expect(text).toContain('Need Help?');
    expect(text).toContain('Click the button below');
    expect(text).toContain('Only you and the staff team');
    expect(text).toContain(`<@&${STAFF_ID}>`);
    expect(text).toContain('one open ticket');

    expect(text).not.toContain('Butuh Bantuan');
  });

  it('tombol panel & tiket memakai label bahasa server', () => {
    const create = buildCreateButton(en).toJSON().components[0] as { label?: string };
    const controls = buildTicketControls(en).toJSON().components as { label?: string }[];

    expect(create.label).toBe('Create Ticket');
    expect(controls.map((button) => button.label)).toEqual(['Claim', 'Close Ticket']);
  });

  it('embed pembukaan menyebut pembuat, staff, dan subjek dalam bahasa server', () => {
    const text = embedText(ticketOpenedEmbed(ticket({ status: 'open', closedAt: null }), STAFF_ID, en));

    expect(text).toContain('Ticket #0007 opened');
    expect(text).toContain('Opened by');
    expect(text).toContain(`<@${OPENER_ID}>`);
    expect(text).toContain('Subject');
    expect(text).toContain('Tidak bisa masuk voice');
  });

  it('embed penutupan memakai kalimat bahasa server', () => {
    const text = embedText(ticketClosedEmbed(ticket(), STAFF_ID, en));

    expect(text).toContain('Ticket #0007 closed');
    expect(text).toContain('locked and can no longer be used');
    expect(text).toContain('Closed by');
  });

  it('daftar tiket memakai status, jumlah, dan penanda channel hilang bahasa server', () => {
    const text = embedText(
      ticketListEmbed([ticket({ status: 'open', claimedBy: STAFF_ID })], 5, en),
    );

    expect(text).toContain('Open Tickets');
    expect(text).toContain('handled by');
    expect(text).toContain('5 open tickets');

    const missing = embedText(ticketListEmbed([ticket({ channelId: null })], 1, en));
    expect(missing).toContain('channel missing');
  });

  it('daftar kosong memberi kabar baik dalam bahasa server', () => {
    expect(embedText(ticketListEmbed([], 0, en))).toContain('No open tickets');
  });

  it('embed transkrip memakai judul dan field bahasa server', () => {
    const text = embedText(ticketTranscriptEmbed(ticket(), transcript({ truncated: true }), en));

    expect(text).toContain('Ticket Transcript #0007');
    expect(text).toContain('Opened by:');
    expect(text).toContain('1 messages stored');
    expect(text).toContain('Truncated');
    expect(text).toContain('Last 1 messages');
  });

  it('modal tiket memakai judul, label, dan placeholder bahasa server', () => {
    const json = buildTicketSubjectModal(en).toJSON();
    const component = (
      json.components as { components: { label?: string; placeholder?: string }[] }[]
    )[0]?.components[0];

    expect(json.title).toBe('Create Ticket');
    expect(component?.label).toBe('Ticket subject');
    expect(component?.placeholder).toBe('Example: cannot join a voice channel');
  });

  it('file transkrip ditulis dalam bahasa server', () => {
    const text = renderTranscriptText(ticket(), transcript(), en);

    expect(text).toContain('Ticket Transcript #0007');
    expect(text).toContain('Subject: Tidak bisa masuk voice');
    expect(text).toContain(`Opened by: ${OPENER_ID}`);
    expect(text).toContain('Messages stored: 1');
    expect(text).toContain('Sasha Putri');

    expect(text).not.toContain('Transkrip Tiket');
  });

  it('transkrip yang terpotong menjelaskan batasnya dalam bahasa server', () => {
    const text = renderTranscriptText(ticket(), transcript({ truncated: true }), en);

    expect(text).toContain('truncated to the last');
    expect(text).toContain('older conversation was not stored');
  });

  it('pesan tanpa teks dan transkrip kosong punya kalimat bahasa server', () => {
    const empty = transcript({ messages: [], messageCount: 0 });
    const noText = transcript({ messages: [{ ...transcript().messages[0]!, content: '' }] });

    expect(renderTranscriptText(ticket(), empty, en)).toContain('(no readable messages)');
    expect(renderTranscriptText(ticket(), noText, en)).toContain('(no text)');
    expect(transcriptPreviewLines(noText, 8, en)).toContain('(no text)');
  });

  it('pesan validasi & konfigurasi tampil dalam bahasa server', () => {
    const short = new TicketValidationError('ticket.err.subjectTooShort', { min: 3 });
    const base = { ticketCategoryId: '5', ticketStaffRoleId: STAFF_ID } as GuildConfig;

    expect(en(short.key, short.params)).toContain('at least 3 characters');
    expect(missingTicketConfig({ ...base, ticketCategoryId: null }, en)).toContain(
      'category is not set',
    );
    expect(missingTicketConfig({ ...base, ticketStaffRoleId: null }, en)).toContain(
      'staff role is not set',
    );
  });
});

describe('tiket tanpa penerjemah', () => {
  it('nilai bawaannya persis bahasa Indonesia seperti sebelum ada i18n', () => {
    const text = embedText(ticketPanelEmbed({ staffRoleId: STAFF_ID, description: null }));

    expect(text).toContain('Butuh Bantuan');
    expect(text).toContain('privat');
    expect(text).toContain('satu tiket terbuka');
  });

  it('katalog Indonesia dan nilai bawaan menghasilkan teks yang sama', () => {
    expect(embedText(ticketPanelEmbed({ staffRoleId: STAFF_ID, description: null }))).toBe(
      embedText(ticketPanelEmbed({ staffRoleId: STAFF_ID, description: null }, id)),
    );
    expect(embedText(ticketListEmbed([ticket()], 1))).toBe(
      embedText(ticketListEmbed([ticket()], 1, id)),
    );
    expect(renderTranscriptText(ticket(), transcript())).toBe(
      renderTranscriptText(ticket(), transcript(), id),
    );
    expect(transcriptPreviewLines(transcript())).toBe(transcriptPreviewLines(transcript(), 8, id));
  });

  it('error validasi tetap membawa kalimat Indonesia di `message`', () => {
    expect(() => parseTicketSubject('ab')).toThrow('minimal 3 karakter');
  });
});

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul tiket', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul dan nama field embed selalu lewat penerjemah', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/tickets')) {
      const name = basename(file);
      if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const patterns = [/setTitle\(\s*'([^']*)'/g, /(?:title|name):\s*'([^']*)'/g];
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(name + ' -> ' + match[0]);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('embed balasan tidak pernah menerima kalimat jadi', () => {
    const offenders: string[] = [];

    for (const file of [...(COMMAND_FILES as string[])]) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(
        /(?:warningEmbed|successEmbed|infoEmbed|errorEmbed)\(\s*'([^']*)'/g,
      )) {
        offenders.push(basename(file) + ' -> ' + match[0]);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/tickets'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('allow-list hanya berisi penanda yang benar-benar ada', () => {
    const source = stripComments(readFileSync('src/modules/tickets/transcript.ts', 'utf8'));

    for (const marker of DILEHKAN['transcript.ts'] ?? []) {
      expect(source).toContain(marker);
    }
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Tiket ini sudah ditutup dan tidak bisa dipakai lagi.')).toBe(true);
    expect(looksIndonesian('Kamu sudah punya tiket terbuka di server ini.')).toBe(true);

    expect(looksIndonesian('Create Ticket')).toBe(false);
    expect(looksIndonesian('Role not found')).toBe(false);
    expect(looksIndonesian('ticket.cmd.noTicket')).toBe(false);

    expect(looksCode('ticket.cmd.noTicket')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Ticket closed')).toBe(false);
  });
});

/**
 * Berkas modul tiket yang teks runtime-nya sudah ikut katalog.
 *
 * `repository.ts`, `mapping.ts`, `service.ts`, `retention.ts`, `naming.ts`,
 * `types.ts`, `singleton.ts`, dan `index.ts` sengaja tidak masuk: teksnya hanya
 * untuk logger internal, bukan untuk member.
 */
const SUDAH_DITERJEMAHKAN = [
  'buttons.ts',
  'embeds.ts',
  'errors.ts',
  'lifecycle.ts',
  'modal.ts',
  'transcript.ts',
  'validation.ts',
];

/**
 * Berkas yang memang masih boleh berisi satu kalimat Indonesia.
 *
 * `transcript.ts` menyimpan `'Tidak diketahui'` sebagai nama penulis cadangan
 * ketika kolom JSON lama tidak punya nama. Teks itu **tersimpan di database**,
 * jadi menerjemahkannya saat parse akan menulis bahasa server yang kebetulan
 * sedang aktif ke data yang dibaca server lain — lebih baik dibiarkan netral.
 */
const DILEHKAN: Record<string, string[]> = {
  'transcript.ts': ['Tidak diketahui'],
};

/** Berkas yang menyusun embed balasan; literal di sini tidak boleh lolos. */
const COMMAND_FILES = [
  'src/modules/tickets/buttons.ts',
  'src/modules/tickets/modal.ts',
  'src/commands/admin/ticket.ts',
];

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/tickets');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    const name = basename(file);
    if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

    const allowList = DILEHKAN[name] ?? [];
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of [...stringLiterals(source), ...templateFragments(source)]) {
      if (allowList.some((marker) => literal.includes(marker))) continue;
      if (looksIndonesian(literal)) offenders.push({ file, literal });
    }
  }

  return offenders;
}

/** Buang komentar baris dan blok, sisakan string yang benar-benar dipakai. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** String literal satu maupun dua kutip, apa adanya isinya. */
function stringLiterals(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
    const value = match[1] ?? match[2];
    if (value) found.push(value);
  }

  return found;
}

/**
 * Bagian statis dari template literal, dipecah per baris.
 *
 * Ekspresi `${…}` dibuang karena kalimat yang bocor ke template literal
 * biasanya pieces-nya yang salah, bukan keseluruhan template-nya.
 */
function templateFragments(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const body = match[1];
    if (!body) continue;

    for (const fragment of body.replace(/\$\{[^}]*\}/g, '\n').split('\n')) {
      const trimmed = fragment.trim();
      if (trimmed) found.push(trimmed);
    }
  }

  return found;
}

/** Kunci katalog dan URL bukan kalimat, meski isinya huruf. */
function looksCode(literal: string): boolean {
  return /^https?:\/\//.test(literal) || /^[\w.:/<>-]+$/.test(literal);
}

/** Kata penanda kalimat Bahasa Indonesia. */
const STOPWORDS = [
  ' tidak ',
  ' sudah ',
  ' belum ',
  ' dengan ',
  ' untuk ',
  ' harus ',
  ' dari ',
  ' yang ',
  ' bisa ',
  ' atau ',
  ' sebelum ',
  ' dan ',
  ' tanpa ',
  ' tentang ',
  ' member ',
  ' server ',
  ' di sini',
];

/** Heuristik kasar "kayaknya kalimat Bahasa Indonesia". */
function looksIndonesian(literal: string): boolean {
  if (literal.length < 15) return false;
  if (looksCode(literal)) return false;
  if (!literal.includes(' ')) return false;

  const lower = ` ${literal.toLowerCase()} `;
  const hits = STOPWORDS.filter((word) => lower.includes(word.toLowerCase())).length;

  return hits >= 2;
}
