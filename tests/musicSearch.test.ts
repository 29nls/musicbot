import { describe, expect, it } from 'vitest';
import { buildSearchIdentifier, isUrl } from '../src/modules/music/search.js';

describe('buildSearchIdentifier', () => {
  it('meneruskan URL apa adanya', () => {
    expect(buildSearchIdentifier('https://www.youtube.com/watch?v=abc')).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
    expect(buildSearchIdentifier('http://example.com/lagu.mp3')).toBe('http://example.com/lagu.mp3');
  });

  it('mencari kata kunci lewat YouTube', () => {
    expect(buildSearchIdentifier('never gonna give you up')).toBe(
      'ytsearch:never gonna give you up',
    );
  });

  it('memangkas spasi di ujung', () => {
    expect(buildSearchIdentifier('  hujan nadin  ')).toBe('ytsearch:hujan nadin');
    expect(buildSearchIdentifier('  https://example.com  ')).toBe('https://example.com');
  });
});

describe('isUrl', () => {
  it('membedakan URL dan kata kunci', () => {
    expect(isUrl('https://open.spotify.com/track/abc')).toBe(true);
    expect(isUrl('Https://Example.com')).toBe(true);
    expect(isUrl('spotify:track:abc')).toBe(false);
    expect(isUrl('lagu favorit saya')).toBe(false);
  });
});
