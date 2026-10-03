import { describe, expect, it, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { queueEmbed } from '../src/modules/music/embeds.js';
import {
  QUEUE_PAGE_SIZE,
  buildQueuePage,
  clampQueuePage,
  parseQueuePageCustomId,
  queuePageCustomId,
  totalQueuePages,
} from '../src/modules/music/queuePage.js';
import { handleQueuePage, queueNavRow, type QueueNavDeps } from '../src/modules/music/queueNav.js';
import type { QueueSnapshot, TrackInfo } from '../src/modules/music/types.js';

const GUILD_ID = '123456789012345678';

function track(index: number, durationMs = 200_000): TrackInfo {
  return {
    encoded: `encoded-${index}`,
    title: `Lagu ${index}`,
    author: 'Artis',
    durationMs,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
  };
}

function tracks(count: number): TrackInfo[] {
  return Array.from({ length: count }, (_, index) => track(index + 1));
}

function snapshot(count: number, current: TrackInfo | null = null): QueueSnapshot {
  const upcoming = tracks(count);

  return {
    guildId: GUILD_ID,
    current,
    upcoming,
    upcomingDurationMs: upcoming.reduce((total, item) => total + item.durationMs, 0),
    paused: false,
    positionMs: 0,
    volume: 100,
    idleRemainingMs: null,
    loopMode: 'off',
    filterMode: 'off',
  };
}

/** Interaksi tombol palsu yang mencatat update dan reply. */
function fakeButton(customId: string, options: { inGuild?: boolean; updateFails?: boolean } = {}) {
  const updates: Array<{ embeds: unknown[]; components: unknown[] }> = [];
  const replies: Array<{ embeds: unknown[] }> = [];
  const editReplies: Array<{ embeds: unknown[] }> = [];

  const interaction = {
    customId,
    guildId: GUILD_ID,
    user: { id: '999999999999999999' },
    replied: false,
    deferred: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    inCachedGuild: () => options.inGuild ?? true,
    guild: undefined,
    member: undefined,
    update: async (payload: { embeds: unknown[]; components: unknown[] }) => {
      if (options.updateFails) throw new Error('Interaction Update sudah lewat');
      updates.push(payload);
    },
    reply: async (payload: { embeds: unknown[] }) => {
      replies.push(payload);
    },
    editReply: async (payload: { embeds: unknown[] }) => {
      editReplies.push(payload);
    },
  };

  return {
    interaction: interaction as unknown as ButtonInteraction,
    updates,
    replies,
    editReplies,
  };
}

describe('perhitungan halaman antrean', () => {
  it('sepuluh lagu per halaman sesuai AC §8 US-02', () => {
    expect(QUEUE_PAGE_SIZE).toBe(10);
    expect(totalQueuePages(10)).toBe(1);
    expect(totalQueuePages(11)).toBe(2);
    expect(totalQueuePages(25)).toBe(3);
  });

  it('antrean kosong tetap punya satu halaman', () => {
    expect(totalQueuePages(0)).toBe(1);
  });

  it('halaman dijepit ke rentang yang benar', () => {
    expect(clampQueuePage(3, 5)).toBe(3);
    expect(clampQueuePage(99, 5)).toBe(5);
    expect(clampQueuePage(0, 5)).toBe(1);
    expect(clampQueuePage(-4, 5)).toBe(1);
    expect(clampQueuePage(Number.NaN, 5)).toBe(1);
  });

  it('halaman kedua berisi potongan yang benar dan tahu indeks mulainya', () => {
    const page = buildQueuePage(tracks(25), 2);

    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.items).toHaveLength(10);
    expect(page.items[0]?.title).toBe('Lagu 11');
    expect(page.startIndex).toBe(10);
    // 15 = 25 lagu dikurangi 10 yang tampil di halaman ini.
    expect(page.hiddenCount).toBe(15);
  });

  it('halaman terakhir berisi sisanya, bukan 10 baris kosong', () => {
    const page = buildQueuePage(tracks(25), 3);

    expect(page.items).toHaveLength(5);
    expect(page.items[0]?.title).toBe('Lagu 21');
  });

  it('halaman terakhir yang diklik setelah antrean menyusut dijepit, bukan kosong', () => {
    const page = buildQueuePage(tracks(12), 5);

    expect(page.page).toBe(2);
    expect(page.items).toHaveLength(2);
  });

  it('satu halaman penuh tidak pernah disembunyikan sebagai kosong', () => {
    const page = buildQueuePage(tracks(10), 1);

    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(10);
    expect(page.hiddenCount).toBe(0);
  });
});

describe('customId halaman', () => {
  it('berisi nomor halaman saja, bukan data lagu', () => {
    const id = queuePageCustomId(3);

    expect(id).toBe('queue:p:3');
    expect(id).not.toContain('Lagu');
  });

  it('nomor halaman dibaca kembali', () => {
    expect(parseQueuePageCustomId(queuePageCustomId(7))).toBe(7);
  });

  it('customId milik fitur lain atau rusak ditolak', () => {
    expect(parseQueuePageCustomId('ticket:create')).toBeNull();
    expect(parseQueuePageCustomId('queue:p:abc')).toBeNull();
    expect(parseQueuePageCustomId('queue:p:0')).toBeNull();
    expect(parseQueuePageCustomId('queue:p:-1')).toBeNull();
    expect(parseQueuePageCustomId('queue:p:999999')).toBeNull();
    expect(parseQueuePageCustomId('queue:page:2')).toBeNull();
  });

  it('customId yang berisi muatan aneh tidak pernah diteruskan ke perhitungan', () => {
    expect(parseQueuePageCustomId('queue:p:2;DROP TABLE')).toBeNull();
  });
});

describe('embed antrean berhalaman', () => {
  function fieldValue(embed: ReturnType<typeof queueEmbed>, prefix: string): string {
    const fields = embed.toJSON().fields ?? [];

    return fields.find((field) => (field.name ?? '').startsWith(prefix))?.value ?? '';
  }

  function fieldName(embed: ReturnType<typeof queueEmbed>, prefix: string): string {
    const fields = embed.toJSON().fields ?? [];

    return fields.find((field) => (field.name ?? '').startsWith(prefix))?.name ?? '';
  }

  it('nomor dihitung dari posisi di antrean utuh, bukan dari isi halaman', () => {
    const data = snapshot(25, track(0));
    const embed = queueEmbed(data, buildQueuePage(data.upcoming, 3));

    expect(fieldValue(embed, 'Berikutnya')).toContain('`21.`');
    expect(fieldValue(embed, 'Berikutnya')).toContain('`25.`');
  });

  it('menyebutkan halaman sekarang dan totalnya', () => {
    const data = snapshot(25, track(0));
    const embed = queueEmbed(data, buildQueuePage(data.upcoming, 2));

    // Nomor halaman ada di nama field, bukan di daftar lagu.
    expect(fieldName(embed, 'Berikutnya')).toContain('halaman 2/3');
    expect(embed.toJSON().footer?.text).toContain('15 lagu lain');
  });

  it('tanpa halaman eksplisit, embed tetap memotong dari lagu pertama', () => {
    const embed = queueEmbed(snapshot(25, track(0)));

    expect(fieldValue(embed, 'Berikutnya')).toContain('`1.`');
    expect(fieldValue(embed, 'Berikutnya')).not.toContain('`11.`');
    expect(embed.toJSON().footer?.text).toContain('15 lagu lain di halaman lain');
  });

  it('antrean kosong menampilkan antrean kosong, bukan halaman hantu', () => {
    const embed = queueEmbed(snapshot(0, null));

    expect(fieldValue(embed, 'Berikutnya')).toBe('*antrean kosong*');
    expect(embed.toJSON().footer).toBeUndefined();
  });
});

describe('baris tombol navigasi', () => {
  it('tidak ada tombol kalau antrean cukup satu halaman', () => {
    expect(queueNavRow(buildQueuePage(tracks(10), 1))).toBeNull();
  });

  it('halaman pertama mematikan tombol ke belakang', () => {
    const row = queueNavRow(buildQueuePage(tracks(25), 1));
    const buttons = row?.toJSON().components ?? [];

    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[2]?.disabled).toBe(false);
  });

  it('halaman terakhir mematikan tombol ke depan', () => {
    const row = queueNavRow(buildQueuePage(tracks(25), 3));
    const buttons = row?.toJSON().components ?? [];

    expect(buttons[2]?.disabled).toBe(true);
    expect(buttons[3]?.disabled).toBe(true);
  });

  it('customId tombol mengarah ke halaman tujuan', () => {
    const row = queueNavRow(buildQueuePage(tracks(25), 1));
    const buttons = row?.toJSON().components ?? [];

    expect(JSON.stringify(buttons[2])).toContain('queue:p:2');
  });
});

describe('handleQueuePage', () => {
  function deps(overrides: Partial<QueueNavDeps> = {}, data = snapshot(25, track(0))): QueueNavDeps {
    return {
      getSnapshot: async () => data,
      isMusicEnabled: async () => true,
      ...overrides,
    };
  }

  it('memperbarui pesan dengan halaman yang diminta', async () => {
    const fake = fakeButton('queue:p:3');

    await handleQueuePage(fake.interaction, deps());

    expect(fake.updates).toHaveLength(1);
    const payload = fake.updates[0];
    expect(payload?.components).toHaveLength(1);
  });

  it('customId rusak dijawab dengan pesan, bukan membuat halaman', async () => {
    const fake = fakeButton('queue:p:abc');

    await handleQueuePage(fake.interaction, deps());

    expect(fake.updates).toHaveLength(0);
    expect(fake.replies).toHaveLength(1);
  });

  it('antrean yang menyusut membuat halaman dijepit, bukan kosong', async () => {
    const fake = fakeButton('queue:p:5');

    await handleQueuePage(fake.interaction, deps({}, snapshot(3, track(0))));

    expect(fake.updates).toHaveLength(1);
    const components = (fake.updates[0]?.components ?? []) as Array<{
      toJSON: () => { components: unknown[] };
    }>;
    // Satu halaman saja: tombol dilepas supaya pesan tidak offers opsi palsu.
    expect(components).toHaveLength(0);
  });

  it('antrean yang habis sejak pesan dibuat mengganti isinya dan melepas tombol', async () => {
    const fake = fakeButton('queue:p:2');

    await handleQueuePage(fake.interaction, deps({}, snapshot(0, null)));

    expect(fake.updates[0]?.components).toHaveLength(0);
  });

  it('modul musik mati dijawab tanpa membaca antrean', async () => {
    const getSnapshot = vi.fn();
    const fake = fakeButton('queue:p:2');

    await handleQueuePage(
      fake.interaction,
      deps({ isMusicEnabled: async () => false, getSnapshot }),
    );

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(fake.replies).toHaveLength(1);
  });

  it('pesan yang terlalu lama dijelaskan lewat pesan privat, bukan error?', async () => {
    const fake = fakeButton('queue:p:2', { updateFails: true });

    await handleQueuePage(fake.interaction, deps());

    expect(fake.replies).toHaveLength(1);
  });

  it('interaksi di luar server tidak diproses lebih jauh', async () => {
    const getSnapshot = vi.fn();
    const fake = fakeButton('queue:p:2', { inGuild: false });

    await handleQueuePage(fake.interaction, deps({ getSnapshot }));

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(fake.replies).toHaveLength(1);
  });
});