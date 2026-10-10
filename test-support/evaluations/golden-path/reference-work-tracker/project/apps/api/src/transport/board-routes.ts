import type { FastifyInstance } from 'fastify';
import type { Board } from '../../../../packages/contracts/src/index';

export function registerBoardRoutes(server: Pick<FastifyInstance, 'get'>, listBoards: (organizationId: string) => Board[]): void {
  server.get('/boards', async () => ({ items: listBoards('synthetic') }));
  server.get('/health', async () => ({ status: 'ok', correlationId: 'synthetic' }));
}
