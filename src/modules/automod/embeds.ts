import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatCaseId } from '../moderation/index.js';
import type { AutomodViolation } from './engine.js';
import { ACTION_LABELS, RULE_LABELS, describeThreshold, type AutomodPolicy } from './types.js';

const notSet = '*belum ada*';

const channelList = (ids: readonly string[]): string =>
  ids.length > 0 ? ids.map((id) => `<#${id}>`).join(', ') : notSet;

const roleList = (ids: readonly string[]): string =>
  ids.length > 0 ? ids.map((id) => `<@&${id}>`).join(', ') : notSet;

const listPreview = (items: readonly string[], max = 10): string => {
  if (items.length === 0) return notSet;
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} (+${items.length - max})` : shown;
};

/** Ringkasan rule automod satu server — dipakai `/automod show`. */
export function automodShowEmbed(policy: AutomodPolicy, moduleEnabled: boolean): EmbedBuilder {
  const rules = policy.rules
    .map((rule) => {
      const meta = RULE_LABELS[rule.type];
      const threshold = describeThreshold(rule.type, rule.threshold);
      const actions = rule.actions.map((action) => ACTION_LABELS[action]).join(' + ');
      const suffix = threshold === '—' ? actions : `${threshold} • ${actions}`;

      return `${rule.enabled ? '✅' : '❌'} ${meta.emoji} **${meta.label}** — ${suffix}`;
    })
    .join('\n');

  const badword = policy.rules.find((rule) => rule.type === 'badword');
  const link = policy.rules.find((rule) => rule.type === 'link');
  const invite = policy.rules.find((rule) => rule.type === 'invite');

  return new EmbedBuilder()
    .setColor(moduleEnabled ? EMBED_COLORS.success : EMBED_COLORS.warning)
    .setTitle('🤖 Automod')
    .setDescription(
      moduleEnabled
        ? 'Modul automod **aktif** — rule di bawah berlaku di setiap pesan.'
        : 'Modul automod **mati**. Nyalakan lewat `/config set automod:true` (atau wizard `/setup`) sebelum rule berlaku.',
    )
    .addFields(
      { name: 'Rule', value: rules },
      { name: '🚫 Channel dikecualikan', value: channelList(policy.exemptChannels) },
      { name: '🚫 Role dikecualikan', value: roleList(policy.exemptRoles) },
      { name: '🤬 Kata terlarang', value: listPreview(badword?.whitelist.words ?? []) },
      { name: '🌐 Domain diizinkan', value: listPreview(link?.whitelist.domains ?? []) },
      { name: '🔗 Invite diizinkan', value: listPreview(invite?.whitelist.invites ?? []) },
    )
    .setFooter({
      text: 'Pemilik pesan dengan Manage Messages & semua bot selalu dikecualikan.',
    })
    .setTimestamp();
}

export interface AutomodLogInput {
  violation: AutomodViolation;
  authorId: string;
  authorTag: string;
  channelId: string;
  content: string;
  /** Terisi kalau aksi `warn` berhasil mencatat kasus. */
  caseNumber?: number;
  /** Terisi kalau aksi timeout dijalankan. */
  timeoutMs?: number;
}

/** Embed yang dicatat ke channel log setiap kali automod bertindak. */
export function automodLogEmbed(input: AutomodLogInput): EmbedBuilder {
  const meta = RULE_LABELS[input.violation.rule];
  const actions = input.violation.actions.map((action) => {
    if (action === 'timeout' && input.timeoutMs) {
      return `${ACTION_LABELS.timeout} ${Math.round(input.timeoutMs / 60_000)} menit`;
    }
    return ACTION_LABELS[action];
  });

  const excerpt = input.content.replace(/\s+/g, ' ').trim().slice(0, 300);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.error)
    .setTitle(`🤖 Automod — ${meta.emoji} ${meta.label}`)
    .addFields(
      { name: 'Pengguna', value: `<@${input.authorId}>\n\`${input.authorTag}\``, inline: true },
      { name: 'Channel', value: `<#${input.channelId}>`, inline: true },
      { name: 'Aksi', value: actions.join('\n') },
      { name: 'Alasan', value: input.violation.reason },
    )
    .setTimestamp();

  if (input.caseNumber !== undefined) {
    embed.addFields({ name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true });
  }

  if (excerpt) {
    embed.addFields({ name: 'Isi pesan', value: `> ${excerpt.replace(/\n/g, ' ')}` });
  }

  return embed;
}
