import { describe, expect, it } from 'vitest';
import { isTransactionPoolerUrl, resolveCliDatabaseUrl } from '../prisma/url.js';

const SESSION_POOLER =
  'postgresql://postgres.abcdefghij:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
const TRANSACTION_POOLER =
  'postgresql://postgres.abcdefghij:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const LOCAL = 'postgresql://harmony:harmony_dev_password@localhost:5432/harmony';

describe('resolveCliDatabaseUrl', () => {
  it('DIRECT_URL diutamakan karena Prisma CLI butuh sesi yang tidak dipecah pooler', () => {
    const url = resolveCliDatabaseUrl({ DATABASE_URL: TRANSACTION_POOLER, DIRECT_URL: SESSION_POOLER });

    expect(url).toBe(SESSION_POOLER);
  });

  it('jatuh ke DATABASE_URL kalau DIRECT_URL kosong, supaya Postgres lokal tetap jalan', () => {
    expect(resolveCliDatabaseUrl({ DATABASE_URL: LOCAL })).toBe(LOCAL);
    expect(resolveCliDatabaseUrl({ DATABASE_URL: LOCAL, DIRECT_URL: '' })).toBe(LOCAL);
    expect(resolveCliDatabaseUrl({ DATABASE_URL: LOCAL, DIRECT_URL: '   ' })).toBe(LOCAL);
  });

  it('spasi di kedua variabel dipangkas, karena .env sering menyisakan enter', () => {
    expect(resolveCliDatabaseUrl({ DIRECT_URL: '  ' + SESSION_POOLER + '\n' })).toBe(SESSION_POOLER);
  });

  it('undefined kalau keduanya kosong, supaya pesan errornya menyebut variabel yang benar', () => {
    expect(resolveCliDatabaseUrl({})).toBeUndefined();
    expect(resolveCliDatabaseUrl({ DATABASE_URL: '', DIRECT_URL: '' })).toBeUndefined();
  });
});

describe('isTransactionPoolerUrl', () => {
  it('mengenali port 6543 sebagai transaction pooler', () => {
    // Kegagalan mode ini tidak jelas: Prisma Migrate memakai prepared
    // statement, jadi migrasi menggantung tanpa menyebut pooler sebagai
    // penyebabnya. Karena itu deteksinya harus tepat.
    expect(isTransactionPoolerUrl(TRANSACTION_POOLER)).toBe(true);
  });

  it('tidak salah menandai direct atau session mode', () => {
    expect(isTransactionPoolerUrl(SESSION_POOLER)).toBe(false);
    expect(isTransactionPoolerUrl(LOCAL)).toBe(false);
  });

  it('URL rusak dianggap bukan transaction pooler, biar driver yang melapor', () => {
    expect(isTransactionPoolerUrl('bukan-url')).toBe(false);
    expect(isTransactionPoolerUrl('')).toBe(false);
  });
});
