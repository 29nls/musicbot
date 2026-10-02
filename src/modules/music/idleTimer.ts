/**
 * Timer sekali-jalan untuk auto-disconnect saat antrean habis.
 *
 * Dipisahkan dari service supaya bisa dites dengan fake timer, dan supaya
 * aturan "antrean kosong → tunggu N detik → keluar" tidak tercampur dengan
 * kode protokol Lavalink.
 */
export class IdleTimer {
  private handle: NodeJS.Timeout | undefined;
  private expiresAt: number | undefined;

  constructor(private readonly onIdle: () => void) {}

  /** Mulai (atau mulai ulang) hitungan mundur. Durasi <= 0 mematikan fitur. */
  start(delayMs: number): void {
    this.cancel();

    if (!Number.isFinite(delayMs) || delayMs <= 0) return;

    this.expiresAt = Date.now() + delayMs;
    this.handle = setTimeout(() => {
      this.handle = undefined;
      this.expiresAt = undefined;
      this.onIdle();
    }, delayMs);

    // Jangan menahan proses tetap hidup hanya karena timer ini.
    this.handle.unref();
  }

  cancel(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = undefined;
    this.expiresAt = undefined;
  }

  get isActive(): boolean {
    return this.handle !== undefined;
  }

  /** Sisa waktu dalam ms, atau undefined kalau timer tidak aktif. */
  get remainingMs(): number | undefined {
    if (this.expiresAt === undefined) return undefined;

    return Math.max(this.expiresAt - Date.now(), 0);
  }
}
