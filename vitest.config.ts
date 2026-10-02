import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    reporters: ['default'],
    coverage: {
      // Hanya kode bot yang diukur — bukan skrip deploy atau file tes sendiri.
      include: ['src/**/*.ts'],
      exclude: [
        'src/deploy-commands.ts',
        'src/prune-retention.ts',
        'src/generated/**',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // Tanpa threshold: angka ini dilaporkan di README, tidak dipaksakan.
      thresholds: { autoUpdate: false },
    },
  },
});
