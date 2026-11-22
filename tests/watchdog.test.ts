import { describe, expect, it } from 'vitest';

import {
  THRESHOLD,
  emptyState,
  evaluateBot,
  evaluateLavalink,
  normalizeState,
  planActions,
  type WatchdogState,
} from '../tools/watchdog-lib.js';

const HEALTHY_READY = {
  checks: { gateway: true, lavalink: true, database: 'ok' as const },
};

function stateWith(bot: number, lavalink: number): WatchdogState {
  return { bot: { failures: bot }, lavalink: { failures: lavalink } };
}

describe('evaluasi Lavalink', () => {
  it('gagal saat container tidak berjalan atau healthcheck-nya unhealthy', () => {
    expect(evaluateLavalink({ running: false, health: 'none' })).toMatchObject({ ok: false });
    expect(evaluateLavalink({ running: true, health: 'unhealthy' })).toMatchObject({ ok: false });
  });

  it('tidak menggagalkan container yang masih starting', () => {
    expect(evaluateLavalink({ running: true, health: 'starting' })).toEqual({ ok: true });
    expect(evaluateLavalink({ running: true, health: 'healthy' })).toEqual({ ok: true });
  });
});

describe('evaluasi bot', () => {
  it('gagal saat container mati, healthcheck gagal, atau /ready tidak menjawab', () => {
    expect(
      evaluateBot({ running: false, health: 'none', ready: HEALTHY_READY, lavalinkHealthy: true }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateBot({
        running: true,
        health: 'unhealthy',
        ready: HEALTHY_READY,
        lavalinkHealthy: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateBot({ running: true, health: 'healthy', ready: null, lavalinkHealthy: true }),
    ).toMatchObject({ ok: false });
  });

  it('tidak menggagalkan bot yang sedang start', () => {
    expect(
      evaluateBot({ running: true, health: 'starting', ready: null, lavalinkHealthy: false }),
    ).toEqual({ ok: true });
  });

  it('gagal saat gateway putus atau node Lavalink tidak tersambung padahal Lavalink sehat', () => {
    expect(
      evaluateBot({
        running: true,
        health: 'healthy',
        ready: { checks: { ...HEALTHY_READY.checks, gateway: false } },
        lavalinkHealthy: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateBot({
        running: true,
        health: 'healthy',
        ready: { checks: { ...HEALTHY_READY.checks, lavalink: false } },
        lavalinkHealthy: true,
      }),
    ).toMatchObject({ ok: false });
  });

  it('tidak menggagalkan bot saat Lavalink sendiri yang mati, atau saat database down', () => {
    expect(
      evaluateBot({
        running: true,
        health: 'healthy',
        ready: { checks: { ...HEALTHY_READY.checks, lavalink: false } },
        lavalinkHealthy: false,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateBot({
        running: true,
        health: 'healthy',
        ready: { checks: { ...HEALTHY_READY.checks, database: 'down' } },
        lavalinkHealthy: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe('ambang restart dua kali', () => {
  it('belum restart pada kegagalan pertama, lalu restart pada kegagalan kedua', () => {
    const first = planActions(emptyState(), {
      bot: { ok: false, reason: 'gateway Discord terputus' },
      lavalink: { ok: true },
    });
    expect(first.restarts).toEqual([]);
    expect(first.state.bot.failures).toBe(1);

    const second = planActions(first.state, {
      bot: { ok: false, reason: 'gateway Discord terputus' },
      lavalink: { ok: true },
    });
    expect(second.restarts).toEqual([
      { target: 'bot', reason: 'gateway Discord terputus', failures: THRESHOLD },
    ]);
    expect(second.state).toEqual(emptyState());
  });

  it('reset hitungan begitu pemeriksaan kembali normal', () => {
    const transition = planActions(stateWith(1, 1), {
      bot: { ok: true },
      lavalink: { ok: true },
    });
    expect(transition.state).toEqual(emptyState());
    expect(transition.restarts).toEqual([]);
  });

  it('menghitung tiap container sendiri-sendiri', () => {
    const transition = planActions(stateWith(1, 0), {
      bot: { ok: false, reason: 'healthcheck bot gagal' },
      lavalink: { ok: false, reason: 'healthcheck Lavalink gagal' },
    });

    expect(transition.restarts).toHaveLength(1);
    expect(transition.restarts[0]?.target).toBe('bot');
    expect(transition.state.lavalink.failures).toBe(1);
  });
});

describe('state tersimpan', () => {
  it('mengabaikan nilai rusak, negatif, dan bentuk lama', () => {
    expect(normalizeState(null)).toEqual(emptyState());
    expect(normalizeState({ bot: { failures: -3 }, lavalink: 'rusak' })).toEqual(emptyState());
    expect(normalizeState({ bot: { failures: 1 }, lavalink: { failures: 2 } })).toEqual(
      stateWith(1, 2),
    );
  });
});
