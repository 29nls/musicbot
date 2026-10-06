// Penyambungan kanal invalidasi ke lima cache yang benar-benar ada.
//
// Berkas ini sengaja terpisah dari `invalidation.ts`: yang itu murni dan bisa
// diuji tanpa memuat bot, sedangkan yang ini mengimpor singleton service.
// Impor ke arah sini saja (wiring -> service), tidak sebaliknya, supaya tidak
// ada siklus `config -> i18n -> config`.
//
// Kelima cache ini yang menjadi basi kalau dashboard menulis langsung ke
// database:
//
//   config         60 detik   src/modules/config/guildConfigService.ts
//   locale         30 detik   src/modules/i18n/service.ts
//   automod        per server src/modules/automod/service.ts
//   routing log    per server src/modules/logging/service.ts
//   perintah custom 60 detik  src/modules/customcommands/service.ts
//
// Routing log dan automod ikut dibuang karena keduanya dibaca oleh jalur yang
// memutuskan sesuatu (pesan dihapus atau tidak, embed dikirim ke mana), jadi
// konfigurasi yang baru tapi cache lama bisa menghasilkan aksi yang salah.

import { getAutomodService } from '../automod/index.js';
import { getCustomCommandService } from '../customcommands/index.js';
import { getLocaleService } from '../i18n/singleton.js';
import { getLoggingService } from '../logging/singleton.js';
import { getGuildConfigService } from './index.js';
import type { ConfigChangedTargets } from './invalidation.js';

/** Target invalidasi yang memakai service sungguhan milik proses bot ini. */
export function createServiceInvalidationTargets(): ConfigChangedTargets {
  return {
    config: (guildId) => getGuildConfigService().invalidate(guildId),
    locale: (guildId) => getLocaleService().invalidate(guildId),
    automod: (guildId) => getAutomodService().invalidate(guildId),
    logging: (guildId) => getLoggingService().invalidate(guildId),
    customCommands: (guildId) => getCustomCommandService().invalidate(guildId),
  };
}
