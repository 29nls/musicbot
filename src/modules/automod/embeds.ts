import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatCaseId } from '../moderation/index.js';
import type { AutomodViolation } from './engine.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import {
  RULE_META,
  actionLabel,
  describeThreshold,
  ruleLabel,
  type AutomodPolicy,
} from './types.js';

const listPreview = (items: readonly string[], notSet: string, max = 10): string => {
  if (items.length === 0) return notSet;
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} (+${items.length - max})` : shown;
};

const channelList = (ids: readonly string[], notSet: string): string =>
  ids.length > 0 ? ids.map((id) => `<#${id}>`).join(', ') : notSet;

const roleList = (ids: readonly string[], notSet: string): string =>
  ids.length > 0 ? ids.map((id) => `<@&${id}>`).join(', ') : notSet;

/** Ringkasan rule automod satu server — dipakai `/automod show`. */
export function automodShowEmbed(
  policy: AutomodPolicy,
  moduleEnabled: boolean,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const notSet = t('automod.value.notSet');

  const rules = policy.rules
    .map((rule) => {
      const meta = RULE_META[rule.type];
      const threshold = describeThreshold(rule.type, rule.threshold, t);
      const actions = rule.actions.map((action) => actionLabel(action, t)).join(' + ');
      const suffix = threshold === '—' ? actions : `${threshold} • ${actions}`;

      return `${rule.enabled ? '✅' : '❌'} ${meta.emoji} **${ruleLabel(rule.type, t)}** — ${suffix}`;
    })
    .join('\n');

  const badword = policy.rules.find((rule) => rule.type === 'badword');
  const link = policy.rules.find((rule) => rule.type === 'link');
  const invite = policy.rules.find((rule) => rule.type === 'invite');

  return new EmbedBuilder()
    .setColor(moduleEnabled ? EMBED_COLORS.success : EMBED_COLORS.warning)
    .setTitle(t('automod.title'))
    .setDescription(moduleEnabled ? t('automod.module.on') : t('automod.module.off'))
    .addFields(
      { name: t('automod.field.rules'), value: rules },
      { name: t('automod.field.exemptChannels'), value: channelList(policy.exemptChannels, notSet) },
      { name: t('automod.field.exemptRoles'), value: roleList(policy.exemptRoles, notSet) },
      {
        name: t('automod.field.badwords'),
        value: listPreview(badword?.whitelist.words ?? [], notSet),
      },
      {
        name: t('automod.field.allowedDomains'),
        value: listPreview(link?.whitelist.domains ?? [], notSet),
      },
      {
        name: t('automod.field.allowedInvites'),
        value: listPreview(invite?.whitelist.invites ?? [], notSet),
      },
    )
    .setFooter({ text: t('automod.footer.exempt') })
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
export function automodLogEmbed(
  input: AutomodLogInput,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const meta = RULE_META[input.violation.rule];
  const actions = input.violation.actions.map((action) => {
    if (action === 'timeout' && input.timeoutMs) {
      return t('automod.log.timeoutMinutes', {
        action: actionLabel(action, t),
        minutes: Math.round(input.timeoutMs / 60_000),
      });
    }
    return actionLabel(action, t);
  });

  const excerpt = input.content.replace(/\s+/g, ' ').trim().slice(0, 300);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.error)
    .setTitle(
      t('automod.log.title', { rule: `${meta.emoji} ${ruleLabel(input.violation.rule, t)}` }),
    )
    .addFields(
      {
        name: t('automod.field.user'),
        value: `<@${input.authorId}>\n\`${input.authorTag}\``,
        inline: true,
      },
      { name: t('automod.field.channel'), value: `<#${input.channelId}>`, inline: true },
      { name: t('automod.field.actions'), value: actions.join('\n') },
      { name: t('automod.field.reason'), value: input.violation.reason },
    )
    .setTimestamp();

  if (input.caseNumber !== undefined) {
    embed.addFields({
      name: t('automod.field.case'),
      value: `\`${formatCaseId(input.caseNumber)}\``,
      inline: true,
    });
  }

  if (excerpt) {
    embed.addFields({ name: t('automod.field.message'), value: `> ${excerpt.replace(/\n/g, ' ')}` });
  }

  return embed;
}
