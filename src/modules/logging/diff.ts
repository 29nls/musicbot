import { PermissionFlagsBits } from 'discord.js';

export interface DiffSpec<T> {
  key: keyof T & string;
  label: string;
  /** Format nilai ke teks embed; default: boolean → Ya/Tidak, null → —. */
  format?: (value: unknown) => string;
}

const defaultFormat = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  return String(value);
};

/** Bandingkan dua snapshot objek dan hasilkan baris "• **Label**: lama → baru". */
export function diffValues<T extends Record<string, unknown>>(
  before: T,
  after: T,
  specs: readonly DiffSpec<T>[],
): string[] {
  const lines: string[] = [];

  for (const spec of specs) {
    const from = before[spec.key];
    const to = after[spec.key];
    if (from === to) continue;

    const format = spec.format ?? defaultFormat;
    lines.push(`• **${spec.label}**: ${format(from)} → ${format(to)}`);
  }

  return lines;
}

export function diffIdSets(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  return {
    added: after.filter((id) => !beforeSet.has(id)),
    removed: before.filter((id) => !afterSet.has(id)),
  };
}

function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

const PERMISSION_BITS: [bigint, string][] = Object.entries(PermissionFlagsBits).map(
  ([name, bit]) => [bit as bigint, humanize(name)],
);

/** Nama izin yang aktif dari sebuah bitfield. */
export function permissionNames(bits: bigint): string[] {
  return PERMISSION_BITS.filter(([bit]) => (bits & bit) !== 0n).map(([, name]) => name);
}

export function diffPermissions(
  before: bigint,
  after: bigint,
): { added: string[]; removed: string[] } {
  return {
    added: permissionNames(after & ~before),
    removed: permissionNames(before & ~after),
  };
}

export interface OverwriteSnapshot {
  /** Kunci pencocokan, mis. `role:123` / `member:456`. */
  key: string;
  label: string;
  allow: bigint;
  deny: bigint;
}

/** Bandingkan overwrite izin channel dan hasilkan baris perubahan per target. */
export function diffOverwrites(
  before: readonly OverwriteSnapshot[],
  after: readonly OverwriteSnapshot[],
): string[] {
  const beforeMap = new Map(before.map((item) => [item.key, item]));
  const afterMap = new Map(after.map((item) => [item.key, item]));
  const lines: string[] = [];

  for (const [key, next] of afterMap) {
    const previous = beforeMap.get(key);

    if (!previous) {
      lines.push(`• ${next.label}: overwrite **ditambahkan**`);
      continue;
    }

    const parts: string[] = [];
    const allowAdded = permissionNames(next.allow & ~previous.allow);
    const allowRemoved = permissionNames(previous.allow & ~next.allow);
    const denyAdded = permissionNames(next.deny & ~previous.deny);
    const denyRemoved = permissionNames(previous.deny & ~next.deny);

    if (allowAdded.length > 0) parts.push(`izinkan +${allowAdded.join(', ')}`);
    if (allowRemoved.length > 0) parts.push(`izinkan -${allowRemoved.join(', ')}`);
    if (denyAdded.length > 0) parts.push(`tolak +${denyAdded.join(', ')}`);
    if (denyRemoved.length > 0) parts.push(`tolak -${denyRemoved.join(', ')}`);

    if (parts.length > 0) lines.push(`• ${next.label}: ${parts.join(' • ')}`);
  }

  for (const [key, previous] of beforeMap) {
    if (!afterMap.has(key)) lines.push(`• ${previous.label}: overwrite **dihapus**`);
  }

  return lines;
}
