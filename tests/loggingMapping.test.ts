import { describe, expect, it } from 'vitest';
import { toDomain } from '../src/modules/logging/mapping.js';

describe('toDomain', () => {
  it('memetakan baris subscription', () => {
    const subscription = toDomain({
      guildId: '123456789012345678',
      category: 'voice',
      channelId: '111111111111111111',
    });

    expect(subscription).toEqual({
      guildId: '123456789012345678',
      category: 'voice',
      channelId: '111111111111111111',
    });
  });

  it('mengabaikan kategori yang tidak dikenal (data lama)', () => {
    expect(
      toDomain({
        guildId: '123456789012345678',
        category: 'kategori-lama',
        channelId: '111111111111111111',
      }),
    ).toBeNull();
  });
});
