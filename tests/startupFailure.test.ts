import { DiscordjsErrorCodes } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { describeStartupFailure } from '../src/utils/startupFailure.js';

/**
 * Bentuk error asli dari discord.js v14 yang sudah diamati langsung terhadap
 * gateway: penolakan intent dilempar sebagai `Error` polos tanpa `code`,
 * sedangkan token salah membawa `code`. Tes di bawah menjaga keduanya tetap
 * ditangani, karena inilah yang membuat pesan error sebelumnya tidak berguna.
 */

/** Error yang membawa `code`, seperti yang dibuat discord.js. */
function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeStartupFailure', () => {
  it('Error polos "Used disallowed intents" memberi langkah yang bisa diikuti', () => {
    const message = describeStartupFailure(new Error('Used disallowed intents'));

    expect(message).toContain('Server Members Intent');
    expect(message).toContain('Message Content Intent');
    expect(message).toContain('Developer Portal');
    // Petunjuk harus menyebut meletaknya, bukan cuma menyebut nama intent.
    expect(message).toMatch(/Privileged Gateway Intents/);
  });

  it('error ber-code DisallowedIntents memberi petunjuk yang sama', () => {
    const message = describeStartupFailure(coded(DiscordjsErrorCodes.DisallowedIntents, 'boom'));

    expect(message).toContain('Server Members Intent');
    expect(message).toContain('Message Content Intent');
  });

  it('kalimat "An invalid token was provided" memberi arahan reset token', () => {
    const message = describeStartupFailure(new Error('An invalid token was provided'));

    expect(message).toContain('Token Discord tidak valid');
    expect(message).toContain('Reset Token');
  });

  it('error ber-code TokenInvalid memberi arahan yang sama', () => {
    const message = describeStartupFailure(coded(DiscordjsErrorCodes.TokenInvalid, 'boom'));

    expect(message).toContain('Token Discord tidak valid');
  });

  it('code yang tidak dikenal tetap jatuh ke pesan aslinya', () => {
    expect(describeStartupFailure(coded('UnknownError', 'sesuatu hal'))).toBe('Error: sesuatu hal');
  });

  it('error lain tidak dikira pendekatan ke intent atau token', () => {
    const message = describeStartupFailure(new Error('prisma failed to connect'));

    expect(message).toBe('Error: prisma failed to connect');
  });

  it('nilai yang bukan Error tetap bisa ditampilkan', () => {
    expect(describeStartupFailure('string biasa')).toBe('string biasa');
    expect(describeStartupFailure(undefined)).toBe('undefined');
    expect(describeStartupFailure(null)).toBe('null');
  });

  it('error dari subclass Error tetap memakai nama aslinya', () => {
    class EnvError extends Error {
      override readonly name = 'EnvError';
    }

    expect(describeStartupFailure(new EnvError('konfigurasi tidak valid'))).toBe(
      'EnvError: konfigurasi tidak valid',
    );
  });
});