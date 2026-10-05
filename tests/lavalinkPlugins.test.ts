import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkLavalinkPlugins,
  loadExpectedPlugins,
  readExpectedPlugins,
  type LavalinkPluginRef,
} from '../src/modules/music/lavalinkPlugins.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

describe('readExpectedPlugins', () => {
  it('membaca plugin yang diminta dari application.yml repo ini', () => {
    const result = readExpectedPlugins(repoFile('lavalink/application.yml'));

    if (result.kind !== 'ok') throw new Error(`config repo tidak terbaca: ${result.reason}`);

    expect(result.plugins.map((plugin) => plugin.name)).toEqual(['youtube-plugin', 'lavasrc-plugin']);
    for (const plugin of result.plugins) {
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('hanya membaca blok lavalink.plugins, bukan plugins di akar berkas', () => {
    const result = readExpectedPlugins(
      [
        'plugins:',
        '  youtube:',
        '    enabled: true',
        '',
        'lavalink:',
        '  plugins:',
        '    - dependency: "dev.lavalink.youtube:youtube-plugin:1.18.2"',
        '      snapshot: false',
        '  server:',
        '    password: "rahasia"',
      ].join('\n'),
    );

    expect(result).toEqual({
      kind: 'ok',
      plugins: [{ name: 'youtube-plugin', version: '1.18.2' }],
    });
  });

  it('melewati komentar dan baris kosong di dalam daftar plugin', () => {
    const result = readExpectedPlugins(
      [
        'lavalink:',
        '  plugins:',
        '    # plugin sumber audio',
        '    - dependency: "dev.lavalink.youtube:youtube-plugin:1.18.2"',
        '',
        '    # metadata Spotify/Apple Music',
        '    - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:4.8.3"',
        '  server:',
        '    password: "rahasia"',
      ].join('\n'),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.plugins).toEqual([
        { name: 'youtube-plugin', version: '1.18.2' },
        { name: 'lavasrc-plugin', version: '4.8.3' },
      ]);
    }
  });

  it('menerima dependency tanpa tanda kutip dan tanpa grup', () => {
    const result = readExpectedPlugins(
      ['lavalink:', '  plugins:', '    - dependency: youtube-plugin:1.18.2', '  server:'].join('\n'),
    );

    expect(result).toEqual({
      kind: 'ok',
      plugins: [{ name: 'youtube-plugin', version: '1.18.2' }],
    });
  });

  it('melaporkan alasan saat bentuk config tidak dikenali, bukan daftar kosong', () => {
    const tanpaBlok = readExpectedPlugins('plugins:\n  youtube:\n    enabled: true\n');
    const tanpaDaftar = readExpectedPlugins('lavalink:\n  server:\n    password: "x"\n');
    const tanpaDependency = readExpectedPlugins('lavalink:\n  plugins:\n    # kosong\n  server:\n');

    expect(tanpaBlok.kind).toBe('unknown');
    expect(tanpaDaftar.kind).toBe('unknown');
    expect(tanpaDependency.kind).toBe('unknown');

    for (const result of [tanpaBlok, tanpaDaftar, tanpaDependency]) {
      // Alasan harus bisa dibaca manusia: pemeriksaan yang dilewati tanpa
      // penjelasan sama saja dengan pemeriksaan yang tidak ada.
      if (result.kind === 'unknown') expect(result.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('checkLavalinkPlugins', () => {
  const expected: LavalinkPluginRef[] = [
    { name: 'youtube-plugin', version: '1.18.2' },
    { name: 'lavasrc-plugin', version: '4.8.3' },
  ];

  it('menyebut versi lama sebagai selisih, lengkap dengan cara memperbaikinya', () => {
    const check = checkLavalinkPlugins(expected, [
      { name: 'youtube-plugin', version: '1.18.1' },
      { name: 'lavasrc-plugin', version: '4.8.3' },
    ]);

    expect(check.mismatches).toEqual([
      { name: 'youtube-plugin', expected: '1.18.2', actual: '1.18.1' },
    ]);
    expect(check.warning).toContain('1.18.2');
    expect(check.warning).toContain('1.18.1');
    expect(check.warning).toContain('npm run infra:lavalink');
    expect(check.warning).toContain('tools/yts-probe.mjs');
  });

  it('menyebut plugin yang tidak dimuat sama sekali', () => {
    const check = checkLavalinkPlugins(expected, [{ name: 'youtube-plugin', version: '1.18.2' }]);

    expect(check.mismatches).toEqual([
      { name: 'lavasrc-plugin', expected: '4.8.3', actual: undefined },
    ]);
    expect(check.warning).toContain('tidak ada');
  });

  it('tidak berteriak saat cocok walau urutan dan huruf besar-kecil berbeda', () => {
    const check = checkLavalinkPlugins(expected, [
      { name: 'LAVASRC-PLUGIN', version: '4.8.3' },
      { name: 'youtube-plugin', version: '1.18.2' },
    ]);

    expect(check.mismatches).toEqual([]);
    expect(check.warning).toBeUndefined();
  });

  it('menyebut semua selisih sekaligus, bukan hanya yang pertama', () => {
    const check = checkLavalinkPlugins(expected, []);

    expect(check.mismatches).toHaveLength(2);
    expect(check.warning).toContain('youtube-plugin');
    expect(check.warning).toContain('lavasrc-plugin');
  });
});

describe('loadExpectedPlugins', () => {
  it('membaca berkas config yang benar-benar ada di repo', async () => {
    const result = await loadExpectedPlugins({ path: fileURLToPath(new URL('../lavalink/application.yml', import.meta.url)) });

    expect(result.kind).toBe('ok');
  });

  it('tidak melempar saat berkas config tidak ada — Docker memang tidak membawanya', async () => {
    const result = await loadExpectedPlugins({ path: 'tidak-ada-folder/application.yml' });

    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') expect(result.reason).toContain('tidak bisa membaca');
  });
});
