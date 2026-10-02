import { getPrisma } from '../../services/database.js';
import { PrismaTicketRepository } from './repository.js';
import { TicketService } from './service.js';

let service: TicketService | undefined;

/** Service tiket (lazy, satu instance per proses bot). */
export function getTicketService(): TicketService {
  if (!service) {
    service = new TicketService(new PrismaTicketRepository(getPrisma()));
  }

  return service;
}