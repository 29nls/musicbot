import type { Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Giveaway } from '../src/modules/giveaways/types.js';
import {
  startGiveawayJob,
  type GiveawayExpiryRunner,
} from '../src/services/giveawayJob.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '987654321098765432';
const CHANNEL_ID = '555555555555555555';
const NOW = new Date('2026-11-21T12:00:00.000Z');

function giveaway(overrides: Partial<Giveaway> = {}): Giveaway {
  return {
    id: 1,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    messageId: '666666666666666666',
    prize: 'Nitro',
    winnersCount: 1,
    endsAt: new Date(NOW.getTime() - 1_000),
    endedAt: null,
    createdAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

/** Guild tanpa channel; hasil giveaway tidak bisa diumumkan. */
function guildWithoutChannel(): Guild {
  return {
    id: GUILD_ID,
    channels: { fetch: async () => null },
  } as unknown as Guild;
}

function fakeRunner(due: readonly Giveaway[]): {
  runner: GiveawayExpiryRunner;
  ended: string[];
  queriedGuildIds: string[][];
} {
  const ended: string[] = [];
  const queriedGuildIds: string[][] = [];

  return {
    ended,
    queriedGuildIds,
    runner: {
      async findDue(_now, guildIds = [], _limit = 25) {
        queriedGuildIds.push([...guildIds]);
        return [...due];
      },
      async end(guildId, giveawayId) {
        ended.push(`${guildId}:${giveawayId}`);
        const found = due.find(
          (item) => item.id === giveawayId && item.guildId === guildId,
        );
        if (!found) return null;

        return {
          giveaway: found,
          winners: [],
          entryCount: 0,
          changed: true,
        };
      },
    },
  };
}

describe('job penyapuan giveaway', () => {
  it('menutup giveaway yang lewat waktu dan mencatat pesan yang tidak bisa diumumkan', async () => {
    const { runner, ended } = fakeRunner([giveaway()]);
    const job = startGiveawayJob({
      intervalMs: 0,
      runOnStart: false,
      runner,
      guilds: () => [guildWithoutChannel()],
    });

    const result = await job.runOnce(NOW);
    job.stop();

    expect(result).toEqual({ ended: 1, skipped: 0, messageMissing: 1 });
    expect(ended).toEqual([`${GUILD_ID}:1`]);
  });

  it('membatasi kueri ke guild milik proses dan melewati giveaway guild lain', async () => {
    const { runner, ended, queriedGuildIds } = fakeRunner([
      giveaway({ id: 2, guildId: OTHER_GUILD_ID }),
    ]);
    const job = startGiveawayJob({
      intervalMs: 0,
      runOnStart: false,
      runner,
      guilds: () => [guildWithoutChannel()],
    });

    const result = await job.runOnce(NOW);
    job.stop();

    expect(queriedGuildIds).toEqual([[GUILD_ID]]);
    expect(result).toEqual({ ended: 0, skipped: 1, messageMissing: 0 });
    expect(ended).toEqual([]);
  });

  it('tidak menyentuh database saat bot belum memegang guild', async () => {
    const { runner, queriedGuildIds } = fakeRunner([giveaway()]);
    const job = startGiveawayJob({
      intervalMs: 0,
      runOnStart: false,
      runner,
      guilds: () => [],
    });

    const result = await job.runOnce(NOW);
    job.stop();

    expect(result).toEqual({ ended: 0, skipped: 0, messageMissing: 0 });
    expect(queriedGuildIds).toEqual([]);
  });
});
