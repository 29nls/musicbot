import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleTimer } from '../src/modules/music/idleTimer.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('IdleTimer', () => {
  it('memanggil callback setelah durasi habis', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = new IdleTimer(onIdle);

    timer.start(1_000);
    expect(timer.isActive).toBe(true);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.isActive).toBe(false);
  });

  it('mulai ulang membatalkan hitungan sebelumnya', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = new IdleTimer(onIdle);

    timer.start(1_000);
    vi.advanceTimersByTime(600);
    timer.start(1_000);
    vi.advanceTimersByTime(600);

    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('cancel mencegah callback terpanggil', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = new IdleTimer(onIdle);

    timer.start(1_000);
    timer.cancel();
    vi.advanceTimersByTime(5_000);

    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.isActive).toBe(false);
  });

  it('durasi 0 atau negatif mematikan timer (fitur auto-disconnect off)', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = new IdleTimer(onIdle);

    timer.start(0);
    timer.start(-5);

    expect(timer.isActive).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('melaporkan sisa waktu', () => {
    vi.useFakeTimers();
    const timer = new IdleTimer(() => undefined);

    timer.start(10_000);
    expect(timer.remainingMs).toBe(10_000);

    vi.advanceTimersByTime(4_000);
    expect(timer.remainingMs).toBe(6_000);

    timer.cancel();
    expect(timer.remainingMs).toBeUndefined();
  });
});
