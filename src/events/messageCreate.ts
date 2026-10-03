import { Events, PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import type { BotClient } from '../client.js';
import {
  AUTOMOD_TIMEOUT_MS,
  analyzeMessage,
  automodLogEmbed,
  getAutomodService,
  getAutomodTracker,
  isExempt,
  ruleLabel,
  type AutomodMessageInput,
  type AutomodViolation,
} from '../modules/automod/index.js';
import { getGuildConfigService, type GuildConfig } from '../modules/config/index.js';
import { translatorFor, type Translator } from '../modules/i18n/index.js';
import { getModerationService, sendGuildEmbed } from '../modules/moderation/index.js';
import { getLogger } from '../services/logger.js';
import type { BotEvent } from '../types/event.js';

export default {
  name: Events.MessageCreate,
  async execute(client: BotClient, message: Message): Promise<void> {
    // DM, bot (termasuk pesan log kita sendiri), pesan sistem, dan pesan parsial
    // tidak bisa dievaluasi dengan benar.
    if (!message.inGuild() || message.author.bot || message.system || message.partial) return;

    const member = message.member;
    if (!member) return;

    const guildId = message.guildId;
    const logger = getLogger();

    let config: GuildConfig;
    try {
      config = await getGuildConfigService().get(guildId);
    } catch (error) {
      logger.warn({ err: error, guild: guildId }, 'Konfigurasi tidak terbaca untuk automod');
      return;
    }

    if (!config.modules.automod) return;

    let policy;
    try {
      policy = await getAutomodService().getPolicy(guildId);
    } catch (error) {
      logger.warn({ err: error, guild: guildId }, 'Rule automod tidak terbaca');
      return;
    }

    const input: AutomodMessageInput = {
      channelId: message.channelId,
      content: message.content,
      mentionCount:
        message.mentions.users.size +
        message.mentions.roles.size +
        (message.mentions.everyone ? 1 : 0),
      memberRoleIds: [...member.roles.cache.keys()],
      canManageMessages: member.permissions.has(PermissionFlagsBits.ManageMessages),
      isBot: message.author.bot,
    };

    // Jangan kotori state untuk pesan yang memang dikecualikan.
    if (isExempt(input, policy)) return;

    const state = getAutomodTracker().record({
      guildId,
      userId: message.author.id,
      content: message.content,
    });

    // Penerjemah diambil SEKALI di sini: `analyzeMessage` menyusun kalimat
    // alasan pelanggaran, dan embed log menyusun kalimatnya lagi. Tanpa satu
    // penerjemah bersama, keduanya bisa memakai bahasa berbeda kalau config
    // server berubah di tengah proses.
    const t = await translatorFor(guildId);

    const violation = analyzeMessage(input, policy, state, t);
    if (!violation) return;

    await handleViolation(client, message, member, violation, config, t);
  },
} satisfies BotEvent<'messageCreate'>;

/** Jalankan aksi rule (hapus/warn/timeout) lalu catat semuanya ke channel log. */
async function handleViolation(
  client: BotClient,
  message: Message<true>,
  member: GuildMember,
  violation: AutomodViolation,
  config: GuildConfig,
  t: Translator,
): Promise<void> {
  const logger = getLogger();
  const guild = message.guild;
  const label = ruleLabel(violation.rule, t);

  if (violation.actions.includes('delete')) {
    await message
      .delete()
      .catch((error: unknown) =>
        logger.warn({ err: error, message: message.id }, 'Automod gagal menghapus pesan'),
      );
  }

  let caseNumber: number | undefined;
  if (violation.actions.includes('warn')) {
    const botId = client.user?.id ?? guild.members.me?.id;
    if (botId) {
      try {
        const created = await getModerationService().recordWarning({
          guildId: guild.id,
          targetId: message.author.id,
          moderatorId: botId,
          reason: `${label}: ${violation.reason}`,
        });
        caseNumber = created.case.caseNumber;
      } catch (error) {
        logger.warn(
          { err: error, guild: guild.id, user: message.author.id },
          'Automod gagal mencatat peringatan',
        );
      }
    }
  }

  let timeoutMs: number | undefined;
  if (violation.actions.includes('timeout')) {
    timeoutMs = AUTOMOD_TIMEOUT_MS;

    if (member.moderatable) {
      await member
        .timeout(timeoutMs, `Automod (${label}): ${violation.reason}`)
        .catch((error: unknown) =>
          logger.warn(
            { err: error, guild: guild.id, user: message.author.id },
            'Automod gagal memberi timeout',
          ),
        );
    } else {
      logger.warn(
        { guild: guild.id, user: message.author.id },
        'Automod ingin timeout tetapi member tidak bisa dimoderasi bot',
      );
    }
  }

  await sendGuildEmbed(
    guild,
    config.logChannelId,
    automodLogEmbed(
      {
        violation,
        authorId: message.author.id,
        authorTag: message.author.tag,
        channelId: message.channelId,
        content: message.content,
        caseNumber,
        timeoutMs,
      },
      t,
    ),
  );
}
