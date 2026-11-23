import { describe, expect, it, vi } from 'vitest';
import { dashboardResultKey } from '@bot/modules/music/dashboard.js';
import {
  RESULT_TIMEOUT_MS,
  waitForDashboardResult,
} from '@/lib/musicCommand.js';

const REQUEST = 'abcdef0123456789abcdef0123456789';
const OTHER = '0123456789abcdef0123456789abcdef';

function stored(result: unknown): string {
  return JSON.stringify({
    owner: 'bot-a',
    result,
    writtenAt: Date.now(),
  });
}

describe('menunggu hasil perintah dashboard', () => {
  it('membaca, memvalidasi, lalu menghapus hasil milik requestId ini', async () => {
    const readResult = vi.fn(async () => stored({ action: 'pause', ok: true }));
    const deleteResult = vi.fn(async () => undefined);

    const waited = await waitForDashboardResult(REQUEST, {
      readResult,
      deleteResult,
      timeoutMs: 1_000,
    });

    expect(waited).toEqual({ status: 'result', result: { action: 'pause', ok: true } });
    expect(readResult).toHaveBeenCalledWith(dashboardResultKey(REQUEST));
    expect(deleteResult).toHaveBeenCalledWith(dashboardResultKey(REQUEST));
  });

  it('menunggu sampai hasil ditulis, bukan hanya membaca sekali', async () => {
    let now = 0;
    let calls = 0;

    const waited = await waitForDashboardResult(REQUEST, {
      readResult: async () => {
        calls += 1;
        return calls < 3 ? null : stored({ action: 'skip', ok: true });
      },
      deleteResult: async () => undefined,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      timeoutMs: 1_000,
    });

    expect(waited.status).toBe('result');
    expect(calls).toBe(3);
  });

  it('menghabiskan waktu lalu melaporkan timeout', async () => {
    let now = 0;

    const waited = await waitForDashboardResult(REQUEST, {
      readResult: async () => null,
      deleteResult: async () => undefined,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      timeoutMs: 500,
    });

    expect(waited).toEqual({ status: 'timeout' });
    expect(now).toBeGreaterThanOrEqual(500);
  });

  it('melaporkan store yang mati saat menunggu, bukan menggantung sampai timeout', async () => {
    const waited = await waitForDashboardResult(REQUEST, {
      readResult: async () => {
        throw new Error('Redis mati');
      },
      deleteResult: async () => undefined,
    });

    expect(waited).toEqual({ status: 'store-error' });
  });

  it('membuang hasil rusak lalu tetap menunggu hasil yang sah', async () => {
    let calls = 0;

    const waited = await waitForDashboardResult(REQUEST, {
      readResult: async () => {
        calls += 1;
        if (calls === 1) return 'bukan json';
        if (calls === 2) return stored({ action: 'pause', ok: 'mungkin' });

        return stored({ action: 'pause', ok: true });
      },
      deleteResult: async () => undefined,
      timeoutMs: 1_000,
    });

    expect(waited.status).toBe('result');
    expect(calls).toBe(3);
  });

  it('menolak requestId yang tidak berbentuk sebelum menyentuh store', async () => {
    const readResult = vi.fn(async () => null);

    const waited = await waitForDashboardResult('pendek', {
      readResult,
      deleteResult: async () => undefined,
    });

    expect(waited).toEqual({ status: 'invalid' });
    expect(readResult).not.toHaveBeenCalled();
  });

  it('memakai kunci hasil yang terpisah per request', () => {
    expect(dashboardResultKey(REQUEST)).not.toBe(dashboardResultKey(OTHER));
    expect(dashboardResultKey(REQUEST)).toContain(REQUEST);
    expect(RESULT_TIMEOUT_MS).toBe(8_000);
  });
});
