import { getLogger } from '../../services/logger.js';
import { defaultTranslator, type MessageKey } from '../i18n/index.js';
import type { ReactionRoleRepository } from './repository.js';
import type {
  CreatePanelInput,
  PanelOptionLookup,
  ReactionRolePanel,
  RoleInput,
} from './types.js';
import { MAX_PANEL_OPTIONS } from './types.js';
import { assertPanelKeepsOneOption, normalizeRoleInputs } from './validation.js';

/**
 * Logika domain panel reaction role.
 *
 * Tidak menyentuh Discord: permission role, select menu, dan pengiriman pesan
 * tetap di lapisan perintah & handler komponen.
 */
export class ReactionRoleService {
  constructor(private readonly repository: ReactionRoleRepository) {}

  async create(input: CreatePanelInput): Promise<ReactionRolePanel> {
    const roles = normalizeRoleInputs(input.roles);
    if (roles.length === 0) {
      throw new ReactionRoleEmptyError('rr.err.noRolesForPanel');
    }

    return this.repository.create({ ...input, roles });
  }

  /**
   * Tandai panel sudah dinonaktifkan; null kalau panel sudah tertutup sebelumnya.
   *
   * Penandaan dilakukan **sebelum** pesan diedit supaya bot yang mati di tengah
   * jalan tidak menyapu panel yang sama berulang kali. Kalau pengeditan pesan
   * kemudian gagal, panel tetap ditandai tertutup: member lebih baik melihat
   * select menu yang ditolak daripada panel yang terlihat aktif tapi sudah mati.
   */
  async markClosed(
    guildId: string,
    panelId: number,
    now = new Date(),
  ): Promise<ReactionRolePanel | null> {
    return this.repository.markClosed(guildId, panelId, now);
  }

  /**
   * Panel yang masa hidupnya sudah habis — bahan baku job penyapuan.
   *
   * `guildIds` dibatasi ke guild milik shard ini. Daftarnya kosong berarti
   * proses ini tidak memegang guild apa pun, jadi tidak ada yang bisa
   * ditutup dan repository tidak perlu menyentuh database sama sekali.
   */
  async findDueForExpiry(
    now = new Date(),
    guildIds: readonly string[] = [],
    limit = MAX_PANEL_OPTIONS,
  ): Promise<ReactionRolePanel[]> {
    return this.repository.findDueForExpiry(now, guildIds, limit);
  }

  async list(guildId: string): Promise<ReactionRolePanel[]> {
    return this.repository.list(guildId);
  }

  async find(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    return this.repository.find(guildId, panelId);
  }

  async addRoles(
    guildId: string,
    panelId: number,
    roles: readonly RoleInput[],
  ): Promise<ReactionRolePanel | null> {
    const panel = await this.repository.find(guildId, panelId);
    if (!panel) return null;

    const additions = normalizeRoleInputs(
      roles,
      panel.options.map((option) => option.roleId),
    );
    if (additions.length === 0) {
      throw new ReactionRoleEmptyError('rr.err.allRolesInPanel');
    }

    return this.repository.addOptions(panelId, additions);
  }

  async removeRoles(
    guildId: string,
    panelId: number,
    roleIds: readonly string[],
  ): Promise<ReactionRolePanel | null> {
    const panel = await this.repository.find(guildId, panelId);
    if (!panel) return null;

    const remaining = panel.options.length - roleIds.length;
    assertPanelKeepsOneOption(remaining);

    return this.repository.removeOptions(panelId, roleIds);
  }

  /** Hapus panel; pemanggil yang bertanggung jawab menghapus pesan Discord-nya. */
  async delete(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    return this.repository.delete(guildId, panelId);
  }

  /** Cari opsi berdasarkan customId — dipanggil handler select menu. */
  async findOption(optionId: number): Promise<PanelOptionLookup | null> {
    return this.repository.findOption(optionId);
  }

  /** Tempelkan ID pesan panel supaya bisa diedit nanti. Best-effort. */
  async attachMessage(panelId: number, messageId: string): Promise<void> {
    try {
      await this.repository.attachMessage(panelId, messageId);
    } catch (error) {
      getLogger().warn({ err: error, panelId }, 'Gagal menempelkan ID pesan panel reaction role');
    }
  }
}

/**
 * Pesan aman ke user saat panel kosong / input tidak mengubah apa pun.
 *
 * Sama seperti error validasi: yang dibawa adalah kunci katalog, bukan
 * kalimat, supaya tampil dalam bahasa server.
 */
export class ReactionRoleEmptyError extends Error {
  public override readonly name = 'ReactionRoleEmptyError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}
