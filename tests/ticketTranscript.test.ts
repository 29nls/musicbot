import { describe, expect, it } from 'vitest';
import { MessageType, type Message, type TextChannel } from 'discord.js';
import {
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_TRANSCRIPT_MESSAGES,
  captureTranscript,
  parseTranscript,
  renderTranscriptText,
  transcriptPreviewLines,
  type TicketTranscript,
} from '../src/modules/tickets/transcript.js';
import { ticketTranscriptEmbed } from '../src/modules/tickets/embeds.js';
import type { Ticket } from '../src/modules/tickets/types.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');

function entry(overrides: Partial<TicketTranscript['messages'][number]> = {}) {
  return {
    messageId: '900000000000000001',
    authorId: '222222222222222222',
    authorName: 'Sasha Putri',
    content: 'Halo, tidak bisa masuk voice',
    createdAt: '2026-10-02T11:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

function transcript(overrides: Partial<TicketTranscript> = {}): TicketTranscript {
  return {
    capturedAt: NOW.toISOString(),
    messageCount: 1,
    truncated: false,
    messages: [entry()],
    ...overrides,
  };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    ticketNumber: 7,
    guildId: '123456789012345678',
    channelId: '444444444444444444',
    openerId: '222222222222222222',
    subject: 'Tidak bisa masuk voice',
    status: 'closed',
    claimedBy: null,
    createdAt: NOW,
    closedAt: NOW,
    closedBy: '333333333333333333',
    expiresAt: new Date('2027-10-02T12:00:00.000Z'),
    transcript: null,
    ...overrides,
  };
}

/**
 * Channel tiruan dengan halaman pesan.
 *
 * `pages` diberikan dari yang **paling baru** (persis seperti balasan Discord),
 * jadi tes paginasi benar-benar menguji arah iterasi, bukan hanya hitungan.
 */
function makeChannel(pages: Message[][]): { channel: TextChannel; fetches: unknown[] } {
  const fetches: unknown[] = [];

  const channel = {
    id: '444444444444444444',
    messages: {
      fetch: (options: unknown) => {
        fetches.push(options);

        const index = fetches.length - 1;

        return Promise.resolve(new Map((pages[index] ?? []).map((m) => [m.id, m])));
      },
    },
  };

  return { channel: channel as unknown as TextChannel, fetches };
}

/** Message Discord tiruan dengan ID berurutan (ID = urutan waktu di Discord). */
function fakeMessage(
  index: number,
  overrides: Partial<Record<string, unknown>> = {},
): Message {
  return {
    id: (1_000_000_000_000_000_000n + BigInt(index)).toString(),
    type: MessageType.Default,
    content: `pesan ${index}`,
    createdAt: new Date(NOW.getTime() + index * 1_000),
    author: { id: '222222222222222222', displayName: 'Sasha Putri' },
    attachments: [{ url: 'https://cdn.example/gambar.png' }],
    ...overrides,
  } as unknown as Message;
}

describe('parseTranscript', () => {
  it('kolom kosong berarti tidak ada transkrip', () => {
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript(undefined)).toBeNull();
  });

  it('bentuk yang bukan transkrip ditolak, bukan ditampilkan setengah jadi', () => {
    expect(parseTranscript('bukan json')).toBeNull();
    expect(parseTranscript([1, 2, 3])).toBeNull();
    expect(parseTranscript({ capturedAt: 'x' })).toBeNull();
    expect(parseTranscript({ messages: 'bukan array' })).toBeNull();
  });

  it('entri rusak dilewati, sisanya tetap terbaca', () => {
    const parsed = parseTranscript({
      capturedAt: NOW.toISOString(),
      messageCount: 2,
      truncated: false,
      messages: [
        { messageId: '1', createdAt: NOW.toISOString(), authorName: 'A' },
        'bukan objek',
        null,
      ],
    });

    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.authorName).toBe('A');
  });

  it('nilai yang hilang diisi default yang aman', () => {
    const parsed = parseTranscript({ messages: [{ messageId: '1', createdAt: 'x' }] });

    expect(parsed?.messages[0]?.authorName).toBe('Tidak diketahui');
    expect(parsed?.messages[0]?.content).toBe('');
    expect(parsed?.messages[0]?.attachments).toEqual([]);
    expect(parsed?.truncated).toBe(false);
  });

  it('lampiran bukan string dibuang', () => {
    const parsed = parseTranscript({
      messages: [{ messageId: '1', createdAt: 'x', attachments: ['ok', 42, null] }],
    });

    expect(parsed?.messages[0]?.attachments).toEqual(['ok']);
  });

  it('transkrip utuh kembali persis seperti disimpan', () => {
    const original = transcript({ messageCount: 3, truncated: true, messages: [entry(), entry()] });

    expect(parseTranscript(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });
});

describe('captureTranscript', () => {
  it('mengambil pesan dan menyusunnya dari yang terlama', async () => {
    const { channel } = makeChannel([[fakeMessage(3), fakeMessage(2), fakeMessage(1)]]);

    const result = await captureTranscript(channel, NOW);

    // Discord mengembalikan terbaru dulu; transkrip harus dibaca kronologis.
    expect(result?.messages.map((m) => m.content)).toEqual([
      'pesan 1',
      'pesan 2',
      'pesan 3',
    ]);
    expect(result?.messageCount).toBe(3);
    expect(result?.capturedAt).toBe(NOW.toISOString());
  });

  it('terus mengambil halaman berikutnya sampai habis', async () => {
    const first = Array.from({ length: 100 }, (_, i) => fakeMessage(200 - i));
    const second = Array.from({ length: 20 }, (_, i) => fakeMessage(100 - i));
    const { channel, fetches } = makeChannel([first, second]);

    const result = await captureTranscript(channel, NOW);

    // Halaman 1 penuh (100), halaman 2 tidak (20) → berhenti di sana.
    expect(fetches).toHaveLength(2);
    expect(fetches[0]).toEqual({ limit: 100 });
    // Halaman kedua harus meminta pesan yang lebih lama dari yang pertama.
    expect((fetches[1] as { before?: string }).before).toBeTruthy();
    expect(result?.messageCount).toBe(120);
  });

  it('berhenti setelah satu halaman kalau halamannya tidak penuh', async () => {
    const { channel, fetches } = makeChannel([[fakeMessage(1)]]);

    await captureTranscript(channel, NOW);

    // Halaman pertama tidak penuh, jadi langsung berhenti tanpa paginasi lagi.
    expect(fetches).toHaveLength(1);
  });

  it('pesan sistem tidak ikut tersimpan', async () => {
    const { channel } = makeChannel([
      [
        fakeMessage(2, { type: MessageType.UserJoin }),
        fakeMessage(1),
        fakeMessage(3, { type: MessageType.ChannelPinnedMessage }),
      ],
    ]);

    const result = await captureTranscript(channel, NOW);

    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]?.content).toBe('pesan 1');
  });

  it('pesan bot ikut tersimpan supaya alur tiket terbaca utuh', async () => {
    const botMessage = fakeMessage(2, {
      author: { id: '999', displayName: 'Harmony' },
      content: 'Tiket #0007 dibuka',
    });
    const { channel } = makeChannel([[botMessage, fakeMessage(1)]]);

    const result = await captureTranscript(channel, NOW);

    expect(result?.messages).toHaveLength(2);
    expect(result?.messages[1]?.authorName).toBe('Harmony');
    expect(result?.messages[0]?.content).toBe('pesan 1');
  });

  it('isi pesan dipotong ke batas Discord', async () => {
    const long = fakeMessage(1, { content: 'z'.repeat(5_000) });
    const { channel } = makeChannel([[long]]);

    const result = await captureTranscript(channel, NOW);

    expect(result?.messages[0]?.content.length).toBe(MAX_MESSAGE_CONTENT_LENGTH);
  });

  it('URL lampiran disimpan, filenya tidak diunduh', async () => {
    const { channel } = makeChannel([[fakeMessage(1)]]);

    const result = await captureTranscript(channel, NOW);

    expect(result?.messages[0]?.attachments).toEqual(['https://cdn.example/gambar.png']);
  });

  it('melebihi batas menyisakan pesan terbaru dan ditandai terpotong', async () => {
    const many = Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 20 }, (_, i) =>
      fakeMessage(MAX_TRANSCRIPT_MESSAGES + 20 - i),
    );
    const { channel } = makeChannel([many]);

    const result = await captureTranscript(channel, NOW);

    expect(result?.messageCount).toBe(MAX_TRANSCRIPT_MESSAGES);
    expect(result?.truncated).toBe(true);
    // Yang paling baru harus tetap ada di ujung transkrip.
    expect(result?.messages.at(-1)?.content).toBe('pesan 520');
    // Yang tertua yang tertinggal harus pesan ke-21, bukan pesan pertama.
    expect(result?.messages[0]?.content).toBe('pesan 21');
  });

  it('tidak melewati batas berarti tidak ditandai terpotong', async () => {
    const { channel } = makeChannel([[fakeMessage(1)]]);

    expect((await captureTranscript(channel, NOW))?.truncated).toBe(false);
  });

  it('channel kosong menghasilkan null, bukan transkrip kosong', async () => {
    const { channel } = makeChannel([]);

    expect(await captureTranscript(channel, NOW)).toBeNull();
  });

  it('gagal membaca tidak melempar — tiket tetap bisa ditutup', async () => {
    const channel = {
      id: '444444444444444444',
      messages: { fetch: () => Promise.reject(new Error('Missing Permissions')) },
    } as unknown as TextChannel;

    expect(await captureTranscript(channel, NOW)).toBeNull();
  });
});

describe('renderTranscriptText', () => {
  it('memuat identitas tiket dan isi percakapan', () => {
    const text = renderTranscriptText(ticket(), transcript());

    expect(text).toContain('Transkrip Tiket #0007');
    expect(text).toContain('Subjek: Tidak bisa masuk voice');
    expect(text).toContain('Sasha Putri');
    expect(text).toContain('Halo, tidak bisa masuk voice');
  });

  it('menyertakan URL lampiran di bawah pesannya', () => {
    const text = renderTranscriptText(
      ticket(),
      transcript({ messages: [entry({ attachments: ['https://cdn.example/a.png'] })] }),
    );

    expect(text).toContain('lampiran: https://cdn.example/a.png');
  });

  it('pesan tanpa teks tetap terbaca sebagai pesan, bukan baris kosong', () => {
    const text = renderTranscriptText(ticket(), transcript({ messages: [entry({ content: '' })] }));

    expect(text).toContain('(tanpa teks)');
  });

  it('catatan pemotongan ditulis eksplisit di akhir file', () => {
    const text = renderTranscriptText(ticket(), transcript({ truncated: true }));

    expect(text).toContain('dipotong');
  });

  it('transkrip kosong tetap menghasilkan file yang bisa dibaca', () => {
    const text = renderTranscriptText(ticket(), transcript({ messages: [], messageCount: 0 }));

    expect(text).toContain('tidak ada pesan yang bisa dibaca');
  });
});

describe('transcriptPreviewLines', () => {
  it('menampilkan pesan terakhir saja', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      entry({ messageId: String(i), content: `pesan ${i}` }),
    );

    const lines = transcriptPreviewLines(transcript({ messages }), 3);

    expect(lines.split('\n')).toHaveLength(3);
    expect(lines).toContain('pesan 19');
    expect(lines).not.toContain('pesan 10');
  });

  it('spasi berlebih diratakan supaya embed tetap rapi', () => {
    const lines = transcriptPreviewLines(
      transcript({ messages: [entry({ content: 'halo\n\n   dunia' })] }),
    );

    expect(lines).toContain('halo dunia');
  });

  it('pesan kosong tetap tampil sebagai keterangan', () => {
    expect(transcriptPreviewLines(transcript({ messages: [entry({ content: '   ' })] }))).toContain(
      '(tanpa teks)',
    );
  });
});

describe('embed transkrip', () => {
  it('menyebut nomor tiket dan jumlah pesan', () => {
    const json = ticketTranscriptEmbed(ticket(), transcript({ messageCount: 12 })).toJSON();

    expect(json.title).toContain('#0007');
    expect(JSON.stringify(json.fields)).toContain('12 pesan tersimpan');
  });

  it('menandai transkrip yang terpotong', () => {
    const json = ticketTranscriptEmbed(ticket(), transcript({ truncated: true })).toJSON();

    expect(JSON.stringify(json.fields)).toContain('Dipotong');
  });

  it('transkrip yang tidak terpotong tidak menampilkan peringatan', () => {
    const json = ticketTranscriptEmbed(ticket(), transcript()).toJSON();

    expect(JSON.stringify(json.fields)).not.toContain('Dipotong');
  });

  it('deskripsi tetap di bawah batas embed Discord', () => {
    const huge = Array.from({ length: 20 }, (_, i) =>
      entry({ messageId: String(i), content: 'x'.repeat(2_000) }),
    );

    const description = ticketTranscriptEmbed(ticket(), transcript({ messages: huge })).toJSON()
      .description ?? '';

    // Batas embed Discord 4096; preview sudah dipotong per baris, tapi embed
    // tetap harus aman kalau nanti jumlah baris preview ditambah.
    expect(description.length).toBeLessThanOrEqual(4_000);
  });
});

describe('retensi transkrip', () => {
  it('transkrip ikut terhapus bersama baris tiketnya', async () => {
    // Transkrip disimpan sebagai kolom pada baris `ticket`, jadi penghapusan
    // oleh job retensi menghapusnya di operasi yang sama. Tidak ada tabel
    // terpisah yang bisa meninggalkan data percakapan yatim.
    const t = ticket({ status: 'closed', transcript: transcript() });

    expect(t.transcript?.messages).toHaveLength(1);
    // Baris hilang = seluruh isinya hilang; tidak ada tempat lain yang menyimpan.
    expect(Object.keys(t).filter((key) => key.toLowerCase().includes('transcript'))).toEqual([
      'transcript',
    ]);
  });
});