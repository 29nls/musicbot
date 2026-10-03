import { describe, expect, it } from 'vitest';
import {
  checkModerationHierarchy,
  hierarchyMessage,
  type HierarchyInput,
} from '../src/modules/moderation/hierarchy.js';

const base: HierarchyInput = {
  actorId: '111111111111111111',
  targetId: '222222222222222222',
  botId: '333333333333333333',
  guildOwnerId: '444444444444444444',
  actorHighestRolePosition: 10,
  botHighestRolePosition: 8,
  targetHighestRolePosition: 5,
};

describe('checkModerationHierarchy', () => {
  it('meloloskan moderator dengan role di atas target', () => {
    expect(checkModerationHierarchy(base)).toEqual({ ok: true });
  });

  it('menolak self-moderation', () => {
    const result = checkModerationHierarchy({ ...base, targetId: base.actorId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(hierarchyMessage(result)).toMatch(/dirimu sendiri/i);
  });

  it('menolak memoderasi bot sendiri', () => {
    const result = checkModerationHierarchy({ ...base, targetId: base.botId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(hierarchyMessage(result)).toMatch(/diriku sendiri/i);
  });

  it('menolak memoderasi pemilik server', () => {
    const result = checkModerationHierarchy({ ...base, targetId: base.guildOwnerId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(hierarchyMessage(result)).toMatch(/pemilik server/i);
  });

  it('menolak saat role bot tidak lebih tinggi dari target', () => {
    const result = checkModerationHierarchy({ ...base, botHighestRolePosition: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(hierarchyMessage(result)).toMatch(/role-ku/i);
  });

  it('menolak saat role moderator tidak lebih tinggi dari target', () => {
    const result = checkModerationHierarchy({ ...base, actorHighestRolePosition: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(hierarchyMessage(result)).toMatch(/role-mu/i);
  });

  it('mengizinkan ban user yang bukan anggota server (posisi role null)', () => {
    expect(checkModerationHierarchy({ ...base, targetHighestRolePosition: null })).toEqual({ ok: true });
  });

  it('melewati cek posisi role kalau requireOutrank false', () => {
    expect(
      checkModerationHierarchy({
        ...base,
        requireOutrank: false,
        botHighestRolePosition: 1,
        actorHighestRolePosition: 1,
        targetHighestRolePosition: 99,
      }),
    ).toEqual({ ok: true });
  });

  it('self-moderation tetap ditolak walau requireOutrank false', () => {
    const result = checkModerationHierarchy({ ...base, requireOutrank: false, targetId: base.actorId });

    expect(result.ok).toBe(false);
  });
});
