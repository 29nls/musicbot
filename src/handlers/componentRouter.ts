import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getLogger } from '../services/logger.js';
import { errorEmbed } from '../utils/embeds.js';
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
}

const HANDLERS: readonly ComponentHandler[] = [
  {
    prefix: `${REACTION_ROLE_PREFIX}panel-`,
    kinds: ['select'],
    handle: handleReactionRoleSelect,
  },
  {
    prefix: TICKET_SUBJECT_MODAL,
    kinds: ['modal'],
    handle: handleTicketSubjectSubmit,
  },
  {
    prefix: TICKET_PREFIX,
    kinds: ['button'],
    handle: handleTicketButton,
  },
];

function kindOf(interaction: RoutedInteraction): ComponentKind {
  if (interaction.isButton()) return 'button';
  if (interaction.isStringSelectMenu()) return 'select';

  return 'modal';
}

/**
 * Teruskan klik tombol, select menu, dan submit modal ke modul yang memilikinya.
 *
 * Komponen yang tidak dikenali (mis. tombol milik wizard `/setup`, yang punya
 * collector sendiri) dibiarkan lewat supaya tidak mengganggu collectornya.
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