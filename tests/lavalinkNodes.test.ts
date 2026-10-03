import { describe, expect, it } from 'vitest';
import { MusicService, type MusicNodeOptions } from '../src/modules/music/musicService.js';
import {
  MAX_LAVALINK_NODES,
  lavalinkNodeName,
  parseLavalinkNodes,
  summarizeLavalinkNodes,
  type LavalinkNodeSpec,
} from '../src/modules/music/nodes.js';
import type { Client } from 'discord.js';

const fallback: LavalinkNodeSpec = { host: 'lavalink', port: 2333 };

describe('parseLavalinkNodes', () => {
  it('memakai host dan port bawaan saat daftar node tidak diisi', () => {
    for (const raw of [undefined, '', '   ']) {
      const result = parseLavalinkNodes(raw, fallback);

      expect(result.nodes).toEqual([{ host: 'lavalink', port: 2333 }]);
      expect(result.skipped).toEqual([]);
      expect(result.fromFallback).toBe(true);
    }
  });

  it('membaca daftar host:port yang dipisah koma', () => {
    const result = parseLavalinkNodes('lava-a:2333, lava-b:4040 ,lava-c:5050', fallback);

    expect(result.nodes).toEqual([
      { host: 'lava-a', port: 2333 },
      { host: 'lava-b', port: 4040 },
      { host: 'lava-c', port: 5050 },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.fromFallback).toBe(false);
  });

  it('memakai port bawaan untuk entri yang tidak menyebut port', () => {
    const result = parseLavalinkNodes('lava-a,lava-b:4040', fallback);

    expect(result.nodes).toEqual([
      { host: 'lava-a', port: 2333 },
      { host: 'lava-b', port: 4040 },
    ]);
  });

  it('mengabaikan node bawaan begitu daftar node diisi', () => {
    const result = parseLavalinkNodes('lava-a:1111', { host: 'tidak-dipakai', port: 9999 });

    expect(result.nodes).toEqual([{ host: 'lava-a', port: 1111 }]);
  });

  it('membuang entri yang tidak bisa dibaca, tanpa menggagalkan yang lain', () => {
    const result = parseLavalinkNodes('lava-a:2333,lava-b:port,lavalink:70000,lava-c:3000', fallback);

    expect(result.nodes.map((node) => node.host)).toEqual(['lava-a', 'lava-c']);
    expect(result.skipped).toEqual(['lava-b:port', 'lavalink:70000']);
  });

  it('menyebut entri kosong dan tanda titik dua sendirian apa adanya', () => {
    expect(parseLavalinkNodes('a:1,,b:2', fallback).skipped).toEqual(['(entri kosong)']);
    expect(parseLavalinkNodes(':,a:1', fallback).skipped).toEqual([':']);
  });

  it('menerima nama host biasa tanpa port, karena itu sah untuk docker compose', () => {
    const result = parseLavalinkNodes('lavalink,LAVALINK-B:2333', fallback);

    expect(result.nodes).toEqual([
      { host: 'lavalink', port: 2333 },
      { host: 'LAVALINK-B', port: 2333 },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('menolak IPv6 tanpa kurung siku karena tidak bisa dibedakan dari host:port', () => {
    const withBrackets = parseLavalinkNodes('[::1]:2333', fallback);
    expect(withBrackets.nodes).toEqual([{ host: '::1', port: 2333 }]);

    const withoutBrackets = parseLavalinkNodes('::1', fallback);
    expect(withoutBrackets.nodes).toEqual([]);
    expect(withoutBrackets.skipped).toEqual(['::1']);
  });

  it('membaca IPv6 berkurung siku tanpa port memakai port bawaan', () => {
    expect(parseLavalinkNodes('[fd00::2]', fallback).nodes).toEqual([{ host: 'fd00::2', port: 2333 }]);
  });

  it('membuang kurung siku yang tidak berpasangan', () => {
    const result = parseLavalinkNodes('[::1:2333,lava-a:2333', fallback);

    expect(result.nodes.map((node) => node.host)).toEqual(['lava-a']);
    expect(result.skipped).toEqual(['[::1:2333']);
  });

  it('membuang host kosong dan port di luar rentang', () => {
    const result = parseLavalinkNodes(':2333,lava-a:0,lava-b:65536', fallback);

    expect(result.nodes).toEqual([]);
    expect(result.skipped).toEqual([':2333', 'lava-a:0', 'lava-b:65536']);
  });

  it('membuang node duplikat dengan port berbeda', () => {
    const sameHostAndPort = parseLavalinkNodes('lava-a:2333,LAVA-A:2333', fallback);
    expect(sameHostAndPort.nodes).toHaveLength(1);
    expect(sameHostAndPort.skipped).toEqual(['LAVA-A:2333 (duplikat)']);

    const differentPort = parseLavalinkNodes('lava-a:2333,lava-a:3000', fallback);
    expect(differentPort.nodes).toHaveLength(2);
    expect(differentPort.skipped).toEqual([]);
  });

  it('membatasi jumlah node dan menyebut alasannya', () => {
    const raw = Array.from({ length: MAX_LAVALINK_NODES + 2 }, (_, index) => `lava-${index}:2333`).join(',');
    const result = parseLavalinkNodes(raw, fallback);

    expect(result.nodes).toHaveLength(MAX_LAVALINK_NODES);
    expect(result.skipped).toEqual([
      `lava-${MAX_LAVALINK_NODES}:2333 (melebihi batas ${MAX_LAVALINK_NODES} node)`,
      `lava-${MAX_LAVALINK_NODES + 1}:2333 (melebihi batas ${MAX_LAVALINK_NODES} node)`,
    ]);
  });

  it('menghormati batas node yang diberikan pemanggil', () => {
    const result = parseLavalinkNodes('a:1,b:2,c:3', fallback, { maxNodes: 2 });

    expect(result.nodes).toHaveLength(2);
    expect(result.skipped).toEqual(['c:3 (melebihi batas 2 node)']);
  });

  it('menghasilkan daftar kosong, bukan error, saat semua entri rusak', () => {
    const result = parseLavalinkNodes('a:b,c:d,::1', fallback);

    expect(result.nodes).toEqual([]);
    expect(result.skipped).toEqual(['a:b', 'c:d', '::1']);
    expect(result.fromFallback).toBe(false);
  });

  it('tidak mengubah objek bawaan yang diterima', () => {
    const source: LavalinkNodeSpec = { host: 'lavalink', port: 2333 };
    parseLavalinkNodes('', source).nodes[0]!.port = 1;

    expect(source.port).toBe(2333);
  });
});

describe('lavalinkNodeName', () => {
  it('menyusun nama node sebagai host:port', () => {
    expect(lavalinkNodeName({ host: 'lava-a', port: 2333 })).toBe('lava-a:2333');
    expect(lavalinkNodeName({ host: '::1', port: 2333 })).toBe('::1:2333');
  });
});

describe('summarizeLavalinkNodes', () => {
  it('menghitung node yang dikonfigurasi dan yang terhubung', () => {
    const report = summarizeLavalinkNodes([
      { name: 'lava-a:2333', connected: true, players: 2 },
      { name: 'lava-b:2333', connected: false, players: 0 },
    ]);

    expect(report.configured).toBe(2);
    expect(report.connected).toBe(1);
    expect(report.nodes).toHaveLength(2);
  });

  it('melaporkan nol node sebagai nol, bukan undefined', () => {
    const report = summarizeLavalinkNodes([]);

    expect(report).toEqual({ configured: 0, connected: 0, nodes: [] });
  });

  it('menyalin daftar status supaya perubahan pemanggil tidak mengubah laporan', () => {
    const input = [{ name: 'lava-a:2333', connected: true, players: 1 }];
    const report = summarizeLavalinkNodes(input);

    input[0]!.name = 'diganti';
    expect(report.nodes[0]?.name).toBe('lava-a:2333');
  });
});

/**
 * Klien Discord palsu.
 *
 * Shoukaku menyimpan connector saat dibangun dan memasang listener di manager,
 * bukan memutar apa pun. Itu cukup untuk menguji sisi multi-node tanpa Discord
 * dan tanpa Lavalink.
 */
function fakeClient(): Client {
  return {
    options: { intents: [] },
    on: () => undefined,
    once: () => undefined,
    emit: () => true,
    ws: { ping: 0 },
  } as unknown as Client;
}

function buildService(nodes: MusicNodeOptions[]): MusicService {
  return new MusicService(fakeClient(), {
    getConfig: () => Promise.reject(new Error('tidak dipakai di tes ini')),
    nodes,
    maxQueueSize: 10,
  });
}

describe('MusicService multi-node', () => {
  it('menerima lebih dari satu node sekaligus', () => {
    const service = buildService([
      { host: 'lava-a', port: 2333, password: 'rahasia' },
      { host: 'lava-b', port: 4040, password: 'rahasia' },
      { host: 'lava-c', port: 5050, password: 'rahasia' },
    ]);

    expect(service.nodeCount).toBe(3);
  });

  it('menyusun nama node dari host:port saat nama tidak diberikan', () => {
    const service = buildService([
      { host: 'lava-a', port: 2333, password: 'rahasia' },
      { host: 'lava-b', port: 4040, password: 'rahasia', name: 'khusus-jakarta' },
    ]);

    expect(service.nodeReport().nodes.map((node) => node.name)).toEqual([
      'lava-a:2333',
      'khusus-jakarta',
    ]);
  });

  it('melaporkan semua node terkonfigurasi meski belum ada yang tersambung', () => {
    // Shoukaku baru mendaftarkan node saat klien Discord siap, jadi sebelum
    // login peta node kosong. Laporan yang jujur tetap menyebut node yang
    // dikonfigurasi, bukan melaporkan nol.
    const service = buildService([
      { host: 'lava-a', port: 2333, password: 'rahasia' },
      { host: 'lava-b', port: 4040, password: 'rahasia' },
    ]);

    const report = service.nodeReport();

    expect(report.configured).toBe(2);
    expect(report.connected).toBe(0);
    expect(report.nodes.every((node) => !node.connected && node.players === 0)).toBe(true);
    expect(service.isConnected).toBe(false);
  });

  it('tetap bisa dibangun dan tidak mengklaim ada node siap saat daftar node kosong', () => {
    const service = buildService([]);

    // Daftar kosong tidak mungkin terjadi dari `initMusic`, tapi kalau terjadi
    // service tetap harus bisa dibangun, bukan melempar.
    expect(service.nodeCount).toBe(1);
    expect(service.isConnected).toBe(false);
  });
});