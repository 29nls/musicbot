import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { checkCooldown } from '../utils/cooldown.js';
import { errorEmbed, warningEmbed } from '../utils/embeds.js';
import { getLogger } from '../services/logger.js';
import { handleSearchSelect, SEARCH_SELECT_PREFIX } from '../modules/music/index.js';
import { handleReactionRoleSelect, REACTION_ROLE_PREFIX } from '../modules/reactionroles/index.js';
import {
  handleTicketButton,
  handleTicketSubjectSubmit,
  TICKET_PREFIX,
  TICKET_SUBJECT_MODAL,
} from '../modules/tickets/index.js';

/** Interaksi berbasis komponen yang diurus router ini. */
export type RoutedInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

type ComponentKind = 'button' | 'select' | 'modal';

/** Cooldown komponen kalau handler tidak menyebutkan sendiri. */
export const DEFAULT_COMPONENT_COOLDOWN_SECONDS = 3;

/** Satu kelompok komponen yang dimiliki sebuah fitur. */
interface ComponentHandler {
  /** Awalan customId yang ditangani handler ini, mis. `rr:`. */
  prefix: string;
  /**
   * Jenis interaksi yang dimiliki handler.
   *
   * Penting karena `ticket:subject` dan `ticket:create` sama-sama berawalan
   * `ticket:` — tanpa ini, modal bisa masuk ke handler tombol.
   */
  kinds: readonly ComponentKind[];
  handle(interaction: RoutedInteraction): Promise<void>;
  /**
   * Cooldown per user untuk handler ini (detik).
   *
   * Tombol tiket membuat channel dan mengubah database, jadi diberi jeda lebih
   * panjang daripada select menu yang sekadar membaca state.
   */
  cooldownSeconds?: number;
}

const HANDLERS: readonly ComponentHandler[] = [
  {
    prefix: SEARCH_SELECT_PREFIX,
    kinds: ['select'],
    handle: handleSearchSelect,
    cooldownSeconds: 3,
  },
  {
    prefix: `${REACTION_ROLE_PREFIX}panel-`,
    kinds: ['select'],
    handle: handleReactionRoleSelect,
    cooldownSeconds: 3,
  },
  {
    prefix: TICKET_SUBJECT_MODAL,
    kinds: ['modal'],
    handle: handleTicketSubjectSubmit,
    cooldownSeconds: 5,
  },
  {
    prefix: TICKET_PREFIX,
    kinds: ['button'],
    handle: handleTicketButton,
    cooldownSeconds: 5,
  },
];

function kindOf(interaction: RoutedInteraction): ComponentKind {
  if (interaction.isButton()) return 'button';
  if (interaction.isStringSelectMenu()) return 'select';

  return 'modal';
}

/**
 * Kunci cooldown untuk satu klik komponen.
 *
 * Sengaja memakai **awalan fitur**, bukan customId penuh: token `/search`
 * berubah di setiap pencarian, jadi kalau customId penuh yang dipakai, setiap
 * klik mendapat bucket kosong dan rate limit-nya tidak pernah berbunyi.
 */
export function componentCooldownKey(
  prefix: string,
  kind: ComponentKind,
  userId: string,
): string {
  return `comp:${kind}:${userId}:${prefix}`;
}

/**
 * Teruskan klik tombol, select menu, dan submit modal ke modul yang memilikinya.
 *
 * Komponen yang tidak dikenali (mis. tombol milik wizard `/setup`, yang punya
 * collector sendiri) dibiarkan lewat supaya tidak mengganggu collectornya.
 *
 * Setiap handler punya cooldown per user (§16): klik berulang yang cepat tidak
 * pernah sampai ke handler, jadi spam tombol tiket tidak mengubah database dan
 * spam select menu tidak mengirim puluhan panggilan ke Discord API.
 *
 * Mengembalikan true kalau interaksinya ditangani — pemanggil lalu tidak perlu
 * memprosesnya sebagai perintah.
 */
export async function routeComponent(interaction: RoutedInteraction): Promise<boolean> {
  const kind = kindOf(interaction);
  const handler = HANDLERS.find(
    (candidate) =>
      candidate.kinds.includes(kind) && interaction.customId.startsWith(candidate.prefix),
  );
  if (!handler) return false;

  const waitSeconds = checkCooldown(
    componentCooldownKey(handler.prefix, kind, interaction.user.id),
    handler.cooldownSeconds ?? DEFAULT_COMPONENT_COOLDOWN_SECONDS,
  );

  if (waitSeconds > 0) {
    await replyWithCooldown(interaction, waitSeconds);
    return true;
  }

  try {
    await handler.handle(interaction);
  } catch (error) {
    getLogger().error(
      { err: error, customId: interaction.customId, guild: interaction.guildId },
      'Komponen gagal diproses',
    );
    await replyWithFailure(interaction);
  }

  return true;
}

/** Balas klik yang terlalu cepat dengan sisa waktu tunggu (pesannya privat). */
async function replyWithCooldown(interaction: RoutedInteraction, waitSeconds: number): Promise<void> {
  const embed = warningEmbed(`Tunggu **${waitSeconds} detik** sebelum memakai ini lagi.`);

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    getLogger().warn({ err: error }, 'Gagal mengirim pesan cooldown komponen');
  }
}

async function replyWithFailure(interaction: RoutedInteraction): Promise<void> {
  const embed = errorEmbed(
    'Terjadi kesalahan saat memproses pilihanmu. Detailnya sudah dicatat di log bot.',
  );

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    getLogger().warn({ err: error }, 'Gagal mengirim pesan error komponen');
  }
}