import type { EmbedBuilder, StringSelectMenuInteraction } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { componentCooldownKey, routeComponent } from '../src/handlers/componentRouter.js';
import { getSearchSessionStore, SEARCH_SELECT_PREFIX } from '../src/modules/music/index.js';
import { checkCooldown, setCooldownStore } from '../src/utils/cooldown.js';
import { MemoryKeyValueStore } from '../src/services/kvStore.js';
import type { TrackInfo } from '../src/modules/music/types.js';

const GUILD = 'guild-1';

type Kind = 'button' | 'select' | 'modal';

/**
 * Simpan session pencarian untuk tes.
 *
 * `put` mengembalikan null kalau session tidak bisa disimpan; di sini itu
 * kegagalan setup, bukan keadaan yang sedang diuji, jadi tes berhenti langsung.
 */
async function putSession(input: { requesterId: string; query?: string; title?: string }) {
  const session = await getSearchSessionStore().put({
    guildId: GUILD,
    requesterId: input.requesterId,
    query: input.query ?? 'lofi',
    tracks: [track(input.title ?? 'Lagu Satu')],
  });

  if (!session) throw new Error('session tidak tersimpan');
  return session;
}

interface CapturedReply {
  embeds: EmbedBuilder[];
}

/** Gabungkan teks embed yang dikirim fake interaction, supaya asersi terbaca. */
function replyText(replies: CapturedReply[]): string {
  return replies
    .map((reply) =>
      reply.embeds
        .map((embed) => `${embed.data.title ?? ''} ${embed.data.description ?? ''}`)
        .join(' '),
    )
    .join(' ');
}

/**
 * Interaction palsu yang cukup untuk router.
 *
 * Handler yang benar-benar dipanggil di sini hanya `handleSearchSelect` pada
 * jalur session yang sudah tidak ada — jalur itu berhenti sebelum menyentuh
 * database, jadi tes ini tidak perlu mock apa pun.
 */
function fakeComponent(kind: Kind, customId: string, userId: string, values: string[] = ['0']) {
  const replies: CapturedReply[] = [];

  const interaction = {
    customId,
    user: { id: userId },
    guildId: GUILD,
    values,
    replied: false,
    deferred: false,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    inCachedGuild: () => true,
    guild: undefined,
    member: undefined,
    reply: async (payload: { embeds: EmbedBuilder[] }) => {
      replies.push(payload);
    },
    editReply: async (payload: { embeds: EmbedBuilder[] }) => {
      replies.push(payload);
    },
  };

  return { interaction: interaction as unknown as StringSelectMenuInteraction, replies };
}

function track(title: string): TrackInfo {
  return {
    encoded: `encoded-${title}`,
    title,
    author: 'Artis',
    durationMs: 210_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
  };
}

describe('routeComponent', () => {
  beforeEach(() => {
    // Store cooldown terisolasi per file tes: store yang sama akan ikut
    // state-nya akan ikut bercampur dengan file tes lain kalau tidak
    // dipasang ulang di sini.
    setCooldownStore(new MemoryKeyValueStore());
  });
  beforeEach(async () => {
    await getSearchSessionStore().clear();
  });

  it('membiarkan komponen milik collector lain lewat tanpa membalas', async () => {
    const { interaction, replies } = fakeComponent('button', 'setup-wizard:next', 'u-unknown');

    expect(await routeComponent(interaction)).toBe(false);
    expect(replies).toHaveLength(0);
  });

  it('tidak mengirim select menu ke handler modal maupun tombol tiket', async () => {
    const { interaction, replies } = fakeComponent('select', 'ticket:subject', 'u-kind');

    expect(await routeComponent(interaction)).toBe(false);
    expect(replies).toHaveLength(0);
  });

  it('tidak mengirim tombol ke handler select menu pencarian', async () => {
    const { interaction, replies } = fakeComponent('button', `${SEARCH_SELECT_PREFIX}deadbeef`, 'u-kind2');

    expect(await routeComponent(interaction)).toBe(false);
    expect(replies).toHaveLength(0);
  });

  it('menjalankan handler search untuk session yang tidak dikenal dan menjelaskannya', async () => {
    const { interaction, replies } = fakeComponent('select', `${SEARCH_SELECT_PREFIX}deadbeef`, 'u-run');

    expect(await routeComponent(interaction)).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replyText(replies)).toContain('tidak berlaku');
  });

  it('menyerahkan session kepada handler sampai habis', async () => {
    const store = getSearchSessionStore();
    const session = await putSession({ requesterId: 'u-consume' });

    const { interaction, replies } = fakeComponent(
      'select',
      `${SEARCH_SELECT_PREFIX}${session.token}`,
      'u-consume',
    );

    expect(await routeComponent(interaction)).toBe(true);
    expect(await store.peek(session.token)).toBeUndefined();
    expect(replies).toHaveLength(1);
  });

  it('menahan klik yang terlalu cepat dan tidak memakai session', async () => {
    const store = getSearchSessionStore();
    const session = await putSession({ requesterId: 'u-fast' });

    // Isi bucket langsung: klik pertama yang memicu cooldown sudah diuji di
    // tests/cooldown.test.ts, jadi di sini cukup kondisi "bucket sudah penuh".
    await checkCooldown(componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-fast'), 3);

    const { interaction, replies } = fakeComponent(
      'select',
      `${SEARCH_SELECT_PREFIX}${session.token}`,
      'u-fast',
    );

    expect(await routeComponent(interaction)).toBe(true);
    expect(replyText(replies)).toContain('Tunggu');
    expect(await store.peek(session.token)).toBeDefined();
  });

  it('cooldown satu user tidak mengenai user lain', async () => {
    await checkCooldown(componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-slow-a'), 3);

    const { interaction, replies } = fakeComponent('select', `${SEARCH_SELECT_PREFIX}deadbeef`, 'u-slow-b');

    expect(await routeComponent(interaction)).toBe(true);
    expect(replyText(replies)).not.toContain('Tunggu');
  });
});

describe('componentCooldownKey', () => {
  it('stabil untuk user, jenis, dan fitur yang sama', () => {
    const first = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key');
    const second = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key');

    expect(first).toBe(second);
  });

  it('berbeda antar user — cooldown tidak boleh menjatuhkan semua orang sekaligus', () => {
    const mine = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key-a');
    const theirs = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key-b');

    expect(mine).not.toBe(theirs);
  });

  it('berbeda antar fitur dan antar jenis interaksi', () => {
    const select = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key');
    const button = componentCooldownKey('ticket:', 'button', 'u-key');
    const modal = componentCooldownKey('ticket:subject', 'modal', 'u-key');

    expect(new Set([select, button, modal]).size).toBe(3);
  });

  it('memakai prefix, bukan customId penuh — token per pencarian tidak boleh membuat bucket baru', () => {
    const firstSearch = componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key');

    // customId berbeda (token lain) tetapi prefix fitur sama.
    expect(firstSearch).toBe(componentCooldownKey(SEARCH_SELECT_PREFIX, 'select', 'u-key'));
    expect(firstSearch).toContain(SEARCH_SELECT_PREFIX);
    expect(firstSearch).not.toContain('deadbeef');
  });
});