import type { ClientEvents } from 'discord.js';
import type { BotClient } from '../client.js';

export type BotEventName = keyof ClientEvents;

/**
 * Modul event: satu file = satu event, dengan `name` dari `Events.*` discord.js.
 * Handler menerima `client` sebagai argumen pertama supaya file event tidak
 * perlu import singleton.
 */
export interface BotEvent<Name extends BotEventName = BotEventName> {
  readonly name: Name;
  /** true = hanya dipanggil sekali (mis. Events.ClientReady). */
  readonly once?: boolean;
  execute(client: BotClient, ...args: ClientEvents[Name]): Promise<void> | void;
}
