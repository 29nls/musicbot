// Sisa error typecheck: mock & helper palsu belum bertipe, sehingga indeks
// tuple dan cast ke tipe discord.js ditolak. Diperbaiki dengan tanda tangan
// eksplisit — bukan `any` atau suppressi.
const fs = require('node:fs');

function edit(file, fixes) {
  let t = fs.readFileSync(file, 'utf8');

  for (const [from, to] of fixes) {
    const count = t.split(from).length - 1;
    if (count !== 1) {
      console.error(`GAGAL ${file}: pola muncul ${count} kali: ${from.slice(0, 70)}`);
      process.exit(1);
    }
    t = t.split(from).join(to);
  }

  fs.writeFileSync(file, t);
  console.log(`selesai: ${file}`);
}

edit('tests/loggingEvents.test.ts', [
  // Mock bertanda tangan eksplisit supaya `mock.calls` berupa tuple yang bisa
  // diindeks (guild, category, embed, meta).
  [
    "  dispatchLog: vi.fn(async () => true),\n  findAuditEntry: vi.fn(async () => null),\n  consumeCaseLink: vi.fn(() => null),",
    "  dispatchLog: vi.fn(\n    async (_guild: unknown, _category: string, _embed: unknown, _meta?: unknown) => true,\n  ),\n  findAuditEntry: vi.fn(\n    async (_guild: unknown, _type?: AuditLogEvent, _options?: { targetId?: string }) => null,\n  ),\n  consumeCaseLink: vi.fn(\n    (_guildId: string, _targetId: string, _actions: readonly string[]) => null as unknown,\n  ),",
  ],
  // `User` discord.js punya banyak properti; objek palsu harus lewat unknown.
  [
    "function fakeUser(id: string, tag = 'User#0001', isBot = false) {\n  return { id, tag, bot: isBot, createdAt: new Date('2024-01-01T00:00:00Z') };\n}",
    "function fakeUser(id: string, tag = 'User#0001', isBot = false) {\n  // `User` discord.js punya ~30 properti; yang dipakai handler cuma empat.\n  return { id, tag, bot: isBot, createdAt: new Date('2024-01-01T00:00:00Z') } as unknown as User;\n}",
  ],
  [
    "import { AuditLogEvent, type Guild, type GuildMember, type Role } from 'discord.js';",
    "import {\n  AuditLogEvent,\n  type Guild,\n  type GuildMember,\n  type Message,\n  type PartialMessage,\n  type ReadonlyCollection,\n  type Role,\n  type Snowflake,\n  type User,\n} from 'discord.js';",
  ],
  [
    "function collection(items: unknown[]): Map<string, unknown> {\n  return new Map(items.map((item, index) => [String(index), item]));\n}",
    "function collection(\n  items: Array<Message<true> | PartialMessage<true>>,\n): ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>> {\n  // `Map` sudah punya `values()` dan `size`, dan bentuknya cocok dengan\n  // `ReadonlyCollection` yang dipakai discord.js untuk pesan yang dihapus massal.\n  return new Map(items.map((item, index) => [String(index), item])) as unknown as ReadonlyCollection<\n    Snowflake,\n    Message<true> | PartialMessage<true>\n  >;\n}",
  ],
  // Pesan palsu harus bertipe Message supaya bisa masuk ke collection().
  [
    "/** Pesan palsu; setiap bagian yang diuji bisa ditimpa. */\nfunction fakeMessage(id: string, overrides: Record<string, unknown> = {}) {\n  return {",
    "/** Pesan palsu; setiap bagian yang diuji bisa ditimpa. */\nfunction fakeMessage(id: string, overrides: Record<string, unknown> = {}): Message<true> {\n  return {",
  ],
]);

edit('tests/customCommandTrigger.test.ts', [
  // Menyusun ulang objek pesan sudah `never`, jadi spread tidak bisa. Pakai
  // ulang fakeMessage dengan override penulisnya.
  [
    "  it('kunci cooldown memuat guild dan user, jadi antar member tidak saling menabrak', async () => {\n    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);\n\n    const other = fakeMessage({ content: '!halo' });\n    other.message = {\n      ...other.message,\n      author: { id: 'member-lain', bot: false, username: 'Lain', displayName: 'Lain' },\n    } as never;\n\n    await messageCreateCustomCommand.execute(client, other.message);\n\n    expect(other.replies).toHaveLength(1);\n  });",
    "  it('kunci cooldown memuat guild dan user, jadi antar member tidak saling menabrak', async () => {\n    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);\n\n    // Member berbeda di guild yang sama: cooldown-nya ikut berbeda, jadi yang\n    // kedua tetap dilayani. Kalau kuncinya tidak memuat user, member kedua\n    // ikut tertahan dan perintah-perintah bisa saling memblokir.\n    const other = fakeMessage({ content: '!halo', authorId: 'member-lain' });\n\n    await messageCreateCustomCommand.execute(client, other.message);\n\n    expect(other.replies).toHaveLength(1);\n  });",
  ],
  [
    "      id: USER_ID,\n      bot: overrides.bot ?? false,\n      username: 'Member',\n      displayName: 'Member',",
    "      id: (overrides.authorId as string) ?? USER_ID,\n      bot: overrides.bot ?? false,\n      username: 'Member',\n      displayName: 'Member',",
  ],
]);

console.log('selesai');