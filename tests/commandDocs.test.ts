import { readFileSync } from 'node:fs';
import { Collection } from 'discord.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCommands } from '../src/handlers/commandHandler.js';
import type { BotCommand } from '../src/types/command.js';

const README_FILE = 'README.md';

/**
 * Daftar perintah di README harus sama dengan yang benar-benar di-deploy.
 *
 * **Kenapa ini perlu dijaga.** Blok "Status" di README adalah satu-satunya
 * tempat yang mencantumkan seluruh perintah sekaligus, jadi itulah yang dibaca
 * orang untuk tahu "apa saja yang bot ini bisa". Yang tidak terlihat: command
 * loader memuat berkas dari folder, sementara blok itu ditulis tangan. traced
 * keduanya melenceng tanpa ada yang gagal -- tidak ada error deploy, tidak ada
 * tes yang merah, hanya dokumen yang diam-diam tidak lagi benar.
 *
 * Yang sudah terjadi sekali: blok itu menulis "19 admin/moderasi" dan
 * "18 musik" padahal daftarnya berisi 21 dan 20, dan `/config` muncul di dua
 * kelompok sekaligus. Totalnya kebetulan benar karena yang dobel menutup
 * kekurangan -- justru itu yang membuatnya tidak pernah ketahuan.
 */
interface DocumentedGroup {
  label: string;
  statedCount: number;
  commands: string[];
}

interface DocumentedInventory {
  statedTotal: number;
  groups: DocumentedGroup[];
}

function readme(): string {
  return readFileSync(README_FILE, 'utf8');
}

/**
 * Baca blok "Status" di bagian atas README.
 *
 * Blok itu adalah kutipan markdown (setiap baris diawali `>`), jadi teksnya
 * diambil dari baris yang diawali `>` di antara penanda Status dan penanda
 * "Yang belum" -- bukan dari seluruh berkas, supaya penyebutan perintah di
 * contoh kalimat lain tidak ikut terhitung sebagai inventaris.
 */
function statusBlock(source: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('> **Status:'));
  if (start === -1) {
    throw new Error('Blok "Status" tidak ditemukan di ' + README_FILE + '.');
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith('> **Yang belum'));
  const last = end === -1 ? lines.length : end;

  return lines.slice(start, last).join('\n');
}

/**
 * Inventaris perintah yang ditulis di blok Status.
 *
 * Lempar kalau bentuk blok berubah -- kalau diam-diam mengembalikan daftar
 * kosong, setiap tes di bawah akan lulus tanpa memeriksa apa pun.
 */
function documentedInventory(source: string): DocumentedInventory {
  const block = statusBlock(source);

  const total = /\*\*(\d+)\s+slash command\*\*/.exec(block)?.[1];
  if (total === undefined) {
    throw new Error('Jumlah slash command tidak ditemukan di blok Status.');
  }

  const groups: DocumentedGroup[] = [];
  const pattern = /(\d+)\s+([A-Za-z/]+)\s*\(([^)]*)\)/g;
  for (const match of block.matchAll(pattern)) {
    const statedCount = match[1];
    const label = match[2];
    const list = match[3];
    if (statedCount === undefined || label === undefined || list === undefined) continue;

    groups.push({
      label,
      statedCount: Number(statedCount),
      commands: [...list.matchAll(/`\/([a-z0-9-]+)`/g)].map((entry) => entry[1] ?? ''),
    });
  }

  if (groups.length === 0) {
    throw new Error('Tidak ada kelompok perintah yang terbaca di blok Status.');
  }

  return { statedTotal: Number(total), groups };
}

/** Perintah yang punya bagian sendiri di README. */
function documentedHeadings(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^#{2,4} [^`\n]*`\/([a-z0-9-]+)`/gm)) {
    const name = match[1];
    if (name) names.push(name);
  }

  return [...new Set(names)].sort();
}

let deployed: string[] = [];

beforeAll(async () => {
  const commands = new Collection<string, BotCommand>();
  await loadCommands(commands);
  // Nama dibaca dari JSON payload, bukan dari `data.name`: tipe resmi
  // `SlashCommandData` tidak menjamin properti `name` di semua cabangnya,
  // padahal itulah bentuk yang benar-benar dikirim ke Discord.
  deployed = [...commands.values()]
    .map((command) => (command.data.toJSON() as { name?: string }).name)
    .filter((name): name is string => typeof name === 'string')
    .sort();
}, 60_000);

describe('inventaris perintah di README', () => {
  it('blok Status terbaca dan punya kelompok', () => {
    const inventory = documentedInventory(readme());

    expect(inventory.statedTotal).toBeGreaterThan(0);
    expect(inventory.groups.length).toBeGreaterThan(1);

    const documented = inventory.groups.flatMap((group) => group.commands);
    expect(documented.length).toBeGreaterThan(0);
  });

  it('setiap perintah yang di-deploy ada di blok Status README', () => {
    const documented = new Set(
      documentedInventory(readme()).groups.flatMap((group) => group.commands),
    );

    const missing = deployed.filter((name) => !documented.has(name)).sort();

    expect(missing).toEqual([]);
  });

  it('setiap perintah di blok Status benar-benar ada di kode', () => {
    const known = new Set(deployed);
    const documented = documentedInventory(readme())
      .groups.flatMap((group) => group.commands)
      .filter((name) => !known.has(name));

    expect([...new Set(documented)].sort()).toEqual([]);
  });

  it('jumlah total yang tertulis sama dengan jumlah perintah sungguhan', () => {
    const { statedTotal } = documentedInventory(readme());

    expect(statedTotal).toBe(deployed.length);
  });

  it('jumlah tiap kelompok sama dengan isi daftarnya', () => {
    const wrong = documentedInventory(readme())
      .groups.filter((group) => group.statedCount !== group.commands.length)
      .map((group) => ({
        kelompok: group.label,
        tertulis: group.statedCount,
        isiDaftar: group.commands.length,
      }));

    expect(wrong).toEqual([]);
  });

  it('jumlah kelompok-kelompok menjumlah jadi total yang tertulis', () => {
    const inventory = documentedInventory(readme());
    const sum = inventory.groups.reduce((total, group) => total + group.commands.length, 0);

    // Tidak boleh ada perintah yang masuk dua kelompok sekaligus: `/config`
    // pernah ditulis di admin DAN inti, dan dua kelebihannya menutupi
    // kekurangan kelompok lain sehingga totalnya kebetulan tetap cocok.
    expect(sum).toBe(inventory.statedTotal);
  });

  it('tidak ada perintah yang didokumentasikan dua kali', () => {
    const commands = documentedInventory(readme()).groups.flatMap((group) => group.commands);
    const duplicated = [...new Set(commands.filter((name, i) => commands.indexOf(name) !== i))].sort();

    expect(duplicated).toEqual([]);
  });

  it('nama perintah di README memakai bentuk yang Discord terima', () => {
    const invalid = documentedInventory(readme())
      .groups.flatMap((group) => group.commands)
      .filter((name) => !/^[a-z0-9-]{1,32}$/.test(name));

    expect(invalid).toEqual([]);
  });
});

describe('bagian per-perintah di README', () => {
  it('setiap perintah yang punya judul di README benar-benar ada', () => {
    const known = new Set(deployed);
    const phantom = documentedHeadings(readme()).filter((name) => !known.has(name));

    expect(phantom).toEqual([]);
  });

  it('judul perintah ditemukan, jadi pemeriksaannya bukan kosong', () => {
    expect(documentedHeadings(readme()).length).toBeGreaterThan(5);
  });
});

describe('cara tes menemukan penyimpangan', () => {
  it('menolak blok Status yang tidak ada', () => {
    expect(() => documentedInventory('# Judul\n\nTeks biasa.\n')).toThrow(/tidak ditemukan/);
  });

  it('menolak blok Status tanpa daftar kelompok', () => {
    const source = ['> **Status: selesai.**', '> **46 slash command** terdaftar.'].join('\n');
    expect(() => documentedInventory(source)).toThrow(/kelompok perintah/);
  });

  it('membaca jumlah dan kelompok sesuai bentuk yang dipakai README', () => {
    const inventory = documentedInventory(
      [
        '> **Status: apa pun.**',
        '> **3 slash command** terdaftar: 2 musik (`/play`, `/stop`), dan 1 inti (`/ping`).',
      ].join('\n'),
    );

    expect(inventory.statedTotal).toBe(3);
    expect(inventory.groups.map((group) => [group.label, group.statedCount, group.commands])).toEqual([
      ['musik', 2, ['play', 'stop']],
      ['inti', 1, ['ping']],
    ]);
  });

  it('menemukan satu perintah yang tertulis dua kali', () => {
    const duplicated = ['config', 'ping', 'config'].filter(
      (name, index, all) => all.indexOf(name) !== index,
    );
    expect([...new Set(duplicated)].sort()).toEqual(['config']);
  });
});