/**
 * Env minimal untuk seluruh tes.
 *
 * Modul seperti logger dan database memanggil `getEnv()` secara lazily, jadi
 * tes yang menyentuh jalur best-effort (mis. penanganan error saat menyimpan
 * riwayat log) butuh nilai yang valid — tanpa harus menyiapkan file `.env`.
 * Nilai-nilai ini tidak pernah dipakai untuk koneksi nyata.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.DISCORD_TOKEN = 'test_token_0000000000000000';
process.env.DISCORD_CLIENT_ID = '123456789012345678';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/harmony_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.LAVALINK_PASSWORD = 'test_lavalink_password';
