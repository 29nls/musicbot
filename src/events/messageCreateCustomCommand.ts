import { Events, PermissionFlagsBits, type Message } from 'discord.js';
import type { BotClient } from '../client.js';
import {
  TRIGGER_COOLDOWN_SECONDS,
  TRIGGER_PREFIX,
  getCustomCommandService,
  parseTrigger,
  renderedMessage,
} from '../modules/customcommands/index.js';
import { getGuildConfigService } from '../modules/config/index.js';
import { getMetricsRegistry } from '../modules/metrics/index.js';
import { getLogger } from '../services/logger.js';
import type { BotEvent } from '../types/event.js';
import { checkCooldown } from '../utils/cooldown.js';

/**
 * Pemicu custom command.
 *
 * File terpisah dari `messageCreate.ts` (automod) karena keduanya listen ke
 * event yang sama tapi tidak ada hubungannya: satu menilai pesan untuk
 * melanggar rule, satu lagi untuk melihat apakah pesan itu memanggil perintah
 * custom. Menggabungkannya hanya akan membuat duaconcerns ikut memblokir satu
 * sama lain.
 *
 * **Urutan pemeriksaan di sini menentukan biaya setiap pesan di server.**
 * Pemicu dibaca lebih dulu dan hanya dari isi pesan — tanpa satu pun query —
 * karena itu majority dari semua pesan yang masuk. Database baru disentuh
 * setelah pesan itu benar-benar berbentuk pemicu, modulnya nyala, dan hak
 * kirim pesan sudah dipastikan ada.
 */
export default {
  name: Events.MessageCreate,
  async execute(client: BotClient, message: Message): Promise<void> {
    // DM, pesan bot (termasuk balasan perintah custom sebelumnya), pesan sistem,
    // dan pesan parsial tidak bisa dinilai.
    if (!message.inGuild() || message.author.bot || message.system || message.partial) return;

    const trigger = parseTrigger(message.content, { botId: client.user?.id });
    if (!trigger) return;

    const guild = message.guild;
    const member = message.member;
    if (!member) return;

    // Bot tidak boleh membalas di channel yang tidak bisa ia kirim; member yang
    // tidak bisa bicara di channel itu juga tidak perlu dilayani (membalas
    // balasan admin di channel readonly hanya menambah kebisingan).
    const me = guild.members.me;
    if (!me) return;

    const myPermissions = message.channel.permissionsFor(me);
    if (
      !myPermissions?.has(PermissionFlagsBits.ViewChannel) ||
      !myPermissions.has(PermissionFlagsBits.SendMessages)
    ) {
      return;
    }

    if (!member.permissions.has(PermissionFlagsBits.SendMessages)) return;

    let enabled: boolean;
    try {
      enabled = (await getGuildConfigService().get(guild.id)).modules.customCommands;
    } catch (error) {
      getLogger().warn(
        { err: error, guild: guild.id },
        'Konfigurasi tidak terbaca untuk perintah custom',
      );
      return;
    }

    if (!enabled) return;

    const logger = getLogger();

    let command;
    try {
      command = await getCustomCommandService().find(guild.id, trigger.name);
    } catch (error) {
      logger.warn({ err: error, guild: guild.id }, 'Perintah custom gagal dibaca');
      return;
    }

    if (!command) return;

    const remaining = await checkCooldown(
      `customcmd:${guild.id}:${message.author.id}`,
      TRIGGER_COOLDOWN_SECONDS,
    );

    if (remaining > 0) {
      // Bot sengaja diam, bukan membalas "tunggu N detik". Balasan pada pesan
      // biasa tidak bisa disembunyikan hanya untuk satu orang (discord.js hanya
      // bisa ephemeral pada interaksi), jadi membalas akan menumpuk menjadi
      // pesan baru di channel — persis yang harus dihindari saat seseorang
      // sengaja memanggil perintah berkali-kali.
      logger.debug(
        { guild: guild.id, user: message.author.id, remaining },
        'Pemicu perintah custom diabaikan karena cooldown',
      );
      return;
    }

    const content = renderedMessage(command.response, {
      userId: message.author.id,
      username: message.author.displayName || message.author.username,
      guildName: guild.name,
      channelId: message.channelId,
      args: trigger.args,
    });

    // Balasan yang kosong setelah placeholder diganti tidak dijalankan: admin
    // yang menulis `{args}` untuk pesan tanpa argumen akan melihat bot diam,
    // bukan pesan kosong yang aneh dibaca member.
    if (!content) return;

    getMetricsRegistry().record('message');

    try {
      await message.reply({ content, allowedMentions: { parse: ['users'] } });
    } catch (error) {
      getMetricsRegistry().record('message', 'error');
      logger.warn(
        { err: error, guild: guild.id, channel: message.channelId },
        `Perintah custom ${TRIGGER_PREFIX}${command.name} gagal dikirim`,
      );
    }
  },
} satisfies BotEvent<'messageCreate'>;