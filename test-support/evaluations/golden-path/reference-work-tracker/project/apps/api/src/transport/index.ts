import type { FastifyInstance } from 'fastify';
import { createBoardService, type BoardStore } from '../application/index';
import { registerBoardRoutes } from './board-routes';

export function createTransport(store: BoardStore, server: Pick<FastifyInstance, 'get' | 'listen'>) {
  const service = createBoardService(store);
  registerBoardRoutes(server, (organizationId) => service.listBoards(organizationId));
  return { server, service };
}
