import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailableError } from '../src/services/prismaErrors.js';

function errorWith(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(message);
  error.name = name;
  return Object.assign(error, extra);
}

describe('isDatabaseUnavailableError', () => {
  it('mengenali PrismaClientInitializationError', () => {
    expect(isDatabaseUnavailableError(errorWith('PrismaClientInitializationError', 'boom'))).toBe(true);
  });

  it('mengenali kode koneksi yang ada di properti code (kasus nyata driver pg)', () => {
    const error = errorWith('PrismaClientKnownRequestError', '\nInvalid `prisma.$queryRaw()` invocation:\n', {
      code: 'ECONNREFUSED',
    });

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('mengenali kode Prisma P1001/P1002', () => {
    expect(isDatabaseUnavailableError(Object.assign(new Error('nope'), { code: 'P1001' }))).toBe(true);
    expect(isDatabaseUnavailableError(Object.assign(new Error('nope'), { code: 'P1002' }))).toBe(true);
  });

  it('mengenali pesan koneksi biasa', () => {
    expect(isDatabaseUnavailableError(new Error("Can't reach database server at db:5432"))).toBe(true);
  });

  it('tidak menganggap error lain sebagai masalah koneksi', () => {
    expect(isDatabaseUnavailableError(errorWith('PrismaClientValidationError', 'Unknown argument `foo`'))).toBe(false);
    expect(isDatabaseUnavailableError(Object.assign(new Error('unique constraint'), { code: 'P2002' }))).toBe(false);
  });

  it('aman untuk nilai bukan Error', () => {
    expect(isDatabaseUnavailableError('ECONNREFUSED')).toBe(false);
    expect(isDatabaseUnavailableError(undefined)).toBe(false);
    expect(isDatabaseUnavailableError(null)).toBe(false);
    expect(isDatabaseUnavailableError({ code: 'ECONNREFUSED' })).toBe(false);
  });
});
