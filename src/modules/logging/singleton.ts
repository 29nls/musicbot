import { getPrisma } from '../../services/database.js';
import { PrismaLoggingRepository } from './repository.js';
import { LoggingService } from './service.js';

let service: LoggingService | undefined;

/** Service routing log (lazy, satu instance per proses bot). */
export function getLoggingService(): LoggingService {
  if (!service) {
    service = new LoggingService(new PrismaLoggingRepository(getPrisma()));
  }

  return service;
}
