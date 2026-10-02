/**
 * Cooldown in-memory sederhana per user+perintah.
 * Untuk rate limit lintas proses (fase berikutnya) ganti ke Redis.
 */
const buckets = new Map<string, number>();
const MAX_ENTRIES = 10_000;

/**
 * @returns 0 kalau boleh jalan, atau sisa detik tunggu kalau masih cooldown.
 */
export function checkCooldown(key: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  const now = Date.now();
  const expiresAt = buckets.get(key);

  if (expiresAt !== undefined && expiresAt > now) {
    return Math.ceil((expiresAt - now) / 1_000);
  }

  // Map hanya tumbuh kalau ada user unik; bersihkan saat sudah terlalu besar.
  if (buckets.size >= MAX_ENTRIES) pruneExpired(now);

  buckets.set(key, now + seconds * 1_000);
  return 0;
}

export function resetCooldown(key: string): void {
  buckets.delete(key);
}

function pruneExpired(now: number): void {
  for (const [key, expiresAt] of buckets) {
    if (expiresAt <= now) buckets.delete(key);
  }
}
